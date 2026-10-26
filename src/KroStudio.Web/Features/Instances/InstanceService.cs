using System.Text.Json;
using k8s;
using KroStudio.Web.Features.GeneratedApis;
using KroStudio.Web.Infrastructure.Kubernetes;

namespace KroStudio.Web.Features.Instances;

/// <summary>Reads and manages instances through dynamically discovered generated APIs.</summary>
public sealed class InstanceService(KubernetesClientFactory clientFactory, GeneratedApiResolver resolver)
{
    /// <summary>Lists one bounded page of instances and returns Kubernetes' continuation token.</summary>
    public async Task<InstancePage> ListAsync(string apiId, string? namespaceName, string? continueToken, CancellationToken cancellationToken)
    {
        GeneratedApiDescriptor api = await resolver.ResolveAsync(apiId, cancellationToken).ConfigureAwait(false);
        string? validNamespace = ResolveNamespace(api, namespaceName);
        Kubernetes client = clientFactory.GetClient();
        object raw = api.Namespaced
            ? await client.CustomObjects.ListNamespacedCustomObjectAsync(api.Group, api.Version, validNamespace!, api.Plural, continueParameter: continueToken, limit: 100, cancellationToken: cancellationToken).ConfigureAwait(false)
            : await client.CustomObjects.ListClusterCustomObjectAsync(api.Group, api.Version, api.Plural, continueParameter: continueToken, limit: 100, cancellationToken: cancellationToken).ConfigureAwait(false);
        using JsonDocument document = JsonDocument.Parse(KubernetesJson.Serialize(raw));
        JsonElement items = document.RootElement.GetProperty("items");
        string? next = document.RootElement.TryGetProperty("metadata", out JsonElement metadata) && metadata.TryGetProperty("continue", out JsonElement token) ? token.GetString() : null;
        return new InstancePage(items.Clone(), next);
    }

    /// <summary>Reads one generated resource instance.</summary>
    public async Task<JsonElement> GetAsync(string apiId, string name, string? namespaceName, CancellationToken cancellationToken)
    {
        GeneratedApiDescriptor api = await resolver.ResolveAsync(apiId, cancellationToken).ConfigureAwait(false);
        string? validNamespace = ResolveNamespace(api, namespaceName);
        Kubernetes client = clientFactory.GetClient();
        object raw = api.Namespaced
            ? await client.CustomObjects.GetNamespacedCustomObjectAsync(api.Group, api.Version, validNamespace!, api.Plural, name, cancellationToken).ConfigureAwait(false)
            : await client.CustomObjects.GetClusterCustomObjectAsync(api.Group, api.Version, api.Plural, name, cancellationToken).ConfigureAwait(false);
        return ToJson(raw);
    }

    /// <summary>Reads Kubernetes events associated with one instance in a selected namespace.</summary>
    public async Task<JsonElement> GetEventsAsync(string apiId, string name, string? namespaceName, CancellationToken cancellationToken)
    {
        GeneratedApiDescriptor api = await resolver.ResolveAsync(apiId, cancellationToken).ConfigureAwait(false);
        string eventNamespace = api.Namespaced ? ResolveNamespace(api, namespaceName)! : namespaceName ?? string.Empty;
        if (string.IsNullOrWhiteSpace(eventNamespace))
        {
            throw new ArgumentException("An event namespace is required when inspecting a cluster-scoped instance.", nameof(namespaceName));
        }
        JsonElement instance = await GetAsync(apiId, name, api.Namespaced ? eventNamespace : null, cancellationToken).ConfigureAwait(false);
        string? uid = instance.TryGetProperty("metadata", out JsonElement metadata) && metadata.TryGetProperty("uid", out JsonElement uidValue) ? uidValue.GetString() : null;
        if (string.IsNullOrWhiteSpace(uid))
        {
            throw new InvalidOperationException("Kubernetes did not return an instance UID, so related events cannot be resolved.");
        }
        Kubernetes client = clientFactory.GetClient();
        object raw = await client.CustomObjects.ListNamespacedCustomObjectAsync("", "v1", eventNamespace, "events", fieldSelector: $"involvedObject.uid={uid}", limit: 100, cancellationToken: cancellationToken).ConfigureAwait(false);
        return ToJson(raw);
    }

    /// <summary>Inspects only RGD-declared resource types and matches children by KRO's instance UID label.</summary>
    public async Task<ComposedResourcesInspection> GetComposedResourcesAsync(string apiId, string name, string? namespaceName, CancellationToken cancellationToken)
    {
        GeneratedApiDescriptor api = await resolver.ResolveAsync(apiId, cancellationToken).ConfigureAwait(false);
        JsonElement instance = await GetAsync(apiId, name, namespaceName, cancellationToken).ConfigureAwait(false);
        JsonElement instanceMetadata = instance.GetProperty("metadata");
        string? instanceUid = instanceMetadata.TryGetProperty("uid", out JsonElement uidValue) ? uidValue.GetString() : null;
        string? instanceNamespace = instanceMetadata.TryGetProperty("namespace", out JsonElement instanceNamespaceValue) ? instanceNamespaceValue.GetString() : null;
        if (string.IsNullOrWhiteSpace(instanceUid))
        {
            throw new InvalidOperationException("Kubernetes did not return an instance UID, so composed resources cannot be resolved.");
        }
        JsonElement definition = await resolver.GetDefinitionForApiAsync(api, cancellationToken).ConfigureAwait(false);
        if (!definition.TryGetProperty("spec", out JsonElement spec) || !spec.TryGetProperty("resources", out JsonElement declaredResources) || declaredResources.ValueKind != JsonValueKind.Array)
        {
            return new ComposedResourcesInspection([], [], true);
        }

        Kubernetes client = clientFactory.GetClient();
        List<ComposedResourceSummary> resources = [];
        List<string> warnings = [];
        HashSet<string> visitedResources = new(StringComparer.Ordinal);
        HashSet<string> visitedPods = new(StringComparer.Ordinal);
        foreach (JsonElement declared in declaredResources.EnumerateArray())
        {
            if (declared.TryGetProperty("externalRef", out _))
            {
                continue;
            }
            if (!declared.TryGetProperty("id", out JsonElement resourceIdValue) || !declared.TryGetProperty("template", out JsonElement template) ||
                !template.TryGetProperty("apiVersion", out JsonElement resourceApiVersionValue) || !template.TryGetProperty("kind", out JsonElement resourceKindValue))
            {
                warnings.Add("A declared resource is missing its id, template, API version, or kind and could not be inspected.");
                continue;
            }
            string resourceId = resourceIdValue.GetString() ?? "unknown";
            string resourceApiVersion = resourceApiVersionValue.GetString() ?? string.Empty;
            string resourceKind = resourceKindValue.GetString() ?? string.Empty;
            string resourceGroup = string.Empty;
            string resourceVersion = resourceApiVersion;
            if (resourceApiVersion.Contains('/', StringComparison.Ordinal))
            {
                string[] parts = resourceApiVersion.Split('/', 2);
                resourceGroup = parts[0];
                resourceVersion = parts[1];
            }
            string resourceKey = $"{resourceGroup}/{resourceVersion}/{resourceKind}";
            if (!visitedResources.Add(resourceKey))
            {
                continue;
            }
            if (resourceKind == "Secret")
            {
                warnings.Add($"The declared Secret resource '{resourceId}' was skipped; Secret contents are never returned.");
                continue;
            }
            try
            {
                object rawApiResources = await client.CustomObjects.GetAPIResourcesAsync(resourceGroup, resourceVersion, cancellationToken).ConfigureAwait(false);
                using JsonDocument discovery = JsonDocument.Parse(KubernetesJson.Serialize(rawApiResources));
                JsonElement discoveredResource = discovery.RootElement.GetProperty("resources").EnumerateArray()
                    .SingleOrDefault(item => item.GetProperty("kind").GetString() == resourceKind && !item.GetProperty("name").GetString()!.Contains('/', StringComparison.Ordinal));
                if (discoveredResource.ValueKind == JsonValueKind.Undefined)
                {
                    warnings.Add($"The declared resource type {resourceApiVersion}/{resourceKind} is not discoverable yet.");
                    continue;
                }
                string plural = discoveredResource.GetProperty("name").GetString()!;
                bool namespaced = discoveredResource.GetProperty("namespaced").GetBoolean();
                string? childNamespace = null;
                if (namespaced)
                {
                    string? declaredNamespace = template.TryGetProperty("metadata", out JsonElement templateMetadata) && templateMetadata.TryGetProperty("namespace", out JsonElement namespaceValue)
                        ? namespaceValue.GetString()
                        : null;
                    childNamespace = !string.IsNullOrWhiteSpace(declaredNamespace) && !declaredNamespace.Contains("${", StringComparison.Ordinal)
                        ? declaredNamespace
                        : instanceNamespace ?? namespaceName;
                    if (string.IsNullOrWhiteSpace(childNamespace))
                    {
                        warnings.Add($"A namespace could not be resolved for declared resource '{resourceId}'.");
                        continue;
                    }
                }
                object rawChildren = namespaced
                    ? await client.CustomObjects.ListNamespacedCustomObjectAsync(resourceGroup, resourceVersion, childNamespace!, plural, labelSelector: $"kro.run/instance-id={instanceUid}", limit: 100, cancellationToken: cancellationToken).ConfigureAwait(false)
                    : await client.CustomObjects.ListClusterCustomObjectAsync(resourceGroup, resourceVersion, plural, labelSelector: $"kro.run/instance-id={instanceUid}", limit: 100, cancellationToken: cancellationToken).ConfigureAwait(false);
                using JsonDocument childDocument = JsonDocument.Parse(KubernetesJson.Serialize(rawChildren));
                foreach (JsonElement child in childDocument.RootElement.GetProperty("items").EnumerateArray())
                {
                    JsonElement childObject = child.Clone();
                    resources.Add(new ComposedResourceSummary(resourceId, childObject));
                    if (namespaced && resourceKind is "Deployment" or "StatefulSet" or "DaemonSet" or "ReplicaSet" or "Job" &&
                        child.TryGetProperty("metadata", out JsonElement childMetadata) && childMetadata.TryGetProperty("name", out JsonElement childNameValue) &&
                        child.TryGetProperty("spec", out JsonElement childSpec) && childSpec.TryGetProperty("selector", out JsonElement selector) &&
                        selector.TryGetProperty("matchLabels", out JsonElement matchLabels) && matchLabels.ValueKind == JsonValueKind.Object)
                    {
                        string selectorText = string.Join(',', matchLabels.EnumerateObject().Select(label => $"{label.Name}={label.Value.GetString()}"));
                        if (selectorText.Length > 0)
                        {
                            try
                            {
                                var pods = await client.CoreV1.ListNamespacedPodAsync(childNamespace!, labelSelector: selectorText, limit: 50, cancellationToken: cancellationToken).ConfigureAwait(false);
                                foreach (var pod in pods.Items)
                                {
                                    string podKey = $"{childNamespace}/{pod.Metadata.Name}";
                                    if (visitedPods.Add(podKey))
                                    {
                                        resources.Add(new ComposedResourceSummary(resourceId, ToJson(pod), childNameValue.GetString()));
                                    }
                                }
                                JsonElement podList = ToJson(pods);
                                if (podList.TryGetProperty("metadata", out JsonElement podListMetadata) && podListMetadata.TryGetProperty("continue", out JsonElement podContinue) && !string.IsNullOrWhiteSpace(podContinue.GetString()))
                                {
                                    warnings.Add($"Pod results for composed workload '{childNameValue.GetString()}' exceed one page; only the first 50 Pods are shown.");
                                }
                            }
                            catch (k8s.KubernetesException exception) when (exception.Status?.Code == 403)
                            {
                                warnings.Add($"Permission denied while listing Pods for composed workload '{childNameValue.GetString()}'.");
                            }
                        }
                    }
                }
                if (childDocument.RootElement.TryGetProperty("metadata", out JsonElement listMetadata) && listMetadata.TryGetProperty("continue", out JsonElement continueValue) && !string.IsNullOrWhiteSpace(continueValue.GetString()))
                {
                    warnings.Add($"Results for declared resource '{resourceId}' exceed one page. Refine the view or request the next page through Kubernetes discovery.");
                }
            }
            catch (k8s.KubernetesException exception) when (exception.Status?.Code == 403)
            {
                warnings.Add($"Permission denied while inspecting declared resource type {resourceApiVersion}/{resourceKind}; its instances are omitted.");
            }
            catch (k8s.KubernetesException exception) when (exception.Status?.Code == 404)
            {
                warnings.Add($"Declared resource type {resourceApiVersion}/{resourceKind} is not available in discovery yet.");
            }
        }
        return new ComposedResourcesInspection(resources, warnings, warnings.Count == 0);
    }

    /// <summary>Reads recent logs from a composed Pod or the Pods selected by a composed workload.</summary>
    public async Task<IReadOnlyList<ResourceLogEntry>> GetResourceLogsAsync(string apiId, string instanceName, string resourceName, string? namespaceName, CancellationToken cancellationToken)
    {
        JsonElement instance = await GetAsync(apiId, instanceName, namespaceName, cancellationToken).ConfigureAwait(false);
        string? instanceNamespace = instance.TryGetProperty("metadata", out JsonElement instanceMetadata) && instanceMetadata.TryGetProperty("namespace", out JsonElement instanceNamespaceValue)
            ? instanceNamespaceValue.GetString()
            : namespaceName;
        ComposedResourcesInspection inspection = await GetComposedResourcesAsync(apiId, instanceName, namespaceName, cancellationToken).ConfigureAwait(false);
        JsonElement resource = inspection.Resources.Select(entry => entry.Object)
            .FirstOrDefault(item => item.TryGetProperty("metadata", out JsonElement metadata) && metadata.TryGetProperty("name", out JsonElement nameValue) && nameValue.GetString() == resourceName);
        if (resource.ValueKind != JsonValueKind.Object)
        {
            throw new KeyNotFoundException($"Composed resource '{resourceName}' was not found for this instance.");
        }

        string kind = resource.TryGetProperty("kind", out JsonElement kindValue) ? kindValue.GetString() ?? string.Empty : string.Empty;
        string? resourceNamespace = resource.TryGetProperty("metadata", out JsonElement metadataValue) && metadataValue.TryGetProperty("namespace", out JsonElement resourceNamespaceValue)
            ? resourceNamespaceValue.GetString()
            : instanceNamespace;
        if (string.IsNullOrWhiteSpace(resourceNamespace))
        {
            return [];
        }

        List<string> podNames = [];
        if (kind == "Pod")
        {
            if (resource.TryGetProperty("metadata", out JsonElement podMetadata) && podMetadata.TryGetProperty("name", out JsonElement podName))
            {
                podNames.Add(podName.GetString() ?? string.Empty);
            }
        }
        else if (kind is "Deployment" or "StatefulSet" or "DaemonSet" or "ReplicaSet" or "Job" &&
                 resource.TryGetProperty("spec", out JsonElement resourceSpec) && resourceSpec.TryGetProperty("selector", out JsonElement selector) &&
                 selector.TryGetProperty("matchLabels", out JsonElement matchLabels) && matchLabels.ValueKind == JsonValueKind.Object)
        {
            string selectorText = string.Join(',', matchLabels.EnumerateObject().Select(label => $"{label.Name}={label.Value.GetString()}"));
            if (selectorText.Length > 0)
            {
                Kubernetes client = clientFactory.GetClient();
                var pods = await client.CoreV1.ListNamespacedPodAsync(resourceNamespace, labelSelector: selectorText, limit: 50, cancellationToken: cancellationToken).ConfigureAwait(false);
                podNames.AddRange(pods.Items.Select(pod => pod.Metadata.Name));
            }
        }

        if (podNames.Count == 0)
        {
            return [];
        }
        Kubernetes kubernetes = clientFactory.GetClient();
        List<ResourceLogEntry> logs = [];
        foreach (string podName in podNames.Where(name => !string.IsNullOrWhiteSpace(name)))
        {
            var pod = await kubernetes.CoreV1.ReadNamespacedPodAsync(podName, resourceNamespace, cancellationToken: cancellationToken).ConfigureAwait(false);
            foreach (var container in pod.Spec.Containers)
            {
                await using Stream output = await kubernetes.CoreV1.ReadNamespacedPodLogAsync(podName, resourceNamespace, container: container.Name, tailLines: 200, cancellationToken: cancellationToken).ConfigureAwait(false);
                using StreamReader reader = new(output);
                logs.Add(new ResourceLogEntry(podName, container.Name, await reader.ReadToEndAsync(cancellationToken).ConfigureAwait(false)));
            }
        }
        return logs;
    }

    /// <summary>Creates a generated resource instance.</summary>
    public async Task<JsonElement> CreateAsync(string apiId, JsonElement manifest, string? namespaceName, CancellationToken cancellationToken)
    {
        GeneratedApiDescriptor api = await resolver.ResolveAsync(apiId, cancellationToken).ConfigureAwait(false);
        string? validNamespace = ResolveNamespace(api, namespaceName, manifest);
        ValidateManifest(api, manifest, validNamespace);
        Kubernetes client = clientFactory.GetClient();
        object raw = api.Namespaced
            ? await client.CustomObjects.CreateNamespacedCustomObjectAsync(manifest, api.Group, api.Version, validNamespace!, api.Plural, cancellationToken: cancellationToken).ConfigureAwait(false)
            : await client.CustomObjects.CreateClusterCustomObjectAsync(manifest, api.Group, api.Version, api.Plural, cancellationToken: cancellationToken).ConfigureAwait(false);
        return ToJson(raw);
    }

    /// <summary>Replaces an instance while retaining Kubernetes resource-version conflict semantics.</summary>
    public async Task<JsonElement> UpdateAsync(string apiId, string name, JsonElement manifest, string? namespaceName, CancellationToken cancellationToken)
    {
        GeneratedApiDescriptor api = await resolver.ResolveAsync(apiId, cancellationToken).ConfigureAwait(false);
        string? validNamespace = ResolveNamespace(api, namespaceName, manifest);
        ValidateManifest(api, manifest, validNamespace);
        string bodyName = manifest.GetProperty("metadata").GetProperty("name").GetString()!;
        if (!string.Equals(name, bodyName, StringComparison.Ordinal))
        {
            throw new ArgumentException("The route name must match metadata.name in the manifest.", nameof(manifest));
        }
        Kubernetes client = clientFactory.GetClient();
        object raw = api.Namespaced
            ? await client.CustomObjects.ReplaceNamespacedCustomObjectAsync(manifest, api.Group, api.Version, validNamespace!, api.Plural, name, cancellationToken: cancellationToken).ConfigureAwait(false)
            : await client.CustomObjects.ReplaceClusterCustomObjectAsync(manifest, api.Group, api.Version, api.Plural, name, cancellationToken: cancellationToken).ConfigureAwait(false);
        return ToJson(raw);
    }

    /// <summary>Deletes one instance through the generated resource API.</summary>
    public async Task DeleteAsync(string apiId, string name, string? namespaceName, CancellationToken cancellationToken)
    {
        GeneratedApiDescriptor api = await resolver.ResolveAsync(apiId, cancellationToken).ConfigureAwait(false);
        string? validNamespace = ResolveNamespace(api, namespaceName);
        Kubernetes client = clientFactory.GetClient();
        if (api.Namespaced)
        {
            await client.CustomObjects.DeleteNamespacedCustomObjectAsync(api.Group, api.Version, validNamespace!, api.Plural, name, cancellationToken: cancellationToken).ConfigureAwait(false);
        }
        else
        {
            await client.CustomObjects.DeleteClusterCustomObjectAsync(api.Group, api.Version, api.Plural, name, cancellationToken: cancellationToken).ConfigureAwait(false);
        }
    }

    private static string? ResolveNamespace(GeneratedApiDescriptor api, string? namespaceName, JsonElement? manifest = null)
    {
        JsonElement metadata = manifest is { } body && body.TryGetProperty("metadata", out JsonElement bodyMetadata) ? bodyMetadata : default;
        string? bodyNamespace = metadata.ValueKind == JsonValueKind.Object && metadata.TryGetProperty("namespace", out JsonElement namespaceValue) ? namespaceValue.GetString() : null;
        if (!api.Namespaced)
        {
            if (!string.IsNullOrWhiteSpace(namespaceName) || !string.IsNullOrWhiteSpace(bodyNamespace))
            {
                throw new ArgumentException("A cluster-scoped API does not accept a namespace.", nameof(namespaceName));
            }
            return null;
        }
        if (!string.IsNullOrWhiteSpace(namespaceName) && !string.IsNullOrWhiteSpace(bodyNamespace) && namespaceName != bodyNamespace)
        {
            throw new ArgumentException("The requested namespace must match metadata.namespace in the manifest.", nameof(namespaceName));
        }
        string resolved = namespaceName ?? bodyNamespace ?? string.Empty;
        if (string.IsNullOrWhiteSpace(resolved))
        {
            throw new ArgumentException("A namespace is required for this generated API.", nameof(namespaceName));
        }
        return resolved;
    }

    private static void ValidateManifest(GeneratedApiDescriptor api, JsonElement manifest, string? namespaceName)
    {
        string expectedVersion = $"{api.Group}/{api.Version}";
        if (manifest.ValueKind != JsonValueKind.Object || !manifest.TryGetProperty("apiVersion", out JsonElement apiVersion) || apiVersion.GetString() != expectedVersion ||
            !manifest.TryGetProperty("kind", out JsonElement kind) || kind.GetString() != api.Kind ||
            !manifest.TryGetProperty("metadata", out JsonElement metadata) || !metadata.TryGetProperty("name", out JsonElement name) || string.IsNullOrWhiteSpace(name.GetString()) ||
            (api.Namespaced && metadata.TryGetProperty("namespace", out JsonElement manifestNamespace) && manifestNamespace.GetString() != namespaceName))
        {
            throw new ArgumentException("Manifest apiVersion, kind, metadata.name, and scope must match the discovered generated API.", nameof(manifest));
        }
    }

    private static JsonElement ToJson(object value)
    {
        using JsonDocument document = JsonDocument.Parse(KubernetesJson.Serialize(value));
        return document.RootElement.Clone();
    }
}

/// <summary>A page of generated custom resource instances.</summary>
/// <param name="Items">The objects returned by Kubernetes.</param>
/// <param name="Continue">An opaque Kubernetes continuation token for the next page.</param>
public sealed record InstancePage(JsonElement Items, string? Continue);

/// <summary>A declared KRO resource and its matching live object.</summary>
/// <param name="ResourceId">The resource id declared by the RGD.</param>
/// <param name="Object">The Kubernetes object carrying the matching kro.run/instance-id label.</param>
/// <param name="ParentResourceName">The composed workload name when this entry is a Pod discovered from that workload.</param>
public sealed record ComposedResourceSummary(string ResourceId, JsonElement Object, string? ParentResourceName = null);

/// <summary>Read-only composed resource results with explicit partial-inspection warnings.</summary>
/// <param name="Resources">The children returned by Kubernetes.</param>
/// <param name="Warnings">Reasons some declared resource types may be missing.</param>
/// <param name="Complete">Whether all declared types were inspected without warnings.</param>
public sealed record ComposedResourcesInspection(IReadOnlyList<ComposedResourceSummary> Resources, IReadOnlyList<string> Warnings, bool Complete);

/// <summary>Recent log output for one container.</summary>
public sealed record ResourceLogEntry(string PodName, string Container, string Text);
