using System.Text.Json;
using k8s;
using k8s.Models;
using YamlDotNet.RepresentationModel;
using KroStudio.Web.Infrastructure.Kubernetes;
using System.Globalization;
using System.Text;
using YamlDotNet.Core;

namespace KroStudio.Web.Features.Connection;

/// <summary>Installs the pinned KRO release using the official raw release manifest.</summary>
public sealed class KroInstallationService(KubernetesClientFactory clientFactory, ClusterConnectionService connectionService, IConfiguration configuration)
{
    private const string ManifestUrl = "https://github.com/kubernetes-sigs/kro/releases/download/v{0}/kro-core-install-manifests.yaml";
    private const string ReleasesUrl = "https://kro.run/docs/getting-started/Installation/";

    /// <summary>Gets the pinned KRO release version to install.</summary>
    public string Version => configuration["Kubernetes:KroVersion"] ?? "0.9.4";

    /// <summary>Gets the official KRO installation guide URL.</summary>
    public string DocumentationUrl => ReleasesUrl;

    /// <summary>Applies KRO's official release manifest using Kubernetes server-side apply.</summary>
    public async Task<KroInstallationResult> InstallAsync(CancellationToken cancellationToken)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(Version, @"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$"))
        {
            throw new InvalidOperationException("The configured KRO version is not a valid release version.");
        }

        ClusterCapabilities capabilities = await connectionService.GetCapabilitiesAsync(cancellationToken).ConfigureAwait(false);
        if (!capabilities.ClusterApiAvailable)
        {
            throw new InvalidOperationException("Kubernetes API discovery is unavailable. Check cluster connectivity and API discovery permissions before installing KRO.");
        }
        if (capabilities.KroApiAvailable)
        {
            return new KroInstallationResult(true, Version, 0, "KRO is already available in this cluster.");
        }

        Kubernetes kubernetes = clientFactory.GetClient();
        using HttpClient downloads = new() { Timeout = TimeSpan.FromSeconds(30) };
        using HttpResponseMessage download = await downloads.GetAsync(string.Format(ManifestUrl, Version), cancellationToken).ConfigureAwait(false);
        if (!download.IsSuccessStatusCode)
        {
            throw new HttpRequestException("The official KRO release manifest could not be downloaded.", null, download.StatusCode);
        }

        string manifest = await download.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        YamlStream stream = new();
        using (StringReader reader = new(manifest)) stream.Load(reader);
        if (stream.Documents.Count == 0)
        {
            throw new InvalidOperationException("The official KRO release manifest was empty.");
        }

        try
        {
            await kubernetes.CoreV1.CreateNamespaceAsync(new k8s.Models.V1Namespace { Metadata = new k8s.Models.V1ObjectMeta { Name = "kro-system" } }, cancellationToken: cancellationToken).ConfigureAwait(false);
        }
        catch (KubernetesException exception) when (exception.Status?.Code == 409)
        {
            // The namespace is already present.
        }

        Dictionary<string, IReadOnlyDictionary<string, ApiResource>> discovery = new(StringComparer.Ordinal);
        int applied = 0;
        foreach (YamlDocument document in stream.Documents)
        {
            if (document.RootNode is not YamlMappingNode root) continue;
            string apiVersion = Scalar(root, "apiVersion");
            string kind = Scalar(root, "kind");
            string name = NestedScalar(root, "metadata", "name");
            string ns = NestedScalar(root, "metadata", "namespace");
            if (string.IsNullOrWhiteSpace(apiVersion) || string.IsNullOrWhiteSpace(kind) || string.IsNullOrWhiteSpace(name))
            {
                throw new InvalidOperationException("The official KRO manifest contains an object without apiVersion, kind, or metadata.name.");
            }

            string[] apiParts = apiVersion.Split('/', 2);
            string group = apiParts.Length == 2 ? apiParts[0] : string.Empty;
            string version = apiParts.Length == 2 ? apiParts[1] : apiParts[0];
            string key = $"{group}/{version}";
            if (!discovery.TryGetValue(key, out IReadOnlyDictionary<string, ApiResource>? resources))
            {
                if (group.Length == 0)
                {
                    throw new InvalidOperationException("The KRO release manifest contains an unsupported core API object.");
                }
                resources = await DiscoverAsync(kubernetes, group, version, cancellationToken).ConfigureAwait(false);
                discovery.Add(key, resources);
            }

            ApiResource? resource = resources.Values.FirstOrDefault(item => item.Kind == kind);
            if (resource is null)
            {
                throw new InvalidOperationException($"Kubernetes API discovery did not find the {kind} resource required by the KRO manifest.");
            }
            if (resource.Namespaced && string.IsNullOrWhiteSpace(ns))
            {
                throw new InvalidOperationException($"The KRO manifest did not specify a namespace for {kind}/{name}.");
            }

            using StringWriter yamlWriter = new();
            new YamlStream(new[] { document }).Save(yamlWriter, assignAnchors: false);

            object patch = new V1Patch(ToJson(document.RootNode), V1Patch.PatchType.ApplyPatch);
            
            if (resource.Namespaced)
            {
                await kubernetes.CustomObjects.PatchNamespacedCustomObjectAsync(patch, group, version, ns, resource.Name, name, fieldManager: "kro-studio", cancellationToken: cancellationToken).ConfigureAwait(false);
            }
            else
            {
                await kubernetes.CustomObjects.PatchClusterCustomObjectAsync(patch, group, version, resource.Name, name, fieldManager: "kro-studio", cancellationToken: cancellationToken).ConfigureAwait(false);
            }
            applied++;
        }

        return new KroInstallationResult(false, Version, applied, $"Applied {applied} KRO resources. The controller is starting; refresh cluster status in a few moments.");
    }

    private static async Task<IReadOnlyDictionary<string, ApiResource>> DiscoverAsync(Kubernetes client, string group, string version, CancellationToken cancellationToken)
    {
        object response = await client.CustomObjects.GetAPIResourcesAsync(group, version, cancellationToken).ConfigureAwait(false);
        using JsonDocument document = JsonDocument.Parse(KubernetesJson.Serialize(response));
        Dictionary<string, ApiResource> resources = new(StringComparer.Ordinal);
        foreach (JsonElement item in document.RootElement.GetProperty("resources").EnumerateArray())
        {
            if (item.TryGetProperty("name", out JsonElement name) && name.GetString()?.Contains('/', StringComparison.Ordinal) == true) continue;
            if (!item.TryGetProperty("kind", out JsonElement kind) || !item.TryGetProperty("namespaced", out JsonElement namespaced)) continue;
            string? plural = item.TryGetProperty("name", out JsonElement resourceName) ? resourceName.GetString() : null;
            if (plural is not null) resources[plural] = new ApiResource(plural, kind.GetString() ?? string.Empty, namespaced.GetBoolean());
        }
        return resources;
    }

    private static string Scalar(YamlMappingNode node, string key) => node.Children.TryGetValue(new YamlScalarNode(key), out YamlNode? value) && value is YamlScalarNode scalar ? scalar.Value ?? string.Empty : string.Empty;

    private static string NestedScalar(YamlMappingNode node, string parent, string key) => node.Children.TryGetValue(new YamlScalarNode(parent), out YamlNode? value) && value is YamlMappingNode mapping ? Scalar(mapping, key) : string.Empty;

    private sealed record ApiResource(string Name, string Kind, bool Namespaced);

    private static string ToJson(YamlNode node)
    {
        using MemoryStream ms = new();
        using (Utf8JsonWriter writer = new(ms)) WriteNode(writer, node);
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    private static void WriteNode(Utf8JsonWriter w, YamlNode node)
    {
        switch (node)
        {
            case YamlMappingNode map:
                w.WriteStartObject();
                foreach (KeyValuePair<YamlNode, YamlNode> pair in map.Children)
                {
                    w.WritePropertyName(((YamlScalarNode)pair.Key).Value ?? string.Empty);
                    WriteNode(w, pair.Value);
                }
                w.WriteEndObject();
                break;

            case YamlSequenceNode seq:
                w.WriteStartArray();
                foreach (YamlNode item in seq.Children) WriteNode(w, item);
                w.WriteEndArray();
                break;

            case YamlScalarNode scalar:
                WriteScalar(w, scalar);
                break;
        }
    }

    private static void WriteScalar(Utf8JsonWriter w, YamlScalarNode scalar)
    {
        string value = scalar.Value ?? string.Empty;

        // Quoted / block scalars are always strings.
        if (scalar.Style != ScalarStyle.Plain) { w.WriteStringValue(value); return; }

        if (value.Length == 0 || value is "~" or "null" or "Null" or "NULL") w.WriteNullValue();
        else if (value is "true" or "True" or "TRUE") w.WriteBooleanValue(true);
        else if (value is "false" or "False" or "FALSE") w.WriteBooleanValue(false);
        else if (long.TryParse(value, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out long l)) w.WriteNumberValue(l);
        else if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out double d) && double.IsFinite(d)) w.WriteNumberValue(d);
        else w.WriteStringValue(value);
    }
}

/// <summary>Summarizes the result of a KRO installation request.</summary>
/// <param name="AlreadyInstalled">Whether KRO was already detected before the request.</param>
/// <param name="Version">The configured KRO release version.</param>
/// <param name="ResourcesApplied">The number of manifest resources applied.</param>
/// <param name="Message">A user-safe status message.</param>
public sealed record KroInstallationResult(bool AlreadyInstalled, string Version, int ResourcesApplied, string Message);
