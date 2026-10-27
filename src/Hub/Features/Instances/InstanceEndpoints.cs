using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using KroStudio.Web.Features.ResourceGraphDefinitions;
using KroStudio.Web.Features.GeneratedApis;

namespace KroStudio.Web.Features.Instances;

/// <summary>Maps generated API instance and monitoring routes.</summary>
public static class InstanceEndpoints
{
    /// <summary>Maps paged list, read, create, update, and delete operations for generated APIs.</summary>
    public static RouteGroupBuilder MapInstanceEndpoints(this RouteGroupBuilder api)
    {
        RouteGroupBuilder group = api.MapGroup("/apis/{apiId}/instances").WithTags("Instances");
        group.MapGet("", (string apiId, [FromQuery(Name = "namespace")] string? namespaceName, [FromQuery(Name = "continue")] string? continueToken, InstanceService service, CancellationToken token) => service.ListAsync(apiId, namespaceName, continueToken, token)).WithName("ListGeneratedApiInstances");
        group.MapGet("/{name}", (string apiId, string name, [FromQuery(Name = "namespace")] string? namespaceName, InstanceService service, CancellationToken token) => service.GetAsync(apiId, name, namespaceName, token)).WithName("GetGeneratedApiInstance");
        group.MapGet("/{name}/events", (string apiId, string name, [FromQuery(Name = "namespace")] string? namespaceName, InstanceService service, CancellationToken token) => service.GetEventsAsync(apiId, name, namespaceName, token)).WithName("GetGeneratedApiInstanceEvents");
        group.MapGet("/{name}/resources", (string apiId, string name, [FromQuery(Name = "namespace")] string? namespaceName, InstanceService service, CancellationToken token) => service.GetComposedResourcesAsync(apiId, name, namespaceName, token)).WithName("GetGeneratedApiInstanceResources");
        group.MapPost("", async (string apiId, [FromQuery(Name = "namespace")] string? namespaceName, JsonElement input, InstanceService service, CancellationToken token) =>
        {
            JsonElement manifest = ParseManifest(input);
            JsonElement created = await service.CreateAsync(apiId, manifest, namespaceName, token).ConfigureAwait(false);
            string name = created.GetProperty("metadata").GetProperty("name").GetString() ?? string.Empty;
            string location = $"/api/v1/apis/{Uri.EscapeDataString(apiId)}/instances/{Uri.EscapeDataString(name)}";
            return Results.Created(location, created);
        }).WithName("CreateGeneratedApiInstance");
        group.MapPut("/{name}", (string apiId, string name, [FromQuery(Name = "namespace")] string? namespaceName, JsonElement input, InstanceService service, CancellationToken token) => service.UpdateAsync(apiId, name, ParseManifest(input), namespaceName, token)).WithName("UpdateGeneratedApiInstance");
        group.MapDelete("/{name}", async (string apiId, string name, [FromQuery(Name = "namespace")] string? namespaceName, InstanceService service, CancellationToken token) =>
        {
            await service.DeleteAsync(apiId, name, namespaceName, token).ConfigureAwait(false);
            return Results.NoContent();
        }).WithName("DeleteGeneratedApiInstance");

        RouteGroupBuilder definitionGroup = api.MapGroup("/rgds/{name}/instances").WithTags("Instances");
        definitionGroup.MapGet("", async (string name, [FromQuery(Name = "namespace")] string? namespaceName, [FromQuery(Name = "continue")] string? continueToken, GeneratedApiResolver apiResolver, InstanceService service, CancellationToken token) =>
        {
            string apiId = (await apiResolver.ResolveForDefinitionAsync(name, token).ConfigureAwait(false)).Id;
            return await service.ListAsync(apiId, namespaceName, continueToken, token).ConfigureAwait(false);
        }).WithName("ListResourceGraphDefinitionInstances");
        definitionGroup.MapPost("", async (string name, [FromQuery(Name = "namespace")] string? namespaceName, JsonElement input, GeneratedApiResolver apiResolver, InstanceService service, CancellationToken token) =>
        {
            string apiId = (await apiResolver.ResolveForDefinitionAsync(name, token).ConfigureAwait(false)).Id;
            JsonElement created = await service.CreateAsync(apiId, ParseManifest(input), namespaceName, token).ConfigureAwait(false);
            string instanceName = created.GetProperty("metadata").GetProperty("name").GetString() ?? string.Empty;
            return Results.Created($"/api/v1/rgds/{Uri.EscapeDataString(name)}/instances/{Uri.EscapeDataString(instanceName)}", created);
        }).WithName("CreateResourceGraphDefinitionInstance");
        definitionGroup.MapGet("/{instanceName}", async (string name, string instanceName, [FromQuery(Name = "namespace")] string? namespaceName, GeneratedApiResolver apiResolver, InstanceService service, CancellationToken token) =>
        {
            string apiId = (await apiResolver.ResolveForDefinitionAsync(name, token).ConfigureAwait(false)).Id;
            return await service.GetAsync(apiId, instanceName, namespaceName, token).ConfigureAwait(false);
        }).WithName("GetResourceGraphDefinitionInstance");
        definitionGroup.MapGet("/{instanceName}/events", async (string name, string instanceName, [FromQuery(Name = "namespace")] string? namespaceName, GeneratedApiResolver apiResolver, InstanceService service, CancellationToken token) =>
        {
            string apiId = (await apiResolver.ResolveForDefinitionAsync(name, token).ConfigureAwait(false)).Id;
            return await service.GetEventsAsync(apiId, instanceName, namespaceName, token).ConfigureAwait(false);
        }).WithName("GetResourceGraphDefinitionInstanceEvents");
        definitionGroup.MapGet("/{instanceName}/resources", async (string name, string instanceName, [FromQuery(Name = "namespace")] string? namespaceName, GeneratedApiResolver apiResolver, InstanceService service, CancellationToken token) =>
        {
            string apiId = (await apiResolver.ResolveForDefinitionAsync(name, token).ConfigureAwait(false)).Id;
            return await service.GetComposedResourcesAsync(apiId, instanceName, namespaceName, token).ConfigureAwait(false);
        }).WithName("GetResourceGraphDefinitionInstanceResources");
        definitionGroup.MapGet("/{instanceName}/resources/{resourceName}/logs", async (string name, string instanceName, string resourceName, [FromQuery(Name = "namespace")] string? namespaceName, GeneratedApiResolver apiResolver, InstanceService service, CancellationToken token) =>
        {
            string apiId = (await apiResolver.ResolveForDefinitionAsync(name, token).ConfigureAwait(false)).Id;
            return await service.GetResourceLogsAsync(apiId, instanceName, resourceName, namespaceName, token).ConfigureAwait(false);
        }).WithName("GetResourceGraphDefinitionInstanceResourceLogs");
        definitionGroup.MapPut("/{instanceName}", async (string name, string instanceName, [FromQuery(Name = "namespace")] string? namespaceName, JsonElement input, GeneratedApiResolver apiResolver, InstanceService service, CancellationToken token) =>
        {
            string apiId = (await apiResolver.ResolveForDefinitionAsync(name, token).ConfigureAwait(false)).Id;
            return await service.UpdateAsync(apiId, instanceName, ParseManifest(input), namespaceName, token).ConfigureAwait(false);
        }).WithName("UpdateResourceGraphDefinitionInstance");
        definitionGroup.MapDelete("/{instanceName}", async (string name, string instanceName, [FromQuery(Name = "namespace")] string? namespaceName, GeneratedApiResolver apiResolver, InstanceService service, CancellationToken token) =>
        {
            string apiId = (await apiResolver.ResolveForDefinitionAsync(name, token).ConfigureAwait(false)).Id;
            await service.DeleteAsync(apiId, instanceName, namespaceName, token).ConfigureAwait(false);
            return Results.NoContent();
        }).WithName("DeleteResourceGraphDefinitionInstance");
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
