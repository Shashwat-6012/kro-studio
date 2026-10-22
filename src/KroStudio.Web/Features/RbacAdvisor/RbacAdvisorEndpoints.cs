namespace KroStudio.Web.Features.RbacAdvisor;

/// <summary>Maps RBAC advisor, preflight, and confirmed apply operations.</summary>
public static class RbacAdvisorEndpoints
{
    /// <summary>Maps advisor checks, RBAC preflight, and explicitly confirmed apply routes.</summary>
    public static RouteGroupBuilder MapRbacAdvisorEndpoints(this RouteGroupBuilder api)
    {
        RouteGroupBuilder group = api.MapGroup("/rbac-advisor").WithTags("RBAC Advisor");
        group.MapGet("", (string? definitionName, string? @namespace, RbacAdvisorService service, CancellationToken token) => service.CheckAsync(definitionName, @namespace, token)).WithName("CheckRbacAdvisor");
        group.MapGet("/controller/{definitionName}/plan", (string definitionName, string? @namespace, RbacAdvisorService service, CancellationToken token) => service.PreviewControllerRbacAsync(definitionName, @namespace, token)).WithName("PreviewControllerRbac");
        group.MapPost("/controller/{definitionName}/apply", (string definitionName, ApplyControllerRbacRequest request, RbacAdvisorService service, CancellationToken token) => service.ApplyControllerRbacAsync(definitionName, request.Namespace, request.Confirmed, request.PlanToken, token)).WithName("ApplyControllerRbac");
        return api;
    }
}

internal sealed record ApplyControllerRbacRequest(bool Confirmed, string? Namespace, string PlanToken);
