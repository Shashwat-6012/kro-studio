namespace KroStudio.Web.Features.Connection;

/// <summary>Maps cluster connection and KRO capability routes.</summary>
public static class ConnectionEndpoints
{
    /// <summary>Maps connection, capability, and installation endpoints.</summary>
    public static RouteGroupBuilder MapConnectionEndpoints(this RouteGroupBuilder api)
    {
        RouteGroupBuilder group = api.MapGroup("").WithTags("Connection");
        group.MapGet("/connection", (ClusterConnectionService service, CancellationToken cancellationToken) => service.GetConnectionAsync(cancellationToken))
            .WithName("GetConnection");
        group.MapGet("/capabilities", (ClusterConnectionService service, CancellationToken cancellationToken) => service.GetCapabilitiesAsync(cancellationToken))
            .WithName("GetCapabilities");
        group.MapGet("/kro-installation", (KroInstallationService service) => Results.Ok(new { version = service.Version, documentationUrl = service.DocumentationUrl }))
            .WithName("GetKroInstallationDetails");
        group.MapPost("/kro-installation", (KroInstallationService service, CancellationToken cancellationToken) => service.InstallAsync(cancellationToken))
            .WithName("InstallKro");
        return api;
    }
}
