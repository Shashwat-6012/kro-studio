using KroStudio.Web.Features.Connection;
using KroStudio.Web.Features.GeneratedApis;
using KroStudio.Web.Features.Instances;
using KroStudio.Web.Features.RbacAdvisor;
using KroStudio.Web.Features.ResourceGraphDefinitions;
using KroStudio.Web.Infrastructure.Errors;
using KroStudio.Web.Infrastructure.Auth;
using KroStudio.Web.Infrastructure.Kubernetes;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Scalar.AspNetCore;
using System.Net;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddHttpContextAccessor();
builder.Services.AddAuthorization();
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    if (builder.Environment.IsDevelopment())
    {
        options.KnownProxies.Add(IPAddress.Loopback);
        options.KnownProxies.Add(IPAddress.IPv6Loopback);
    }
    foreach (string proxy in builder.Configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
        if (IPAddress.TryParse(proxy, out IPAddress? address)) options.KnownProxies.Add(address);
});
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "KroStudio.Antiforgery";
    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
});
string userAuthMode = builder.Configuration["UserAuth:Mode"] ?? "none";
string kubernetesAuthMode = builder.Configuration["Kubernetes:AuthMode"] ?? "serviceAccount";
if (!userAuthMode.Equals("none", StringComparison.OrdinalIgnoreCase) && !userAuthMode.Equals("oidc", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("UserAuth:Mode must be 'none' or 'oidc'.");
if (!kubernetesAuthMode.Equals("impersonation", StringComparison.OrdinalIgnoreCase) && !kubernetesAuthMode.Equals("serviceAccount", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Kubernetes:AuthMode must be 'impersonation' or 'serviceAccount'.");
if (kubernetesAuthMode.Equals("impersonation", StringComparison.OrdinalIgnoreCase) && !userAuthMode.Equals("oidc", StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Kubernetes impersonation requires UserAuth:Mode=oidc.");
if (userAuthMode.Equals("oidc", StringComparison.OrdinalIgnoreCase))
{
    string? authority = builder.Configuration["UserAuth:Oidc:Authority"];
    string? clientId = builder.Configuration["UserAuth:Oidc:ClientId"];
    if (string.IsNullOrWhiteSpace(authority) || string.IsNullOrWhiteSpace(clientId))
        throw new InvalidOperationException("OIDC mode requires UserAuth:Oidc:Authority and UserAuth:Oidc:ClientId.");
    builder.Services.AddDistributedMemoryCache();
    builder.Services.AddSingleton<ITicketStore, DistributedCacheTicketStore>();
    builder.Services.AddAuthentication(options =>
    {
        options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
    })
    .AddCookie(options =>
    {
        options.Cookie.Name = "KroStudio.Session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.IsEssential = true;
        options.SlidingExpiration = true;
        options.ExpireTimeSpan = TimeSpan.FromHours(8);
        options.Events.OnRedirectToLogin = context =>
        {
            if (context.Request.Path.StartsWithSegments("/api")) { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; }
            context.Response.Redirect(context.RedirectUri);
            return Task.CompletedTask;
        };
    })
    .AddOpenIdConnect(options =>
    {
        options.Authority = authority;
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
        options.ClientId = clientId;
        options.ClientSecret = builder.Configuration["UserAuth:Oidc:ClientSecret"];
        options.ResponseType = "code";
        options.UsePkce = true;
        options.SaveTokens = false;
        options.GetClaimsFromUserInfoEndpoint = true;
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters { NameClaimType = builder.Configuration["UserAuth:Oidc:UsernameClaim"] ?? "preferred_username" };
        options.Scope.Add("profile");
        options.Scope.Add("email");
        options.Events.OnRedirectToIdentityProvider = context =>
        {
            string? redirectUri = builder.Configuration["UserAuth:Oidc:RedirectUri"];
            if (!string.IsNullOrWhiteSpace(redirectUri)) context.ProtocolMessage.RedirectUri = redirectUri;
            return Task.CompletedTask;
        };
        options.Events.OnTokenValidated = context =>
        {
            string? idToken = context.TokenEndpointResponse?.IdToken ?? context.ProtocolMessage.IdToken;
            if (!string.IsNullOrWhiteSpace(idToken))
                context.Properties?.StoreTokens([new AuthenticationToken { Name = "id_token", Value = idToken }]);
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToIdentityProviderForSignOut = context =>
        {
            string? idToken = context.Properties.GetTokenValue("id_token");
            if (!string.IsNullOrWhiteSpace(idToken))
                context.ProtocolMessage.IdTokenHint = idToken;
            return Task.CompletedTask;
        };
    });
    builder.Services.AddOptions<CookieAuthenticationOptions>(CookieAuthenticationDefaults.AuthenticationScheme)
        .Configure<ITicketStore>((options, ticketStore) => options.SessionStore = ticketStore);
}
builder.Services.AddExceptionHandler<KubernetesExceptionHandler>();
builder.Services.AddCors(options => options.AddPolicy("Ui", policy =>
{
    string[] configuredOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? ["http://localhost:5173", "http://127.0.0.1:5173"];
    policy.WithOrigins(configuredOrigins).AllowAnyHeader().AllowAnyMethod();
}));
builder.Services.AddSingleton<KubernetesClientFactory>();
builder.Services.AddSingleton<ClusterConnectionService>();
builder.Services.AddSingleton<KroInstallationService>();
builder.Services.AddSingleton<KroControllerService>();
builder.Services.AddSingleton<ResourceGraphDefinitionService>();
builder.Services.AddSingleton<GeneratedApiResolver>();
builder.Services.AddSingleton<InstanceService>();
builder.Services.AddSingleton<RbacAdvisorService>();

WebApplication app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();  // serves the spec at /openapi/v1.json
    app.MapScalarApiReference();
}

app.UseExceptionHandler();
app.UseForwardedHeaders();
app.UseCors("Ui");
if (userAuthMode.Equals("oidc", StringComparison.OrdinalIgnoreCase))
{
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapGet("/auth/login", (string? returnUrl) => Results.Challenge(new Microsoft.AspNetCore.Authentication.AuthenticationProperties { RedirectUri = IsLocal(returnUrl) ? returnUrl : "/" }, [OpenIdConnectDefaults.AuthenticationScheme])).AllowAnonymous();
    app.MapPost("/auth/logout", async (HttpContext context) =>
    {
        AuthenticateResult authenticated = await context.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme).ConfigureAwait(false);
        Microsoft.AspNetCore.Authentication.AuthenticationProperties properties = authenticated.Properties ?? new();
        properties.RedirectUri = "/";
        return Results.SignOut(properties, [OpenIdConnectDefaults.AuthenticationScheme, CookieAuthenticationDefaults.AuthenticationScheme]);
    }).RequireAuthorization();
}
app.MapGet("/auth/session", (HttpContext context, IAntiforgery antiforgery) =>
{
    AntiforgeryTokenSet tokens = antiforgery.GetAndStoreTokens(context);
    bool authenticated = !userAuthMode.Equals("oidc", StringComparison.OrdinalIgnoreCase) || context.User.Identity?.IsAuthenticated == true;
    return Results.Ok(new
    {
        authenticationEnabled = userAuthMode.Equals("oidc", StringComparison.OrdinalIgnoreCase),
        authenticated,
        user = authenticated ? context.User.Identity?.Name : null,
        csrfToken = tokens.RequestToken
    });
}).AllowAnonymous();
app.UseDefaultFiles();
app.UseStaticFiles();

if (userAuthMode.Equals("oidc", StringComparison.OrdinalIgnoreCase))
{
    app.Use(async (context, next) =>
    {
        bool protectedPath = context.Request.Path.StartsWithSegments("/api/v1") || context.Request.Path.Equals("/auth/logout", StringComparison.OrdinalIgnoreCase);
        bool unsafeMethod = !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method) && !HttpMethods.IsOptions(context.Request.Method);
        if (protectedPath && unsafeMethod)
        {
            try { await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context).ConfigureAwait(false); }
            catch (AntiforgeryValidationException)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsJsonAsync(new { title = "The request verification token is missing or invalid." }).ConfigureAwait(false);
                return;
            }
        }
        await next().ConfigureAwait(false);
    });
}

app.MapGet("/health", () => Results.Ok(new { status = "healthy" })).WithName("GetHealth").WithTags("Health");
RouteGroupBuilder api = app.MapGroup("/api/v1");
if (userAuthMode.Equals("oidc", StringComparison.OrdinalIgnoreCase)) api.RequireAuthorization();
api.MapConnectionEndpoints();
api.MapResourceGraphDefinitionEndpoints();
api.MapGeneratedApiEndpoints();
api.MapInstanceEndpoints();
api.MapRbacAdvisorEndpoints();

// Keep unknown API paths as API 404s instead of returning the SPA document.
app.MapMethods("/api/{**path}", ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], () => Results.NotFound());
app.MapFallbackToFile("{*path:nonfile}", "index.html");

static bool IsLocal(string? url) => !string.IsNullOrWhiteSpace(url) && url.StartsWith('/') && !url.StartsWith("//") && !url.StartsWith("/\\");

app.Run();

/// <summary>Provides the application entry point for integration hosting.</summary>
public partial class Program;
