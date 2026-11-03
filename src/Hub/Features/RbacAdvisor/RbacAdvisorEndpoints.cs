using System.Text.Json;
using KroStudio.Web.Features.ResourceGraphDefinitions;
using Microsoft.AspNetCore.Mvc;

namespace KroStudio.Web.Features.RbacAdvisor;

/// <summary>Maps RBAC manager operations and legacy advisor operations.</summary>
public static class RbacAdvisorEndpoints
{
    /// <summary>Maps CRUD operations for Kubernetes roles and role bindings.</summary>
    public static RouteGroupBuilder MapRbacAdvisorEndpoints(this RouteGroupBuilder api)
    {
        RouteGroupBuilder manager = api.MapGroup("/rbac/objects").WithTags("RBAC Manager");
        manager.MapGet("/{kind}", (string kind, string? @namespace, RbacAdvisorService service, CancellationToken token) => service.ListManagedObjectsAsync(kind, @namespace, token)).WithName("ListRbacObjects");
        manager.MapGet("/{kind}/{name}", (string kind, string name, string? @namespace, RbacAdvisorService service, CancellationToken token) => service.GetManagedObjectAsync(kind, name, @namespace, token)).WithName("GetRbacObject");
        manager.MapPost("/{kind}", async (string kind, [FromBody] JsonElement input, RbacAdvisorService service, CancellationToken token) =>
        {
            JsonElement manifest = ParseManifest(input);
            JsonElement created = await service.CreateManagedObjectAsync(kind, manifest, ManifestNamespace(manifest), token).ConfigureAwait(false);
            string name = created.GetProperty("metadata").GetProperty("name").GetString() ?? string.Empty;
            string? @namespace = ManifestNamespace(created);
            string location = $"/api/v1/rbac/objects/{Uri.EscapeDataString(kind)}/{Uri.EscapeDataString(name)}" + (@namespace is null ? string.Empty : $"?namespace={Uri.EscapeDataString(@namespace)}");
            return Results.Created(location, created);
        }).WithName("CreateRbacObject");
        manager.MapPut("/{kind}/{name}", (string kind, string name, string? @namespace, [FromBody] JsonElement input, RbacAdvisorService service, CancellationToken token) =>
            service.UpdateManagedObjectAsync(kind, name, ParseManifest(input), @namespace, token)).WithName("UpdateRbacObject");
        manager.MapDelete("/{kind}/{name}", async (string kind, string name, string? @namespace, RbacAdvisorService service, CancellationToken token) =>
        {
            await service.DeleteManagedObjectAsync(kind, name, @namespace, token).ConfigureAwait(false);
            return Results.NoContent();
        }).WithName("DeleteRbacObject");

        // Keep the advisor API available for existing integrations while the UI moves to the manager.
        RouteGroupBuilder group = api.MapGroup("/rbac-advisor").WithTags("RBAC Advisor");
        group.MapGet("", (string? definitionName, string? @namespace, string? instanceName, RbacAdvisorService service, CancellationToken token) => service.CheckAsync(definitionName, @namespace, instanceName, token)).WithName("CheckRbacAdvisor");
        group.MapGet("/controller/{definitionName}/plan", (string definitionName, string? @namespace, RbacAdvisorService service, CancellationToken token) => service.PreviewControllerRbacAsync(definitionName, @namespace, token)).WithName("PreviewControllerRbac");
        group.MapPost("/controller/{definitionName}/apply", (string definitionName, ApplyControllerRbacRequest request, RbacAdvisorService service, CancellationToken token) => service.ApplyControllerRbacAsync(definitionName, request.Namespace, request.Confirmed, request.PlanToken, token)).WithName("ApplyControllerRbac");
        return api;
    }

    private static JsonElement ParseManifest(JsonElement input)
    {
        if (input.ValueKind == JsonValueKind.String) return YamlManifestParser.Parse(input.GetString() ?? string.Empty);
        if (input.ValueKind == JsonValueKind.Object && input.TryGetProperty("yaml", out JsonElement yaml))
        {
            if (yaml.ValueKind != JsonValueKind.String) throw new ArgumentException("The yaml field must be a string.", nameof(input));
            return YamlManifestParser.Parse(yaml.GetString() ?? string.Empty);
        }
        return input;
    }

    private static string? ManifestNamespace(JsonElement manifest) => manifest.TryGetProperty("metadata", out JsonElement metadata) && metadata.TryGetProperty("namespace", out JsonElement value) ? value.GetString() : null;
}

internal sealed record ApplyControllerRbacRequest(bool Confirmed, string? Namespace, string PlanToken);
