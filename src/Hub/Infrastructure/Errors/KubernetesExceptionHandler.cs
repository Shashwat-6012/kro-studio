using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using KroStudio.Web.Features.Connection;

namespace KroStudio.Web.Infrastructure.Errors;

/// <summary>Maps application and Kubernetes failures into stable problem responses.</summary>
public sealed class KubernetesExceptionHandler(ILogger<KubernetesExceptionHandler> logger) : IExceptionHandler
{
    /// <inheritdoc />
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
        {
            return false;
        }
        (int statusCode, string title, string detail, string code) = Map(exception);
        if (statusCode >= StatusCodes.Status500InternalServerError)
        {
            // Exception text can contain upstream response bodies or credential-bearing URLs.
            logger.LogError("Request failed with {ErrorCode} ({ExceptionType}).", code, exception.GetType().FullName);
        }
        ProblemDetails problem = new()
        {
            Status = statusCode,
            Title = title,
            Detail = detail,
            Instance = httpContext.Request.Path
        };
        problem.Extensions["code"] = code;
        problem.Extensions["traceId"] = httpContext.TraceIdentifier;
        httpContext.Response.StatusCode = statusCode;
        await httpContext.Response.WriteAsJsonAsync(problem, cancellationToken).ConfigureAwait(false);
        return true;
    }

    private static (int StatusCode, string Title, string Detail, string Code) Map(Exception exception)
    {
        if (exception is KroInstallationException installationException)
        {
            (int statusCode, string title, string detail, string code) = Map(installationException.InnerException ?? installationException);
            string progress = installationException.ResourcesApplied == 0
                ? "No KRO manifest resources were fully applied."
                : $"{installationException.ResourcesApplied} KRO manifest resource(s) were applied before the failure.";
            string failedResource = installationException.Resource is null ? string.Empty : $" Failed at {installationException.Resource}.";
            return (statusCode, title, $"KRO installation stopped while {installationException.Stage}.{failedResource} {progress} The install can be retried; already-present resources are handled by server-side apply. {detail}", code);
        }
        if (exception is ArgumentException)
        {
            return (StatusCodes.Status400BadRequest, "Invalid request", exception.Message, "invalid_request");
        }
        if (exception is InvalidOperationException)
        {
            return (StatusCodes.Status409Conflict, "Operation unavailable", exception.Message, "operation_unavailable");
        }
        if (exception is k8s.KubernetesException kubernetesException)
        {
            int kubernetesStatus = kubernetesException.Status?.Code ?? 502;
            return MapKubernetesStatus(kubernetesStatus);
        }
        if (exception is k8s.Autorest.HttpOperationException httpOperationException)
        {
            int kubernetesStatus = httpOperationException.Response is null
                ? 502
                : (int)httpOperationException.Response.StatusCode;
            return MapKubernetesStatus(kubernetesStatus);
        }
        if (exception is FileNotFoundException)
        {
            return (503, "Kubernetes connection is not configured", "Set KUBECONFIG or configure Kubernetes:KubeconfigPath to a readable kubeconfig.", "kubeconfig_missing");
        }
        if (exception is HttpRequestException or TimeoutException)
        {
            return (503, "Kubernetes API server unavailable", "Check the configured endpoint, network, and TLS trust.", "kubernetes_unavailable");
        }
        return (500, "Unexpected server error", "The server could not complete the request.", "unexpected_error");
    }

    private static (int StatusCode, string Title, string Detail, string Code) MapKubernetesStatus(int statusCode) => statusCode switch
    {
        400 or 422 => (statusCode, "Kubernetes rejected the request", "Review the submitted resource and its required fields.", "kubernetes_validation_failed"),
        401 => (401, "Kubernetes authentication failed", "The Kubernetes API server rejected the configured credentials.", "kubernetes_unauthorized"),
        403 => (403, "Kubernetes permission denied", "The configured Kubernetes identity cannot perform this operation in the requested scope.", "kubernetes_forbidden"),
        404 => (404, "Kubernetes resource not found", "Check the resource name, API, and namespace.", "kubernetes_not_found"),
        409 => (409, "Kubernetes resource conflict", "The resource changed since it was read. Refresh and retry.", "kubernetes_conflict"),
        408 or 504 => (504, "Kubernetes request timed out", "The Kubernetes API server did not respond in time.", "kubernetes_timeout"),
        _ => (502, "Kubernetes API request failed", "The Kubernetes API server could not complete the request.", "kubernetes_api_error")
    };

}
