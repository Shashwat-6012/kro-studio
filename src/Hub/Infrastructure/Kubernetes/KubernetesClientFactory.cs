using k8s;
using System.Collections.Concurrent;
using System.Security.Claims;

namespace KroStudio.Web.Infrastructure.Kubernetes;

/// <summary>Creates one Kubernetes client from runtime kubeconfig configuration.</summary>
public sealed class KubernetesClientFactory
{
    private readonly Lazy<k8s.Kubernetes> serviceAccountClient;
    private readonly IConfiguration appConfiguration;
    private readonly IHttpContextAccessor httpContextAccessor;
    private readonly ConcurrentDictionary<string, k8s.Kubernetes> impersonatedClients = new(StringComparer.Ordinal);

    /// <summary>Initializes a client factory using KUBECONFIG or the standard default config.</summary>
    public KubernetesClientFactory(IConfiguration configuration, IHttpContextAccessor httpContextAccessor)
    {
        appConfiguration = configuration;
        this.httpContextAccessor = httpContextAccessor;
        serviceAccountClient = new Lazy<k8s.Kubernetes>(() => CreateClient(null), LazyThreadSafetyMode.ExecutionAndPublication);
    }

    /// <summary>Gets the selected kubeconfig context without exposing credentials.</summary>
    public string? CurrentContext { get; private set; }

    /// <summary>Returns the shared Kubernetes API client.</summary>
    public string AuthMode => appConfiguration["Kubernetes:AuthMode"] ?? "serviceAccount";

    /// <summary>
    /// Returns the configured prefix for OIDC usernames and groups, which is prepended to the username and group claims when impersonating a user.
    /// </summary>
    public string userPrefix => appConfiguration["UserAuth:Oidc:UsernamePrefix"] ?? "oidc";
    
    /// <summary>
    /// Returns the configured prefix for OIDC usernames and groups, which is prepended to the username and group claims when impersonating a user.
    /// </summary>
    public string groupPrefix => appConfiguration["UserAuth:Oidc:GroupsPrefix"]   ?? "oidc";

    /// <summary>Returns the configured service-account client or an OIDC-user impersonating client for this request.</summary>
    public k8s.Kubernetes GetClient()
    {
        if (AuthMode.Equals("serviceAccount", StringComparison.OrdinalIgnoreCase)) return serviceAccountClient.Value;
        if (!AuthMode.Equals("impersonation", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Kubernetes:AuthMode must be 'impersonation' or 'serviceAccount'.");
        ClaimsPrincipal? user = httpContextAccessor.HttpContext?.User;
        if (user?.Identity?.IsAuthenticated != true) throw new InvalidOperationException("An authenticated OIDC user is required for Kubernetes impersonation.");
        string userClaim = appConfiguration["UserAuth:Oidc:UsernameClaim"] ?? "preferred_username";
        string? username = user.FindFirst(userClaim)?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrWhiteSpace(username)) throw new InvalidOperationException($"The authenticated identity does not contain the configured username claim '{userClaim}'.");
        string groupClaim = appConfiguration["UserAuth:Oidc:GroupsClaim"] ?? "groups";
        string[] groups = user.FindAll(groupClaim).Select(c => c.Value).Distinct(StringComparer.Ordinal).ToArray();

        string impersonatedUser = userPrefix + ":" + username;
        string[] impersonatedGroups = groups
            .Select(g => groupPrefix + ":" + g)
            .Order(StringComparer.Ordinal)
            .ToArray();

        if (impersonatedUser.StartsWith("system:", StringComparison.Ordinal)
            || impersonatedGroups.Any(g => g.StartsWith("system:", StringComparison.Ordinal)))
            throw new UnauthorizedAccessException("Identities starting with 'system:' cannot be impersonated.");
        
        string key = impersonatedUser + "\n" + string.Join("\n", impersonatedGroups);
        return impersonatedClients.GetOrAdd(key, _ => CreateClient(new ImpersonationHandler(impersonatedUser, impersonatedGroups)));
    }

    private k8s.Kubernetes CreateClient(DelegatingHandler? impersonationHandler)
    {
        string? kubeconfigPath = Environment.GetEnvironmentVariable("KUBECONFIG") ?? appConfiguration["Kubernetes:KubeconfigPath"];
        string? context = Environment.GetEnvironmentVariable("KUBECONTEXT") ?? appConfiguration["Kubernetes:Context"];
        bool inCluster = bool.TryParse(appConfiguration["Kubernetes:InCluster"], out bool configuredInCluster) && configuredInCluster;
        if (inCluster && !string.IsNullOrWhiteSpace(kubeconfigPath)) throw new InvalidOperationException("Kubernetes:InCluster cannot be combined with KUBECONFIG or Kubernetes:KubeconfigPath.");
        if (inCluster && impersonationHandler is not null) throw new InvalidOperationException("Kubernetes impersonation must use a configured kubeconfig credential, not an in-cluster service account.");
        if (!inCluster && string.IsNullOrWhiteSpace(kubeconfigPath) && !File.Exists(KubernetesClientConfiguration.KubeConfigDefaultLocation))
        {
            throw new FileNotFoundException("No kubeconfig was supplied and no default kubeconfig file was found.", KubernetesClientConfiguration.KubeConfigDefaultLocation);
        }

        KubernetesClientConfiguration configuration = inCluster
            ? KubernetesClientConfiguration.InClusterConfig()
            : string.IsNullOrWhiteSpace(kubeconfigPath)
                ? KubernetesClientConfiguration.BuildConfigFromConfigFile(currentContext: context)
                : KubernetesClientConfiguration.BuildConfigFromConfigFile(kubeconfigPath, currentContext: context);
        configuration.HttpClientTimeout = TimeSpan.FromSeconds(5);
        CurrentContext = configuration.CurrentContext;
        if (impersonationHandler is null) return new k8s.Kubernetes(configuration);
        return new k8s.Kubernetes(configuration, impersonationHandler);
    }

    private sealed class ImpersonationHandler(string username, IReadOnlyList<string> groups) : DelegatingHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            request.Headers.TryAddWithoutValidation("Impersonate-User", username);
            foreach (string group in groups) request.Headers.TryAddWithoutValidation("Impersonate-Group", group);
            return base.SendAsync(request, cancellationToken);
        }
    }
}
