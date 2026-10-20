namespace KroStudio.Web.Features.GeneratedApis;

/// <summary>Maps dynamic generated API discovery routes.</summary>
public static class GeneratedApiEndpoints
{
    /// <summary>Maps an RGD to its discovered instance API.</summary>
    public static RouteGroupBuilder MapGeneratedApiEndpoints(this RouteGroupBuilder api)
    {
        RouteGroupBuilder group = api.MapGroup("").WithTags("GeneratedApis");
        group.MapGet("/rgds/{name}/api", (string name, GeneratedApiResolver resolver, CancellationToken token) => resolver.ResolveForDefinitionAsync(name, token)).WithName("ResolveResourceGraphDefinitionApi");
        group.MapGet("/apis/{apiId}", (string apiId, GeneratedApiResolver resolver, CancellationToken token) => resolver.ResolveAsync(apiId, token)).WithName("GetGeneratedApi");
        return api;
    }
}
