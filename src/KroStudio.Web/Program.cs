using KroStudio.Web.Features.Connection;
using KroStudio.Web.Features.GeneratedApis;
using KroStudio.Web.Features.Instances;
using KroStudio.Web.Features.ResourceGraphDefinitions;
using KroStudio.Web.Infrastructure.Errors;
using KroStudio.Web.Infrastructure.Kubernetes;
using Scalar.AspNetCore;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<KubernetesExceptionHandler>();
builder.Services.AddCors(options => options.AddPolicy("Ui", policy =>
{
    string[] configuredOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? ["http://localhost:5173", "http://127.0.0.1:5173"];
    policy.WithOrigins(configuredOrigins).AllowAnyHeader().AllowAnyMethod();
}));
builder.Services.AddSingleton<KubernetesClientFactory>();
builder.Services.AddSingleton<ClusterConnectionService>();
builder.Services.AddSingleton<KroInstallationService>();
builder.Services.AddSingleton<ResourceGraphDefinitionService>();
builder.Services.AddSingleton<GeneratedApiResolver>();
builder.Services.AddSingleton<InstanceService>();

WebApplication app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();  // serves the spec at /openapi/v1.json
    app.MapScalarApiReference();
}

app.UseExceptionHandler();
app.UseCors("Ui");

app.MapGet("/", () => Results.Problem("KRO Studio API is running. Use /api/v1 or /health.", statusCode: StatusCodes.Status404NotFound));
app.MapGet("/health", () => Results.Ok(new { status = "healthy" })).WithName("GetHealth").WithTags("Health");
RouteGroupBuilder api = app.MapGroup("/api/v1");
api.MapConnectionEndpoints();
api.MapResourceGraphDefinitionEndpoints();
api.MapGeneratedApiEndpoints();
api.MapInstanceEndpoints();
app.Run();

/// <summary>Provides the application entry point for integration hosting.</summary>
public partial class Program;
