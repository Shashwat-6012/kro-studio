using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

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
            logger.LogError(exception, "Request failed with {ErrorCode}.", code);
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
            return kubernetesStatus switch
            {
                400 or 422 => (kubernetesStatus, "Kubernetes rejected the request", SafeKubernetesMessage(kubernetesException), "kubernetes_validation_failed"),
                401 => (401, "Kubernetes authentication failed", "The Kubernetes API server rejected the configured credentials.", "kubernetes_unauthorized"),
                403 => (403, "Kubernetes permission denied", SafeKubernetesMessage(kubernetesException), "kubernetes_forbidden"),
                404 => (404, "Kubernetes resource not found", SafeKubernetesMessage(kubernetesException), "kubernetes_not_found"),
                409 => (409, "Kubernetes resource conflict", SafeKubernetesMessage(kubernetesException), "kubernetes_conflict"),
                408 or 504 => (504, "Kubernetes request timed out", "The Kubernetes API server did not respond in time.", "kubernetes_timeout"),
                _ => (502, "Kubernetes API request failed", "The Kubernetes API server could not complete the request.", "kubernetes_api_error")
            };
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

    private static string SafeKubernetesMessage(k8s.KubernetesException exception)
    {
        string? message = exception.Status?.Message;
        if (string.IsNullOrWhiteSpace(message))
        {
            return "The Kubernetes API server rejected the request. Check the resource, scope, and configured RBAC permissions.";
        }
        return message.Length <= 1200 ? message : message[..1200];
    }
}
