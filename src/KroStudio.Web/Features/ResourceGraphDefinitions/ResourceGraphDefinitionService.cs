using System.Text.Json;
using k8s;
using KroStudio.Web.Infrastructure.Kubernetes;

namespace KroStudio.Web.Features.ResourceGraphDefinitions;

/// <summary>Manages cluster-scoped KRO ResourceGraphDefinitions.</summary>
public sealed class ResourceGraphDefinitionService(KubernetesClientFactory clientFactory)
{
    private const string ApiGroup = "kro.run";
    private const string ApiVersion = "v1alpha1";
    private const string ResourcePlural = "resourcegraphdefinitions";

    /// <summary>Lists definitions available to the configured Kubernetes identity.</summary>
    public async Task<IReadOnlyList<ResourceGraphDefinitionSummary>> ListAsync(CancellationToken cancellationToken)
    {
        Kubernetes client = clientFactory.GetClient();
        object response = await client.CustomObjects.ListClusterCustomObjectAsync(ApiGroup, ApiVersion, ResourcePlural, cancellationToken: cancellationToken).ConfigureAwait(false);
        using JsonDocument document = JsonDocument.Parse(KubernetesJson.Serialize(response));
        List<ResourceGraphDefinitionSummary> definitions = [];
        foreach (JsonElement item in document.RootElement.GetProperty("items").EnumerateArray())
        {
            definitions.Add(Summarize(item));
        }
        return definitions;
    }

    /// <summary>Reads a complete ResourceGraphDefinition manifest.</summary>
    public async Task<JsonElement> GetAsync(string name, CancellationToken cancellationToken)
    {
        Kubernetes client = clientFactory.GetClient();
        object response = await client.CustomObjects.GetClusterCustomObjectAsync(ApiGroup, ApiVersion, ResourcePlural, ValidateName(name), cancellationToken: cancellationToken).ConfigureAwait(false);
        return ToJson(response);
    }

    /// <summary>Validates manifest identity and asks the API server to perform a non-persisting dry run.</summary>
    public async Task<JsonElement> ValidateAsync(JsonElement manifest, bool update, CancellationToken cancellationToken)
    {
        ValidateManifest(manifest);
        Kubernetes client = clientFactory.GetClient();
        object response;
        if (update)
        {
            string name = manifest.GetProperty("metadata").GetProperty("name").GetString()!;
            if (!manifest.GetProperty("metadata").TryGetProperty("resourceVersion", out JsonElement resourceVersion) || resourceVersion.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(resourceVersion.GetString()))
            {
                throw new ArgumentException("An update preflight requires metadata.resourceVersion from the current Kubernetes object.", nameof(manifest));
            }
            response = await client.CustomObjects.ReplaceClusterCustomObjectAsync(manifest, ApiGroup, ApiVersion, ResourcePlural, name, dryRun: "All", cancellationToken: cancellationToken).ConfigureAwait(false);
        }
        else
        {
            response = await client.CustomObjects.CreateClusterCustomObjectAsync(manifest, ApiGroup, ApiVersion, ResourcePlural, dryRun: "All", cancellationToken: cancellationToken).ConfigureAwait(false);
        }
        return ToJson(response);
    }

    /// <summary>Creates a definition as a separate persistence operation.</summary>
    public async Task<JsonElement> CreateAsync(JsonElement manifest, CancellationToken cancellationToken)
    {
        ValidateManifest(manifest);
        Kubernetes client = clientFactory.GetClient();
        object response = await client.CustomObjects.CreateClusterCustomObjectAsync(manifest, ApiGroup, ApiVersion, ResourcePlural, cancellationToken: cancellationToken).ConfigureAwait(false);
        return ToJson(response);
    }

    /// <summary>Replaces a definition while preserving Kubernetes resource-version conflict handling.</summary>
    public async Task<JsonElement> UpdateAsync(string name, JsonElement manifest, CancellationToken cancellationToken)
    {
        string validatedName = ValidateName(name);
        ValidateManifest(manifest);
        string manifestName = manifest.GetProperty("metadata").GetProperty("name").GetString() ?? string.Empty;
        if (!string.Equals(validatedName, manifestName, StringComparison.Ordinal))
        {
            throw new ArgumentException("The route name must match metadata.name in the manifest.", nameof(manifest));
        }
        Kubernetes client = clientFactory.GetClient();
        object response = await client.CustomObjects.ReplaceClusterCustomObjectAsync(manifest, ApiGroup, ApiVersion, ResourcePlural, validatedName, cancellationToken: cancellationToken).ConfigureAwait(false);
        return ToJson(response);
    }

    /// <summary>Deletes one cluster-scoped definition.</summary>
    public async Task DeleteAsync(string name, CancellationToken cancellationToken)
    {
        Kubernetes client = clientFactory.GetClient();
        await client.CustomObjects.DeleteClusterCustomObjectAsync(ApiGroup, ApiVersion, ResourcePlural, ValidateName(name), cancellationToken: cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Converts an RGD manifest into a concise catalog summary.</summary>
    public static ResourceGraphDefinitionSummary Summarize(JsonElement item)
    {
        JsonElement metadata = item.GetProperty("metadata");
        string name = metadata.GetProperty("name").GetString() ?? "unknown";
        string apiVersion = item.TryGetProperty("apiVersion", out JsonElement apiVersionValue) ? apiVersionValue.GetString() ?? "kro.run/v1alpha1" : "kro.run/v1alpha1";
        string kind = item.TryGetProperty("kind", out JsonElement kindValue) ? kindValue.GetString() ?? "ResourceGraphDefinition" : "ResourceGraphDefinition";
        string? created = metadata.TryGetProperty("creationTimestamp", out JsonElement timestamp) ? timestamp.GetString() : null;
        string? generatedKind = TryGet(item, "spec", "schema", "kind");
        return new ResourceGraphDefinitionSummary(name, kind, apiVersion, generatedKind, Readiness(item), created);
    }

    /// <summary>Returns the resource definition name after validating it is present.</summary>
    public static string ValidateName(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("A resource name is required.", nameof(name));
        }
        return name;
    }

    private static void ValidateManifest(JsonElement manifest)
    {
        if (manifest.ValueKind != JsonValueKind.Object || !manifest.TryGetProperty("apiVersion", out JsonElement apiVersion) || apiVersion.GetString() != "kro.run/v1alpha1" ||
            !manifest.TryGetProperty("kind", out JsonElement kind) || kind.GetString() != "ResourceGraphDefinition" ||
            !manifest.TryGetProperty("metadata", out JsonElement metadata) || !metadata.TryGetProperty("name", out JsonElement name) || string.IsNullOrWhiteSpace(name.GetString()) ||
            !manifest.TryGetProperty("spec", out JsonElement spec) || spec.ValueKind != JsonValueKind.Object)
        {
            throw new ArgumentException("Manifest must be a kro.run/v1alpha1 ResourceGraphDefinition with metadata.name and an object spec.", nameof(manifest));
        }
    }

    private static JsonElement ToJson(object value)
    {
        using JsonDocument document = JsonDocument.Parse(KubernetesJson.Serialize(value));
        return document.RootElement.Clone();
    }

    private static string? TryGet(JsonElement element, string parentName, string childName, string propertyName)
    {
        return element.TryGetProperty(parentName, out JsonElement parent) && parent.TryGetProperty(childName, out JsonElement child) && child.TryGetProperty(propertyName, out JsonElement value)
            ? value.GetString()
            : null;
    }

    private static string Readiness(JsonElement item)
    {
        if (!item.TryGetProperty("status", out JsonElement status))
        {
            return "Processing";
        }
        if (status.TryGetProperty("conditions", out JsonElement conditions) && conditions.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement condition in conditions.EnumerateArray())
            {
                if (condition.TryGetProperty("type", out JsonElement type) && type.GetString() is "Ready" or "ConditionReady")
                {
                    if (!condition.TryGetProperty("status", out JsonElement value))
                    {
                        return "Processing";
                    }
                    return value.GetString() switch
                    {
                        "True" => "Ready",
                        "False" => "Failed",
                        _ => "Processing"
                    };
                }
            }
        }

        return status.TryGetProperty("state", out JsonElement state) && state.GetString() == "Inactive" ? "Failed" : "Processing";
    }
}

/// <summary>Summarizes an RGD for the catalog.</summary>
/// <param name="Name">The cluster-scoped RGD name.</param>
/// <param name="Kind">The Kubernetes resource kind.</param>
/// <param name="ApiVersion">The Kubernetes API version.</param>
/// <param name="GeneratedKind">The kind generated for instances, when declared.</param>
/// <param name="Readiness">The observed KRO readiness state.</param>
/// <param name="CreatedAt">The Kubernetes creation timestamp.</param>
public sealed record ResourceGraphDefinitionSummary(string Name, string Kind, string ApiVersion, string? GeneratedKind, string Readiness, string? CreatedAt);
