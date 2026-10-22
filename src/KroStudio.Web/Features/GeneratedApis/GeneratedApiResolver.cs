using System.Text.Json;
using k8s;
using KroStudio.Web.Infrastructure.Kubernetes;

namespace KroStudio.Web.Features.GeneratedApis;

/// <summary>Resolves an RGD to a live generated custom resource API using Kubernetes discovery.</summary>
public sealed class GeneratedApiResolver(KubernetesClientFactory clientFactory)
{
    /// <summary>Finds the served custom resource matching the kind and group declared by an RGD.</summary>
    public async Task<GeneratedApiDescriptor> ResolveForDefinitionAsync(string name, CancellationToken cancellationToken)
    {
        Kubernetes client = clientFactory.GetClient();
        object rawDefinition = await client.CustomObjects.GetClusterCustomObjectAsync("kro.run", "v1alpha1", "resourcegraphdefinitions", name, cancellationToken: cancellationToken).ConfigureAwait(false);
        using JsonDocument definition = JsonDocument.Parse(KubernetesJson.Serialize(rawDefinition));
        JsonElement schema = definition.RootElement.GetProperty("spec").GetProperty("schema");
        string kind = schema.GetProperty("kind").GetString() ?? throw new InvalidOperationException("The RGD does not declare a generated API kind.");
        string apiVersion = schema.GetProperty("apiVersion").GetString() ?? throw new InvalidOperationException("The RGD does not declare a generated API version.");
        string group = schema.TryGetProperty("group", out JsonElement groupValue) ? groupValue.GetString() ?? string.Empty : string.Empty;
        if (string.IsNullOrWhiteSpace(group) && apiVersion.Contains('/', StringComparison.Ordinal))
        {
            string[] versionParts = apiVersion.Split('/', 2);
            group = versionParts[0];
            apiVersion = versionParts[1];
        }
        if (string.IsNullOrWhiteSpace(group))
        {
            group = "kro.run";
        }

        object rawResources = await client.CustomObjects.GetAPIResourcesAsync(group, apiVersion, cancellationToken).ConfigureAwait(false);
        using JsonDocument discovery = JsonDocument.Parse(KubernetesJson.Serialize(rawResources));
        JsonElement? match = discovery.RootElement.GetProperty("resources").EnumerateArray()
            .Where(static resource => !resource.GetProperty("name").GetString()!.Contains('/', StringComparison.Ordinal))
            .Where(resource => resource.GetProperty("kind").GetString() == kind)
            .Cast<JsonElement?>()
            .SingleOrDefault();
        if (match is null)
        {
            throw new InvalidOperationException($"Generated API {group}/{apiVersion}, kind {kind}, is not currently discoverable.");
        }
        JsonElement resource = match.Value;
        string plural = resource.GetProperty("name").GetString()!;
        bool namespaced = resource.GetProperty("namespaced").GetBoolean();
        string apiId = Encode(new GeneratedApiIdentity(group, apiVersion, plural, kind, namespaced));
        JsonElement? schemaDocument = await GetOpenApiSchemaAsync(client, group, apiVersion, plural, cancellationToken).ConfigureAwait(false);
        return new GeneratedApiDescriptor(apiId, group, apiVersion, plural, kind, namespaced, schemaDocument);
    }

    /// <summary>Validates and resolves an opaque API identifier against live Kubernetes discovery.</summary>
    public async Task<GeneratedApiDescriptor> ResolveAsync(string apiId, CancellationToken cancellationToken)
    {
        GeneratedApiIdentity identity = Decode(apiId);
        Kubernetes client = clientFactory.GetClient();
        object rawResources = await client.CustomObjects.GetAPIResourcesAsync(identity.Group, identity.Version, cancellationToken).ConfigureAwait(false);
        using JsonDocument discovery = JsonDocument.Parse(KubernetesJson.Serialize(rawResources));
        JsonElement resource = discovery.RootElement.GetProperty("resources").EnumerateArray()
            .SingleOrDefault(item => item.GetProperty("name").GetString() == identity.Plural && !identity.Plural.Contains('/', StringComparison.Ordinal));
        if (resource.ValueKind == JsonValueKind.Undefined || resource.GetProperty("kind").GetString() != identity.Kind || resource.GetProperty("namespaced").GetBoolean() != identity.Namespaced)
        {
            throw new InvalidOperationException("The generated API identifier is no longer available in Kubernetes discovery.");
        }
        JsonElement? schemaDocument = await GetOpenApiSchemaAsync(client, identity.Group, identity.Version, identity.Plural, cancellationToken).ConfigureAwait(false);
        GeneratedApiDescriptor descriptor = new(apiId, identity.Group, identity.Version, identity.Plural, identity.Kind, identity.Namespaced, schemaDocument);
        await GetDefinitionForApiAsync(descriptor, cancellationToken).ConfigureAwait(false);
        return descriptor;
    }

    /// <summary>Finds the single RGD declaring a discovered generated kind and group.</summary>
    public async Task<JsonElement> GetDefinitionForApiAsync(GeneratedApiDescriptor api, CancellationToken cancellationToken)
    {
        Kubernetes client = clientFactory.GetClient();
        object rawDefinitions = await client.CustomObjects.ListClusterCustomObjectAsync("kro.run", "v1alpha1", "resourcegraphdefinitions", cancellationToken: cancellationToken).ConfigureAwait(false);
        using JsonDocument definitions = JsonDocument.Parse(KubernetesJson.Serialize(rawDefinitions));
        List<JsonElement> matches = [];
        foreach (JsonElement definition in definitions.RootElement.GetProperty("items").EnumerateArray())
        {
            if (!definition.TryGetProperty("spec", out JsonElement spec) || !spec.TryGetProperty("schema", out JsonElement schema) ||
                !schema.TryGetProperty("kind", out JsonElement kind) || kind.GetString() != api.Kind)
            {
                continue;
            }
            string version = schema.TryGetProperty("apiVersion", out JsonElement versionValue) ? versionValue.GetString() ?? string.Empty : string.Empty;
            string group = schema.TryGetProperty("group", out JsonElement groupValue) ? groupValue.GetString() ?? string.Empty : string.Empty;
            if (version.Contains('/', StringComparison.Ordinal))
            {
                string[] parts = version.Split('/', 2);
                group = parts[0];
                version = parts[1];
            }
            if (group == api.Group && version == api.Version)
            {
                matches.Add(definition.Clone());
            }
        }
        return matches.Count switch
        {
            1 => matches[0],
            0 => throw new InvalidOperationException("No ResourceGraphDefinition declaring this generated API is visible to the configured Kubernetes identity."),
            _ => throw new InvalidOperationException("More than one ResourceGraphDefinition declares this generated API; composed-resource ownership is ambiguous.")
        };
    }

    /// <summary>Encodes the resolved API identity so browser routes never choose raw Kubernetes paths.</summary>
    public static string Encode(GeneratedApiIdentity identity)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(identity);
        return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    /// <summary>Decodes an API identifier and rejects malformed or incomplete identities.</summary>
    public static GeneratedApiIdentity Decode(string apiId)
    {
        try
        {
            string encoded = apiId.Replace('-', '+').Replace('_', '/');
            encoded += new string('=', (4 - encoded.Length % 4) % 4);
            GeneratedApiIdentity identity = JsonSerializer.Deserialize<GeneratedApiIdentity>(Convert.FromBase64String(encoded)) ?? throw new FormatException();
            if (string.IsNullOrWhiteSpace(identity.Group) || string.IsNullOrWhiteSpace(identity.Version) || string.IsNullOrWhiteSpace(identity.Plural) || string.IsNullOrWhiteSpace(identity.Kind))
            {
                throw new FormatException();
            }
            return identity;
        }
        catch (Exception exception) when (exception is FormatException or JsonException)
        {
            throw new ArgumentException("The generated API identifier is invalid.", nameof(apiId), exception);
        }
    }

    private static async Task<JsonElement?> GetOpenApiSchemaAsync(Kubernetes client, string group, string apiVersion, string plural, CancellationToken cancellationToken)
    {
        string crdName = $"{plural}.{group}";
        try
        {
            object rawCrd = await client.CustomObjects.GetClusterCustomObjectAsync("apiextensions.k8s.io", "v1", "customresourcedefinitions", crdName, cancellationToken: cancellationToken).ConfigureAwait(false);
            using JsonDocument crd = JsonDocument.Parse(KubernetesJson.Serialize(rawCrd));
            JsonElement crdRoot = crd.RootElement;
            if (crdRoot.TryGetProperty("status", out JsonElement status) && status.TryGetProperty("conditions", out JsonElement conditions) &&
                conditions.EnumerateArray().Any(static condition => condition.GetProperty("type").GetString() == "Established" && condition.GetProperty("status").GetString() == "True") &&
                crdRoot.TryGetProperty("spec", out JsonElement spec) && spec.TryGetProperty("versions", out JsonElement versions))
            {
                JsonElement matchingVersion = versions.EnumerateArray()
                    .SingleOrDefault(version => version.GetProperty("name").GetString() == apiVersion && version.GetProperty("served").GetBoolean());
                return matchingVersion.ValueKind != JsonValueKind.Undefined && matchingVersion.TryGetProperty("schema", out JsonElement schema) && schema.TryGetProperty("openAPIV3Schema", out JsonElement openApi)
                    ? openApi.Clone()
                    : null;
            }
            return null;
        }
        catch (k8s.KubernetesException exception) when (exception.Status?.Code == 404)
        {
            return null;
        }
    }
}

/// <summary>Resolved Kubernetes API identity.</summary>
/// <param name="Group">The API group.</param>
/// <param name="Version">The served API version.</param>
/// <param name="Plural">The discovered plural resource name.</param>
/// <param name="Kind">The discovered resource kind.</param>
/// <param name="Namespaced">Whether objects have namespace scope.</param>
public sealed record GeneratedApiIdentity(string Group, string Version, string Plural, string Kind, bool Namespaced);

/// <summary>Generated API information suitable for clients.</summary>
/// <param name="Id">Opaque API identity accepted by instance routes.</param>
/// <param name="Group">The API group.</param>
/// <param name="Version">The served API version.</param>
/// <param name="Plural">The discovered plural resource name.</param>
/// <param name="Kind">The discovered resource kind.</param>
/// <param name="Namespaced">Whether objects have namespace scope.</param>
/// <param name="Schema">The OpenAPI schema, when readable.</param>
public sealed record GeneratedApiDescriptor(string Id, string Group, string Version, string Plural, string Kind, bool Namespaced, JsonElement? Schema);
