using System.Text.Json;
using System.Net;
using k8s;
using KroStudio.Web.Infrastructure.Kubernetes;

namespace KroStudio.Web.Features.RbacAdvisor;

/// <summary>Checks KRO Studio and KRO controller authorization and prepares explicit RBAC changes.</summary>
internal sealed class RbacAdvisorService(KubernetesClientFactory clientFactory)
{
    private const string AuthzGroup = "authorization.k8s.io";
    private const string AuthzVersion = "v1";
    private const string RbacGroup = "rbac.authorization.k8s.io";
    private const string RbacVersion = "v1";
    private const string KroNamespace = "kro-system";
    private const string KroServiceAccount = "kro";
    private const string ManagedLabel = "app.kro.run/managed-by";
    private const string ManagedValue = "kro-studio";

    private static readonly PermissionRequirement[] StudioRequirements =
    [
        new("Discover Kubernetes APIs", "get", "__nonresource__", "/api/v1", null),
        new("Discover KRO APIs", "get", "__nonresource__", "/apis/kro.run/v1alpha1", null),
        new("Read resource graphs", "list", "kro.run", "resourcegraphdefinitions", null),
        new("Read a resource graph", "get", "kro.run", "resourcegraphdefinitions", null),
        new("Validate or create a resource graph", "create", "kro.run", "resourcegraphdefinitions", null),
        new("Update a resource graph", "update", "kro.run", "resourcegraphdefinitions", null),
        new("Delete a resource graph", "delete", "kro.run", "resourcegraphdefinitions", null),
        new("Read CRD metadata", "get", "apiextensions.k8s.io", "customresourcedefinitions", null),
        new("Read instance events", "list", "", "events", "default"),
        new("Read KRO controller events", "list", "", "events", KroNamespace),
        new("Confirm KRO controller service account", "get", "", "serviceaccounts", KroNamespace),
        new("Inspect controller RBAC", "list", RbacGroup, "clusterrolebindings", null),
        new("Read controller RBAC", "get", RbacGroup, "clusterrolebindings", null),
        new("Inspect controller roles", "list", RbacGroup, "clusterroles", null),
        new("Read controller roles", "get", RbacGroup, "clusterroles", null),
        new("Inspect namespace role bindings", "list", RbacGroup, "rolebindings", null),
        new("Inspect namespace roles", "list", RbacGroup, "roles", null),
        new("Create controller roles", "create", RbacGroup, "clusterroles", null),
        new("Create controller role bindings", "create", RbacGroup, "clusterrolebindings", null)
    ];

    /// <summary>Checks the configured identity and, optionally, a selected RGD's controller requirements.</summary>
    public async Task<RbacAdvisorReport> CheckAsync(string? definitionName, string? instanceNamespace, CancellationToken cancellationToken)
    {
        Kubernetes client = clientFactory.GetClient();
        List<RbacFinding> studio = [];
        foreach (PermissionRequirement requirement in StudioRequirements)
        {
            studio.Add(await CheckSubjectAsync(client, requirement, null, cancellationToken).ConfigureAwait(false));
        }

        List<RbacFinding> controller = [];
        if (!string.IsNullOrWhiteSpace(definitionName))
        {
            try
            {
                JsonElement definition = await GetDefinitionAsync(client, definitionName, cancellationToken).ConfigureAwait(false);
                IReadOnlyList<PermissionRequirement> requirements = await GetControllerRequirementsAsync(client, definition, instanceNamespace, cancellationToken).ConfigureAwait(false);
                PermissionRequirement generated = requirements.First(static item => item.Label == "Watch generated instances");
                studio.AddRange(await CheckStudioGeneratedApiAsync(client, generated, instanceNamespace, cancellationToken).ConfigureAwait(false));
                foreach (PermissionRequirement requirement in requirements)
                {
                    RbacFinding finding = await CheckSubjectAsync(client, requirement, $"system:serviceaccount:{KroNamespace}:{KroServiceAccount}", cancellationToken).ConfigureAwait(false);
                    controller.Add(finding);
                }
                controller.AddRange(await FindObservedFailuresAsync(client, definition, cancellationToken).ConfigureAwait(false));
            }
            catch (Exception exception) when (exception is KubernetesException or k8s.Autorest.HttpOperationException or InvalidOperationException or KeyNotFoundException or JsonException)
            {
                controller.Add(new RbacFinding("controller", "Resolve controller requirements", "unknown", "—", "—", "—", instanceNamespace, SafeMessage(exception), "RGD/API discovery"));
            }
        }

        return new RbacAdvisorReport("configured kubeconfig identity", $"{KroNamespace}:{KroServiceAccount}", DateTimeOffset.UtcNow, studio, controller,
            "Allowed and denied are Kubernetes authorization review results. Unknown means Kubernetes could not complete that review, or static RBAC inspection lacked enough evidence. When SubjectAccessReview is unavailable, the advisor estimates grants from bindings; no matching rule is still unknown because another authorizer may grant access.");
    }

    /// <summary>Returns the exact objects that would be created for a selected RGD without changing the cluster.</summary>
    public async Task<RbacApplyPlan> PreviewControllerRbacAsync(string definitionName, string? instanceNamespace, CancellationToken cancellationToken)
    {
        Kubernetes client = clientFactory.GetClient();
        bool serviceAccountVerified = true;
        try
        {
            _ = await client.CustomObjects.GetNamespacedCustomObjectAsync("", "v1", KroNamespace, "serviceaccounts", KroServiceAccount, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception exception) when (GetKubernetesStatusCode(exception) == 404)
        {
            throw new InvalidOperationException($"The expected KRO service account {KroNamespace}:{KroServiceAccount} was not found. Install KRO or select its actual controller service account before preparing RBAC.");
        }
        catch (Exception exception) when (GetKubernetesStatusCode(exception) == 403)
        {
            serviceAccountVerified = false;
        }
        JsonElement definition = await GetDefinitionAsync(client, definitionName, cancellationToken).ConfigureAwait(false);
        IReadOnlyList<PermissionRequirement> requirements = await GetControllerRequirementsAsync(client, definition, instanceNamespace, cancellationToken).ConfigureAwait(false);
        string metadataName = definition.GetProperty("metadata").GetProperty("name").GetString()!;
        string suffix = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(metadataName))).ToLowerInvariant()[..8];
        string prefix = $"kro-studio-{Sanitize(metadataName)}-{suffix}";
        object clusterRole = BuildClusterRole($"{prefix}-controller", metadataName, requirements);
        object clusterRoleBinding = BuildClusterRoleBinding($"{prefix}-controller", $"{prefix}-controller", metadataName);
        (bool roleExists, bool roleManaged, bool roleMatches, bool roleInspectable) = await InspectExistingAsync(client, "clusterroles", $"{prefix}-controller", requirements, cancellationToken).ConfigureAwait(false);
        (bool bindingExists, bool bindingManaged, bool bindingMatches, bool bindingInspectable) = await InspectBindingAsync(client, $"{prefix}-controller", cancellationToken).ConfigureAwait(false);
        string planToken = CreatePlanToken(clusterRole, clusterRoleBinding);
        string subjectNote = serviceAccountVerified ? string.Empty : " The configured identity cannot read service accounts, so existence of kro-system:kro could not be confirmed; the binding target will still be exactly that subject.";
        string inspectNote = roleInspectable && bindingInspectable ? string.Empty : " Existing RBAC could not be fully inspected. Apply will use create operations only; Kubernetes will reject a name conflict, and the studio will not update existing objects. If a later create fails, an earlier object may already have been created. See the error and review the cluster before retrying.";
        return new RbacApplyPlan(metadataName, $"{KroNamespace}:{KroServiceAccount}", serviceAccountVerified, planToken, requirements,
            new PlannedRbacObject("ClusterRole", $"{prefix}-controller", clusterRole, roleExists, roleManaged, roleMatches, roleInspectable),
            new PlannedRbacObject("ClusterRoleBinding", $"{prefix}-controller", clusterRoleBinding, bindingExists, bindingManaged, bindingMatches, bindingInspectable),
            "This grants the KRO service account the listed verbs on the generated API and resource kinds in every namespace. Cluster-scoped resources are included only when the RGD declares them. Review the manifest before applying." + subjectNote + inspectNote);
    }

    /// <summary>Creates missing planned controller RBAC objects after the caller's explicit confirmation.</summary>
    public async Task<RbacApplyResult> ApplyControllerRbacAsync(string definitionName, string? instanceNamespace, bool confirmed, string planToken, CancellationToken cancellationToken)
    {
        if (!confirmed) throw new ArgumentException("Explicit confirmation is required before applying controller RBAC.", nameof(confirmed));
        RbacApplyPlan plan = await PreviewControllerRbacAsync(definitionName, instanceNamespace, cancellationToken).ConfigureAwait(false);
        if (!string.Equals(plan.PlanToken, planToken, StringComparison.Ordinal))
            throw new InvalidOperationException("The RGD or RBAC plan changed after review. Review the updated plan before applying.");
        if ((plan.ClusterRole.Exists && (!plan.ClusterRole.ManagedByStudio || !plan.ClusterRole.MatchesPlan)) ||
            (plan.ClusterRoleBinding.Exists && (!plan.ClusterRoleBinding.ManagedByStudio || !plan.ClusterRoleBinding.MatchesPlan)))
        {
            throw new InvalidOperationException("An RBAC object with the planned name already exists and does not match this studio-managed plan. No cluster changes were made.");
        }

        Kubernetes client = clientFactory.GetClient();
        List<string> created = [];
        if (!plan.ClusterRole.Exists)
        {
            await client.CustomObjects.CreateClusterCustomObjectAsync(plan.ClusterRole.Manifest, RbacGroup, RbacVersion, "clusterroles", cancellationToken: cancellationToken).ConfigureAwait(false);
            created.Add($"ClusterRole/{plan.ClusterRole.Name}");
        }
        if (!plan.ClusterRoleBinding.Exists)
        {
            await client.CustomObjects.CreateClusterCustomObjectAsync(plan.ClusterRoleBinding.Manifest, RbacGroup, RbacVersion, "clusterrolebindings", cancellationToken: cancellationToken).ConfigureAwait(false);
            created.Add($"ClusterRoleBinding/{plan.ClusterRoleBinding.Name}");
        }
        return new RbacApplyResult(created, created.Count == 0 ? "The matching controller RBAC objects already exist; no changes were made." : $"Created {created.Count} controller RBAC object(s). KRO can now retry reconciliation.");
    }

    private static async Task<RbacFinding> CheckSubjectAsync(Kubernetes client, PermissionRequirement requirement, string? subject, CancellationToken token)
    {
        if (requirement.ApiGroup == "*generated*") throw new InvalidOperationException("Generated resource requirements must be resolved first.");
        string resource = requirement.Resource;
        string group = requirement.ApiGroup;
        if (subject is null)
        {
            object review = new
            {
                apiVersion = $"{AuthzGroup}/{AuthzVersion}", kind = "SelfSubjectAccessReview",
                spec = requirement.ApiGroup == "__nonresource__"
                    ? (object)new { nonResourceAttributes = new { verb = requirement.Verb, path = requirement.Resource } }
                    : new { resourceAttributes = new { verb = requirement.Verb, group, resource, @namespace = requirement.Namespace } }
            };
            try
            {
                object raw = await client.CustomObjects.CreateClusterCustomObjectAsync(review, AuthzGroup, AuthzVersion, "selfsubjectaccessreviews", cancellationToken: token).ConfigureAwait(false);
                return ToFinding(raw, "studio", requirement, "self-subject review");
            }
            catch (KubernetesException exception)
            {
                return new RbacFinding("studio", requirement.Label, "unknown", requirement.Verb, DisplayGroup(group), resource, requirement.Namespace, exception.Status?.Message ?? "The API server could not evaluate this permission.", "self-subject review");
            }
        }

        object controllerReview = new
        {
            apiVersion = $"{AuthzGroup}/{AuthzVersion}", kind = "SubjectAccessReview",
            spec = new
            {
                user = subject,
                groups = new[] { "system:serviceaccounts", $"system:serviceaccounts:{KroNamespace}", "system:authenticated" },
                resourceAttributes = new { verb = requirement.Verb, group, resource, @namespace = requirement.Namespace }
            }
        };
        try
        {
            object raw = await client.CustomObjects.CreateClusterCustomObjectAsync(controllerReview, AuthzGroup, AuthzVersion, "subjectaccessreviews", cancellationToken: token).ConfigureAwait(false);
            return ToFinding(raw, "controller", requirement, "subject access review");
        }
        catch (Exception exception) when (GetKubernetesStatusCode(exception) is not null)
        {
            if (GetKubernetesStatusCode(exception) == 403)
                return await EstimateControllerGrantAsync(client, requirement, token).ConfigureAwait(false);
            return new RbacFinding("controller", requirement.Label, "unknown", requirement.Verb, DisplayGroup(group), resource, requirement.Namespace,
                "Kubernetes could not evaluate the controller service account. Review the Kubernetes response or check access to SubjectAccessReview.", "subject access review");
        }
    }

    private static async Task<RbacFinding> EstimateControllerGrantAsync(Kubernetes client, PermissionRequirement requirement, CancellationToken token)
    {
        try
        {
            Dictionary<string, JsonElement> clusterRoles = await ListObjectsAsync(client, "clusterroles", token).ConfigureAwait(false);
            Dictionary<string, JsonElement> roles = await ListObjectsAsync(client, "roles", token).ConfigureAwait(false);
            List<JsonElement> clusterBindings = (await ListObjectsAsync(client, "clusterrolebindings", token).ConfigureAwait(false)).Values.ToList();
            List<JsonElement> roleBindings = (await ListObjectsAsync(client, "rolebindings", token).ConfigureAwait(false)).Values.ToList();
            bool clusterGrant = clusterBindings.Any(binding =>
                SubjectMatchesController(binding) && binding.TryGetProperty("roleRef", out JsonElement roleRef) &&
                roleRef.GetProperty("kind").GetString() == "ClusterRole" && roleRef.TryGetProperty("name", out JsonElement name) &&
                clusterRoles.TryGetValue(name.GetString() ?? string.Empty, out JsonElement role) && RulesCover(role, [requirement]));
            bool namespacedGrant = requirement.Namespace is not null && roleBindings.Any(binding =>
                binding.TryGetProperty("metadata", out JsonElement metadata) && metadata.TryGetProperty("namespace", out JsonElement namespaceValue) && namespaceValue.GetString() == requirement.Namespace &&
                SubjectMatchesController(binding) && binding.TryGetProperty("roleRef", out JsonElement roleRef) && roleRef.TryGetProperty("name", out JsonElement name) &&
                (roleRef.GetProperty("kind").GetString() == "ClusterRole" && clusterRoles.TryGetValue(name.GetString() ?? string.Empty, out JsonElement clusterRole) && RulesCover(clusterRole, [requirement]) ||
                 roleRef.GetProperty("kind").GetString() == "Role" && roles.TryGetValue($"{requirement.Namespace}/{name.GetString()}", out JsonElement role) && RulesCover(role, [requirement])));
            bool allowed = clusterGrant || namespacedGrant;
            string scopeNote = requirement.Namespace is null ? "for cluster-wide scope" : $"in namespace {requirement.Namespace}";
            return new RbacFinding("controller", requirement.Label, allowed ? "allowed" : "unknown", requirement.Verb, DisplayGroup(requirement.ApiGroup), requirement.Resource, requirement.Namespace,
                allowed ? $"A matching RBAC binding grants this action {scopeNote}. This is a role-rule estimate; no SubjectAccessReview was available." : $"No matching binding was found {scopeNote}. Static inspection cannot prove denial or account for external authorizers.", "RBAC rule estimate");
        }
        catch (Exception exception) when (GetKubernetesStatusCode(exception) is not null)
        {
            return new RbacFinding("controller", requirement.Label, "unknown", requirement.Verb, DisplayGroup(requirement.ApiGroup), requirement.Resource, requirement.Namespace,
                GetKubernetesStatusCode(exception) == 403 ? "SubjectAccessReview is unavailable and the configured identity cannot read enough RBAC objects to estimate this grant." : "Controller RBAC could not be inspected.", "RBAC rule estimate");
        }
    }

    private static async Task<Dictionary<string, JsonElement>> ListObjectsAsync(Kubernetes client, string plural, CancellationToken token)
    {
        object raw = await client.CustomObjects.ListClusterCustomObjectAsync(RbacGroup, RbacVersion, plural, cancellationToken: token).ConfigureAwait(false);
        using JsonDocument document = JsonDocument.Parse(KubernetesJson.Serialize(raw));
        Dictionary<string, JsonElement> result = new(StringComparer.Ordinal);
        foreach (JsonElement item in document.RootElement.GetProperty("items").EnumerateArray())
        {
            string name = item.GetProperty("metadata").GetProperty("name").GetString()!;
            if (item.GetProperty("metadata").TryGetProperty("namespace", out JsonElement ns)) name = $"{ns.GetString()}/{name}";
            result[name] = item.Clone();
        }
        return result;
    }

    private static bool SubjectMatchesController(JsonElement binding)
    {
        if (!binding.TryGetProperty("subjects", out JsonElement subjects) || subjects.ValueKind != JsonValueKind.Array) return false;
        return subjects.EnumerateArray().Any(subject =>
        {
            string kind = subject.TryGetProperty("kind", out JsonElement kindValue) ? kindValue.GetString() ?? string.Empty : string.Empty;
            string name = subject.TryGetProperty("name", out JsonElement nameValue) ? nameValue.GetString() ?? string.Empty : string.Empty;
            string ns = subject.TryGetProperty("namespace", out JsonElement namespaceValue) ? namespaceValue.GetString() ?? string.Empty : string.Empty;
            return kind == "ServiceAccount" && name == KroServiceAccount && ns == KroNamespace ||
                   kind == "User" && name == $"system:serviceaccount:{KroNamespace}:{KroServiceAccount}" ||
                   kind == "Group" && name is "system:serviceaccounts" or "system:serviceaccounts:kro-system" or "system:authenticated";
        });
    }

    private static async Task<IReadOnlyList<RbacFinding>> CheckStudioGeneratedApiAsync(Kubernetes client, PermissionRequirement generated, string? selectedNamespace, CancellationToken token)
    {
        string? scope = generated.Namespace is null ? null : selectedNamespace;
        PermissionRequirement[] checks =
        [
            new("List generated instances", "list", generated.ApiGroup, generated.Resource, scope),
            new("Read generated instances", "get", generated.ApiGroup, generated.Resource, scope),
            new("Create generated instances", "create", generated.ApiGroup, generated.Resource, scope),
            new("Update generated instances", "update", generated.ApiGroup, generated.Resource, scope),
            new("Patch generated instances", "patch", generated.ApiGroup, generated.Resource, scope),
            new("Delete generated instances", "delete", generated.ApiGroup, generated.Resource, scope)
        ];
        List<RbacFinding> findings = [];
        foreach (PermissionRequirement check in checks) findings.Add(await CheckSubjectAsync(client, check, null, token).ConfigureAwait(false));
        return findings;
    }

    private static RbacFinding ToFinding(object response, string identity, PermissionRequirement requirement, string source)
    {
        using JsonDocument document = JsonDocument.Parse(KubernetesJson.Serialize(response));
        JsonElement root = document.RootElement;
        JsonElement status = root.TryGetProperty("status", out JsonElement value) ? value : default;
        bool completed = status.ValueKind == JsonValueKind.Object;
        bool allowed = status.ValueKind == JsonValueKind.Object && status.TryGetProperty("allowed", out JsonElement allow) && allow.GetBoolean();
        string evaluation = status.ValueKind == JsonValueKind.Object && status.TryGetProperty("evaluationError", out JsonElement evaluationValue) ? evaluationValue.GetString() ?? string.Empty : string.Empty;
        string state = !completed || evaluation.Length > 0 ? "unknown" : allowed ? "allowed" : "denied";
        string reason = status.ValueKind == JsonValueKind.Object && status.TryGetProperty("reason", out JsonElement reasonValue) ? reasonValue.GetString() ?? string.Empty : string.Empty;
        string detail = string.Join(" ", new[] { reason, evaluation }.Where(static item => !string.IsNullOrWhiteSpace(item)));
        string group = requirement.ApiGroup == "__nonresource__" ? "non-resource URL" : DisplayGroup(requirement.ApiGroup);
        if (detail.Length == 0) detail = state switch
        {
            "denied" => "Kubernetes authorization review did not allow this operation.",
            "unknown" => "Kubernetes did not return a complete authorization decision.",
            _ => "Authorization review completed."
        };
        return new RbacFinding(identity, requirement.Label, state, requirement.Verb, group, requirement.Resource, requirement.Namespace, detail, source);
    }

    private static async Task<JsonElement> GetDefinitionAsync(Kubernetes client, string name, CancellationToken token)
    {
        object raw = await client.CustomObjects.GetClusterCustomObjectAsync("kro.run", "v1alpha1", "resourcegraphdefinitions", name, cancellationToken: token).ConfigureAwait(false);
        using JsonDocument json = JsonDocument.Parse(KubernetesJson.Serialize(raw));
        return json.RootElement.Clone();
    }

    private static async Task<IReadOnlyList<PermissionRequirement>> GetControllerRequirementsAsync(Kubernetes client, JsonElement definition, string? instanceNamespace, CancellationToken token)
    {
        JsonElement schema = definition.GetProperty("spec").GetProperty("schema");
        string kind = schema.GetProperty("kind").GetString() ?? throw new InvalidOperationException("The RGD generated kind is missing.");
        string version = schema.GetProperty("apiVersion").GetString() ?? throw new InvalidOperationException("The RGD generated API version is missing.");
        string group = schema.TryGetProperty("group", out JsonElement groupValue) ? groupValue.GetString() ?? string.Empty : string.Empty;
        if (version.Contains('/', StringComparison.Ordinal)) { string[] parts = version.Split('/', 2); group = parts[0]; version = parts[1]; }
        if (string.IsNullOrWhiteSpace(group)) group = "kro.run";

        List<PermissionRequirement> results = [];
        JsonElement generatedResource = await FindApiResourceAsync(client, group, version, kind, token).ConfigureAwait(false);
        string generatedPlural = generatedResource.GetProperty("name").GetString()!;
        bool generatedNamespaced = generatedResource.GetProperty("namespaced").GetBoolean();
        string? generatedNamespace = generatedNamespaced ? instanceNamespace : null;
        results.Add(new PermissionRequirement("Watch generated instances", "list", group, generatedPlural, generatedNamespace));
        results.Add(new PermissionRequirement("Watch generated instances", "watch", group, generatedPlural, generatedNamespace));
        foreach (string verb in new[] { "get", "update", "patch" })
            results.Add(new PermissionRequirement("Update generated instance status", verb, group, $"{generatedPlural}/status", generatedNamespace));

        if (definition.GetProperty("spec").TryGetProperty("resources", out JsonElement resources) && resources.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement item in resources.EnumerateArray())
            {
                bool externalReference = item.TryGetProperty("externalRef", out JsonElement template);
                if (!externalReference && !item.TryGetProperty("template", out template))
                    throw new InvalidOperationException("An RGD resource entry is missing both template and externalRef; its controller permissions cannot be derived safely.");
                if (!template.TryGetProperty("apiVersion", out JsonElement apiValue) || !template.TryGetProperty("kind", out JsonElement kindValue))
                    throw new InvalidOperationException("An RGD resource template is missing apiVersion or kind; its controller permissions cannot be derived safely.");
                string templateVersion = apiValue.GetString() ?? string.Empty;
                string templateGroup = string.Empty;
                if (templateVersion.Contains('/', StringComparison.Ordinal)) { string[] parts = templateVersion.Split('/', 2); templateGroup = parts[0]; templateVersion = parts[1]; }
                JsonElement resource = await FindApiResourceAsync(client, templateGroup, templateVersion, kindValue.GetString()!, token).ConfigureAwait(false);
                string plural = resource.GetProperty("name").GetString()!;
                bool namespaced = resource.GetProperty("namespaced").GetBoolean();
                string? resourceNamespace = namespaced ? ReadTemplateNamespace(template, instanceNamespace) : null;
                string[] verbs = externalReference ? ["get", "list", "watch"] : ["get", "list", "watch", "create", "update", "patch", "delete"];
                foreach (string verb in verbs)
                    results.Add(new PermissionRequirement($"Reconcile {kindValue.GetString()}", verb, templateGroup, plural, resourceNamespace));
            }
        }
        return results.GroupBy(static item => $"{item.Verb}|{item.ApiGroup}|{item.Resource}|{item.Namespace}", StringComparer.Ordinal).Select(static groupItems => groupItems.First()).ToArray();
    }

    private static async Task<JsonElement> FindApiResourceAsync(Kubernetes client, string group, string version, string kind, CancellationToken token)
    {
        object raw = string.IsNullOrWhiteSpace(group)
            ? await client.CoreV1.GetAPIResourcesAsync(token).ConfigureAwait(false)
            : await client.CustomObjects.GetAPIResourcesAsync(group, version, token).ConfigureAwait(false);
        using JsonDocument document = JsonDocument.Parse(KubernetesJson.Serialize(raw));
        JsonElement? match = document.RootElement.GetProperty("resources").EnumerateArray()
            .Where(static item => !item.GetProperty("name").GetString()!.Contains('/', StringComparison.Ordinal))
            .Where(item => item.GetProperty("kind").GetString() == kind).Cast<JsonElement?>().SingleOrDefault();
        return match?.Clone() ?? throw new InvalidOperationException($"Could not resolve {group}/{version} kind {kind} through Kubernetes discovery.");
    }

    private static string? ReadTemplateNamespace(JsonElement template, string? selectedNamespace)
    {
        if (template.TryGetProperty("metadata", out JsonElement metadata) && metadata.TryGetProperty("namespace", out JsonElement value) && value.ValueKind == JsonValueKind.String && value.GetString() is { } namespaceValue && !namespaceValue.Contains("${", StringComparison.Ordinal))
            return namespaceValue;
        return selectedNamespace;
    }

    private static async Task<List<RbacFinding>> FindObservedFailuresAsync(Kubernetes client, JsonElement definition, CancellationToken token)
    {
        Dictionary<string, RbacFinding> findings = new(StringComparer.OrdinalIgnoreCase);
        if (definition.TryGetProperty("status", out JsonElement status) && status.TryGetProperty("conditions", out JsonElement conditions) && conditions.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement condition in conditions.EnumerateArray())
            {
                string message = condition.TryGetProperty("message", out JsonElement value) ? value.GetString() ?? string.Empty : string.Empty;
                AddObservedFinding(findings, message, "RGD condition", null);
            }
        }
        if (definition.TryGetProperty("metadata", out JsonElement metadata) && metadata.TryGetProperty("uid", out JsonElement uidValue) && !string.IsNullOrWhiteSpace(uidValue.GetString()))
        {
            try
            {
                object raw = await client.CustomObjects.ListNamespacedCustomObjectAsync("", "v1", KroNamespace, "events", fieldSelector: $"involvedObject.uid={uidValue.GetString()}", limit: 50, cancellationToken: token).ConfigureAwait(false);
                using JsonDocument events = JsonDocument.Parse(KubernetesJson.Serialize(raw));
                foreach (JsonElement item in events.RootElement.GetProperty("items").EnumerateArray())
                {
                    string message = item.TryGetProperty("message", out JsonElement eventMessage) ? eventMessage.GetString() ?? string.Empty : string.Empty;
                    string reason = item.TryGetProperty("reason", out JsonElement reasonValue) ? reasonValue.GetString() ?? "Controller event" : "Controller event";
                    AddObservedFinding(findings, message, "Kubernetes event", KroNamespace, reason);
                }
            }
            catch (Exception exception) when (GetKubernetesStatusCode(exception) is 403 or 404) { }
        }
        return findings.Values.ToList();
    }

    private static void AddObservedFinding(Dictionary<string, RbacFinding> findings, string message, string source, string? @namespace, string? eventReason = null)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        bool authorizationFailure = message.Contains("forbidden", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("permission denied", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("unauthorized", StringComparison.OrdinalIgnoreCase);
        bool cacheSyncIssue = message.Contains("cache sync", StringComparison.OrdinalIgnoreCase) ||
            message.Contains("informer sync", StringComparison.OrdinalIgnoreCase);
        if (!authorizationFailure && !cacheSyncIssue) return;

        string state = authorizationFailure ? "observed failure" : "observed issue";
        string check = authorizationFailure ? "Observed controller authorization failure" : "Controller cache sync issue";
        string detail = cacheSyncIssue && !authorizationFailure
            ? $"{Limit(message)} This timeout can follow denied list/watch access, but the timeout alone does not prove an RBAC denial. Review the list/watch checks above."
            : Limit(message);
        string key = $"{state}|{string.Concat(message.Where(static character => !char.IsWhiteSpace(character))).ToLowerInvariant()}";
        findings.TryAdd(key, new RbacFinding("controller", eventReason ?? check, state, "—", "—", "—", @namespace, detail, source));
    }
    private static string Limit(string value) => value.Length <= 500 ? value : value[..500] + "…";

    private static object BuildClusterRole(string name, string definitionName, IReadOnlyList<PermissionRequirement> requirements)
    {
        var rules = requirements.GroupBy(static item => $"{item.ApiGroup}|{item.Resource}", StringComparer.Ordinal).OrderBy(static group => group.Key, StringComparer.Ordinal).Select(group => new
        {
            apiGroups = new[] { group.First().ApiGroup }, resources = new[] { group.First().Resource },
            verbs = group.Select(static item => item.Verb).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToArray()
        }).ToArray();
        return new { apiVersion = $"{RbacGroup}/{RbacVersion}", kind = "ClusterRole", metadata = new { name, labels = new Dictionary<string, string> { [ManagedLabel] = ManagedValue, ["kro-studio.io/rgd"] = Sanitize(definitionName), ["rbac.kro.run/aggregate-to-controller"] = "true" } }, rules };
    }

    private static object BuildClusterRoleBinding(string name, string roleName, string definitionName) => new
    {
        apiVersion = $"{RbacGroup}/{RbacVersion}", kind = "ClusterRoleBinding",
        metadata = new { name, labels = new Dictionary<string, string> { [ManagedLabel] = ManagedValue, ["kro-studio.io/rgd"] = Sanitize(definitionName) } },
        subjects = new[] { new { kind = "ServiceAccount", name = KroServiceAccount, @namespace = KroNamespace } },
        roleRef = new { apiGroup = RbacGroup, kind = "ClusterRole", name = roleName }
    };

    private static string CreatePlanToken(object clusterRole, object clusterRoleBinding)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(new { clusterRole, clusterRoleBinding });
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();
    }

    private static async Task<(bool Exists, bool Managed, bool Matches, bool Inspectable)> InspectExistingAsync(Kubernetes client, string resource, string name, IReadOnlyList<PermissionRequirement> requirements, CancellationToken token)
    {
        try
        {
            object raw = await client.CustomObjects.GetClusterCustomObjectAsync(RbacGroup, RbacVersion, resource, name, cancellationToken: token).ConfigureAwait(false);
            using JsonDocument doc = JsonDocument.Parse(KubernetesJson.Serialize(raw));
            JsonElement root = doc.RootElement;
            bool managed = HasManagedLabel(root);
            bool matches = managed && RulesMatchPlanExactly(root, requirements);
            return (true, managed, matches, true);
        }
        catch (Exception exception) when (GetKubernetesStatusCode(exception) == 404) { return (false, false, false, true); }
        catch (Exception exception) when (GetKubernetesStatusCode(exception) == 403) { return (false, false, false, false); }
    }

    private static async Task<(bool Exists, bool Managed, bool Matches, bool Inspectable)> InspectBindingAsync(Kubernetes client, string name, CancellationToken token)
    {
        try
        {
            object raw = await client.CustomObjects.GetClusterCustomObjectAsync(RbacGroup, RbacVersion, "clusterrolebindings", name, cancellationToken: token).ConfigureAwait(false);
            using JsonDocument doc = JsonDocument.Parse(KubernetesJson.Serialize(raw));
            JsonElement root = doc.RootElement;
            bool managed = HasManagedLabel(root);
            bool matches = managed && root.TryGetProperty("subjects", out JsonElement subjects) && subjects.ValueKind == JsonValueKind.Array && subjects.GetArrayLength() == 1 && subjects.EnumerateArray().Any(static subject => subject.GetProperty("kind").GetString() == "ServiceAccount" && subject.GetProperty("name").GetString() == KroServiceAccount && subject.GetProperty("namespace").GetString() == KroNamespace) && root.TryGetProperty("roleRef", out JsonElement roleRef) && roleRef.GetProperty("kind").GetString() == "ClusterRole" && roleRef.GetProperty("name").GetString() == name;
            return (true, managed, matches, true);
        }
        catch (Exception exception) when (GetKubernetesStatusCode(exception) == 404) { return (false, false, false, true); }
        catch (Exception exception) when (GetKubernetesStatusCode(exception) == 403) { return (false, false, false, false); }
    }

    private static bool RulesCover(JsonElement role, IReadOnlyList<PermissionRequirement> requirements)
    {
        if (!role.TryGetProperty("rules", out JsonElement rules) || rules.ValueKind != JsonValueKind.Array) return false;
        foreach (PermissionRequirement req in requirements)
        {
            bool covered = rules.EnumerateArray().Any(rule => Contains(rule, "apiGroups", req.ApiGroup) && Contains(rule, "resources", req.Resource) && Contains(rule, "verbs", req.Verb));
            if (!covered) return false;
        }
        return true;
    }

    private static bool RulesMatchPlanExactly(JsonElement role, IReadOnlyList<PermissionRequirement> requirements)
    {
        if (!role.TryGetProperty("rules", out JsonElement rules) || rules.ValueKind != JsonValueKind.Array) return false;
        HashSet<string> expected = requirements.Select(static item => $"{item.ApiGroup}|{item.Resource}|{item.Verb}").ToHashSet(StringComparer.Ordinal);
        HashSet<string> actual = new(StringComparer.Ordinal);
        foreach (JsonElement rule in rules.EnumerateArray())
        {
            if (rule.TryGetProperty("resourceNames", out _) || !rule.TryGetProperty("apiGroups", out JsonElement groups) || !rule.TryGetProperty("resources", out JsonElement resources) || !rule.TryGetProperty("verbs", out JsonElement verbs)) return false;
            foreach (JsonElement group in groups.EnumerateArray())
            foreach (JsonElement resource in resources.EnumerateArray())
            foreach (JsonElement verb in verbs.EnumerateArray())
                actual.Add($"{group.GetString()}|{resource.GetString()}|{verb.GetString()}");
        }
        return actual.SetEquals(expected);
    }

    private static bool Contains(JsonElement rule, string property, string value) => rule.TryGetProperty(property, out JsonElement values) && values.ValueKind == JsonValueKind.Array && values.EnumerateArray().Any(item => item.GetString() is "*" || item.GetString() == value);
    private static bool HasManagedLabel(JsonElement root) => root.TryGetProperty("metadata", out JsonElement meta) && meta.TryGetProperty("labels", out JsonElement labels) && labels.TryGetProperty(ManagedLabel, out JsonElement value) && value.GetString() == ManagedValue;
    private static string DisplayGroup(string value) => value.Length == 0 ? "core" : value;
    private static string Sanitize(string value)
    {
        string sanitized = new string(value.ToLowerInvariant().Select(static character => char.IsAsciiLetterOrDigit(character) ? character : '-').ToArray()).Trim('-');
        return sanitized.Length > 32 ? sanitized[..32].TrimEnd('-') : sanitized;
    }
    private static int? GetKubernetesStatusCode(Exception exception) => exception switch
    {
        KubernetesException kubernetesException => kubernetesException.Status?.Code,
        k8s.Autorest.HttpOperationException httpException when httpException.Response is not null => (int)httpException.Response.StatusCode,
        _ => null
    };
    private static string SafeMessage(Exception exception) => GetKubernetesStatusCode(exception) == 403 ? "Kubernetes denied access needed to inspect this RGD or discover its resource permissions." : exception.Message;
}

internal sealed record PermissionRequirement(string Label, string Verb, string ApiGroup, string Resource, string? Namespace);
internal sealed record RbacFinding(string Identity, string Check, string Status, string Verb, string ApiGroup, string Resource, string? Namespace, string Detail, string Source);
internal sealed record RbacAdvisorReport(string StudioIdentity, string ControllerIdentity, DateTimeOffset CheckedAt, IReadOnlyList<RbacFinding> Studio, IReadOnlyList<RbacFinding> Controller, string Note);
internal sealed record PlannedRbacObject(string Kind, string Name, object Manifest, bool Exists, bool ManagedByStudio, bool MatchesPlan, bool Inspectable);
internal sealed record RbacApplyPlan(string DefinitionName, string ControllerIdentity, bool ServiceAccountVerified, string PlanToken, IReadOnlyList<PermissionRequirement> Requirements, PlannedRbacObject ClusterRole, PlannedRbacObject ClusterRoleBinding, string Impact);
internal sealed record RbacApplyResult(IReadOnlyList<string> Created, string Message);
