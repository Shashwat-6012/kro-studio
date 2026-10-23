using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace KroStudio.Web.Features.ResourceGraphDefinitions;

/// <summary>Maps ResourceGraphDefinition API routes.</summary>
public static class ResourceGraphDefinitionEndpoints
{
    /// <summary>Maps list, read, validation, create, update, and delete operations.</summary>
    public static RouteGroupBuilder MapResourceGraphDefinitionEndpoints(this RouteGroupBuilder api)
    {
        RouteGroupBuilder group = api.MapGroup("/rgds").WithTags("ResourceGraphDefinitions");
        group.MapGet("", (ResourceGraphDefinitionService service, CancellationToken token) => service.ListAsync(token)).WithName("ListResourceGraphDefinitions");
        group.MapGet("/{name}", (string name, ResourceGraphDefinitionService service, CancellationToken token) => service.GetAsync(name, token)).WithName("GetResourceGraphDefinition");
        group.MapPost("/validate", async ([FromQuery] bool update, JsonElement input, ResourceGraphDefinitionService service, CancellationToken token) => Results.Ok(await service.ValidateAsync(ParseManifest(input), update, token).ConfigureAwait(false))).WithName("ValidateResourceGraphDefinition");
        group.MapPost("", async (JsonElement input, ResourceGraphDefinitionService service, CancellationToken token) =>
        {
            JsonElement manifest = ParseManifest(input);
            JsonElement created = await service.CreateAsync(manifest, token).ConfigureAwait(false);
            string name = created.GetProperty("metadata").GetProperty("name").GetString() ?? string.Empty;
            return Results.Created($"/api/v1/rgds/{Uri.EscapeDataString(name)}", created);
        }).WithName("CreateResourceGraphDefinition");
        group.MapPut("/{name}", (string name, JsonElement input, ResourceGraphDefinitionService service, CancellationToken token) => service.UpdateAsync(name, ParseManifest(input), token)).WithName("UpdateResourceGraphDefinition");
        group.MapPost("/{name}/retry", (string name, ResourceGraphDefinitionService service, CancellationToken token) => service.RetryReconciliationAsync(name, token)).WithName("RetryResourceGraphDefinitionReconciliation");
        group.MapDelete("/{name}", async (string name, ResourceGraphDefinitionService service, CancellationToken token) =>
        {
            await service.DeleteAsync(name, token).ConfigureAwait(false);
            return Results.NoContent();
        }).WithName("DeleteResourceGraphDefinition");
        return api;
    }

    private static JsonElement ParseManifest(JsonElement input)
    {
        if (input.ValueKind == JsonValueKind.String)
        {
            return YamlManifestParser.Parse(input.GetString() ?? string.Empty);
        }
        if (input.ValueKind == JsonValueKind.Object && input.TryGetProperty("yaml", out JsonElement yaml))
        {
            if (yaml.ValueKind != JsonValueKind.String)
            {
                throw new ArgumentException("The yaml field must be a string.", nameof(input));
            }
            return YamlManifestParser.Parse(yaml.GetString() ?? string.Empty);
        }
        return input;
    }
}
