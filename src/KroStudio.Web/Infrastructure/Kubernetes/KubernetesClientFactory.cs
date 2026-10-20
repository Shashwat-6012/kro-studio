using k8s;

namespace KroStudio.Web.Infrastructure.Kubernetes;

/// <summary>Creates one Kubernetes client from runtime kubeconfig configuration.</summary>
public sealed class KubernetesClientFactory
{
    private readonly Lazy<k8s.Kubernetes> client;
    private readonly IConfiguration appConfiguration;

    /// <summary>Initializes a client factory using KUBECONFIG or the standard default config.</summary>
    public KubernetesClientFactory(IConfiguration configuration)
    {
        appConfiguration = configuration;
        client = new Lazy<k8s.Kubernetes>(CreateClient, LazyThreadSafetyMode.ExecutionAndPublication);
    }

    /// <summary>Gets the selected kubeconfig context without exposing credentials.</summary>
    public string? CurrentContext { get; private set; }

    /// <summary>Returns the shared Kubernetes API client.</summary>
    public k8s.Kubernetes GetClient() => client.Value;

    private k8s.Kubernetes CreateClient()
    {
        string? kubeconfigPath = Environment.GetEnvironmentVariable("KUBECONFIG") ?? appConfiguration["Kubernetes:KubeconfigPath"];
        string? context = Environment.GetEnvironmentVariable("KUBECONTEXT") ?? appConfiguration["Kubernetes:Context"];
        if (string.IsNullOrWhiteSpace(kubeconfigPath) && !File.Exists(KubernetesClientConfiguration.KubeConfigDefaultLocation))
        {
            throw new FileNotFoundException("No kubeconfig was supplied and no default kubeconfig file was found.", KubernetesClientConfiguration.KubeConfigDefaultLocation);
        }

        KubernetesClientConfiguration configuration = string.IsNullOrWhiteSpace(kubeconfigPath)
            ? KubernetesClientConfiguration.BuildConfigFromConfigFile(currentContext: context)
            : KubernetesClientConfiguration.BuildConfigFromConfigFile(kubeconfigPath, currentContext: context);
        configuration.HttpClientTimeout = TimeSpan.FromSeconds(5);
        CurrentContext = configuration.CurrentContext;
        return new k8s.Kubernetes(configuration);
    }
}
