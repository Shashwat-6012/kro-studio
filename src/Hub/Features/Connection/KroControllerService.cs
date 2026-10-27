using System.Text.Json;
using k8s;
using k8s.Models;
using KroStudio.Web.Infrastructure.Kubernetes;

namespace KroStudio.Web.Features.Connection;

/// <summary>Performs supported actions on the KRO controller deployment.</summary>
public sealed class KroControllerService(KubernetesClientFactory clientFactory)
{
    private const string ControllerNamespace = "kro-system";
    private const string ControllerDeployment = "kro";
    private const string RestartAnnotation = "kubectl.kubernetes.io/restartedAt";

    /// <summary>Triggers a rolling restart of the KRO controller deployment.</summary>
    public async Task<KroControllerActionResult> RestartAsync(CancellationToken cancellationToken)
    {
        Kubernetes client = clientFactory.GetClient();
        string timestamp = DateTimeOffset.UtcNow.ToString("O");
        string patch = JsonSerializer.Serialize(new
        {
            spec = new
            {
                template = new
                {
                    metadata = new
                    {
                        annotations = new Dictionary<string, string> { [RestartAnnotation] = timestamp }
                    }
                }
            }
        });

        await client.AppsV1.PatchNamespacedDeploymentAsync(
            new V1Patch(patch, V1Patch.PatchType.MergePatch),
            ControllerDeployment,
            ControllerNamespace,
            cancellationToken: cancellationToken).ConfigureAwait(false);

        return new KroControllerActionResult($"Restart requested for deployment {ControllerNamespace}/{ControllerDeployment}.");
    }
}

/// <summary>Reports the result of a KRO controller action.</summary>
public sealed record KroControllerActionResult(string Message);
