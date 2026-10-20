using k8s;
using k8s.Models;
using System.Text.Json;
using System.Net;
using KroStudio.Web.Infrastructure.Kubernetes;

namespace KroStudio.Web.Features.Connection;

/// <summary>Reports the configured Kubernetes connection and KRO API availability.</summary>
public sealed class ClusterConnectionService(KubernetesClientFactory clientFactory, ILogger<ClusterConnectionService> logger)
{
    /// <summary>Checks whether the configured cluster can be reached and identifies the active context.</summary>
    public async Task<ConnectionStatus> GetConnectionAsync(CancellationToken cancellationToken)
    {
        try
        {
            Kubernetes client = clientFactory.GetClient();
            object response = await client.Version.GetCodeAsync(cancellationToken).ConfigureAwait(false);
            using JsonDocument version = JsonDocument.Parse(KubernetesJson.Serialize(response));
            string? kubernetesVersion = version.RootElement.TryGetProperty("gitVersion", out JsonElement gitVersion) ? gitVersion.GetString() : null;
            return new ConnectionStatus(true, clientFactory.CurrentContext, kubernetesVersion, "Connected to the Kubernetes API server.");
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            return new ConnectionStatus(false, clientFactory.CurrentContext, null, SafeMessage(exception));
        }
    }

    /// <summary>Checks whether the KRO ResourceGraphDefinition API is discoverable.</summary>
    public async Task<ClusterCapabilities> GetCapabilitiesAsync(CancellationToken cancellationToken)
    {
        try
        {
            Kubernetes client = clientFactory.GetClient();
            object response = await client.CustomObjects.GetAPIResourcesAsync("kro.run", "v1alpha1", cancellationToken).ConfigureAwait(false);
            using JsonDocument resources = JsonDocument.Parse(KubernetesJson.Serialize(response));
            bool kroAvailable = resources.RootElement.TryGetProperty("resources", out JsonElement items) && items.EnumerateArray().Any(static item => item.TryGetProperty("name", out JsonElement name) && name.GetString() == "resourcegraphdefinitions");
            return new ClusterCapabilities(true, kroAvailable, kroAvailable ? "KRO API detected." : "KRO API was not found in cluster discovery.");
        }
        catch (k8s.KubernetesException exception) when (exception.Status?.Code == 403)
        {
            return new ClusterCapabilities(false, false, "Kubernetes discovery permission was denied. Grant read access to API discovery resources.");
        }
        catch (k8s.KubernetesException exception) when (exception.Status?.Code == 404)
        {
            return new ClusterCapabilities(true, false, "KRO API was not found in cluster discovery.");
        }
        catch (HttpRequestException exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return new ClusterCapabilities(true, false, "KRO API was not found in cluster discovery.");
        }
        catch (k8s.Autorest.HttpOperationException exception) when (exception.Response?.StatusCode == HttpStatusCode.NotFound)
        {
            return new ClusterCapabilities(true, false, "KRO API was not found in cluster discovery.");
        }
        catch (k8s.KubernetesException exception) when (exception.Status?.Code == 401)
        {
            return new ClusterCapabilities(false, false, "Kubernetes authentication failed. Refresh or configure the kubeconfig credentials.");
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning("KRO API discovery failed with {ExceptionType} after the Kubernetes connection succeeded.", exception.GetType().FullName);
            return new ClusterCapabilities(false, false, SafeMessage(exception));
        }
    }

    private static string SafeMessage(Exception exception) => exception switch
    {
        FileNotFoundException => "No kubeconfig was found. Set KUBECONFIG or add the default ~/.kube/config file to connect a cluster.",
        k8s.KubernetesException { Status.Code: 401 } => "Kubernetes authentication failed. Refresh or configure the kubeconfig credentials.",
        k8s.KubernetesException { Status.Code: 403 } => "Kubernetes permission denied while checking cluster connectivity.",
        HttpRequestException or TimeoutException => "The Kubernetes API server could not be reached. Check the configured endpoint and network.",
        _ => "Kubernetes connection could not be established. Check the configured kubeconfig and permissions."
    };
}

/// <summary>Describes Kubernetes API connectivity for the configured context.</summary>
/// <param name="Connected">Whether the API server responded successfully.</param>
/// <param name="Context">The selected kubeconfig context, when available.</param>
/// <param name="KubernetesVersion">The Kubernetes server version, when connected.</param>
/// <param name="Message">A safe status message for display.</param>
public sealed record ConnectionStatus(bool Connected, string? Context, string? KubernetesVersion, string Message);

/// <summary>Describes availability of Kubernetes and KRO APIs.</summary>
/// <param name="ClusterApiAvailable">Whether cluster discovery succeeded.</param>
/// <param name="KroApiAvailable">Whether the KRO API group was discovered.</param>
/// <param name="Message">A safe status message for display.</param>
public sealed record ClusterCapabilities(bool ClusterApiAvailable, bool KroApiAvailable, string Message);

