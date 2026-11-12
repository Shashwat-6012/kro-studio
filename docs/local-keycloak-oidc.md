# Local OIDC / Keycloak test setup

> This guide exercises optional local OIDC development. The standard quickstart uses login-free Development mode on loopback; shared or release deployments require OIDC.

This guide exercises the Hub's OIDC sign-in, server-side session cookie, React sign-in screen, CSRF-protected API calls, and sign-out using a local Keycloak instance. It uses development-only credentials and HTTP. The Hub permits HTTP OIDC metadata only in the Development environment; other environments require HTTPS. Do not reuse these settings outside a local machine.

## 1. Start Keycloak

With Docker running, start a local Keycloak development server:

```powershell
docker run --name kro-studio-keycloak --rm -p 127.0.0.1:8081:8080 `
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin `
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin `
  quay.io/keycloak/keycloak:26.8.1 start-dev
```

Open [http://localhost:8081](http://localhost:8081) and sign in to the administration console with `admin` / `admin`.

## 2. Create the realm, client, and test user

1. Create a realm named `kro-studio`.
2. In that realm, create an OpenID Connect client with client ID `kro-studio`.
3. Enable **Client authentication** and **Standard flow**. PKCE uses `S256` from the Hub.
4. Set the valid redirect URI to `http://localhost:5173/signin-oidc`.
5. Set the valid post-logout redirect URI to `http://localhost:5173/signout-callback-oidc`.
6. Set the web origin to `http://localhost:5173`.
7. Copy the client secret from the client's **Credentials** tab.
8. Create a test user, set a password, and turn off **Temporary** for that password.

Keycloak's `preferred_username` claim supplies the Hub's default username. For this local flow, leave `Kubernetes:AuthMode=serviceAccount`; the user can sign in even if a Kubernetes cluster is not reachable, although cluster panels will report the connection failure.

## 3. Run the Hub

In a PowerShell window at the repository root, configure the OIDC client settings and start the Hub:

```powershell
$env:UserAuth__Mode = 'oidc'
$env:UserAuth__Oidc__Authority = 'http://localhost:8081/realms/kro-studio'
$env:UserAuth__Oidc__ClientId = 'kro-studio'
$env:UserAuth__Oidc__ClientSecret = '<paste-the-client-secret>'
$env:Kubernetes__AuthMode = 'serviceAccount'
dotnet run --project src/Hub/KroStudio.Hub.csproj --launch-profile http
```

These environment variable names map to the Hub's nested configuration. The Hub derives the OIDC callback from the forwarded browser-facing host and scheme; Vite forwards these to the Hub. Register `http://localhost:5173/signin-oidc` with Keycloak and open Vite as `http://localhost:5173` so the callback cookie and callback route use the same hostname. `UserAuth:Oidc:RedirectUri` can optionally override the derived callback for environments with a fixed public callback URL. Keep the real client secret in your local environment or user secrets; do not commit it to `appsettings.json`.

## 4. Run the React app

In a second PowerShell window:

```powershell
Set-Location src/Web
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), click **Sign in**, and authenticate with the test Keycloak user. Vite serves React on port 5173 and proxies `/auth`, `/signin-oidc`, `/signout-callback-oidc`, and `/api` to the Hub on port 8080. The browser therefore uses one origin; the OIDC callback is `http://localhost:5173/signin-oidc`. In Development only, the Hub permits the localhost HTTP session cookie needed by this setup.

After login, the Hub's `/auth/session` endpoint returns the signed-in display name and a request-verification token. The session ticket remains in the Hub's distributed-cache ticket store; the browser cookie contains only an opaque ticket key. React sends the CSRF token in `X-CSRF-TOKEN` on API mutations. Click **Sign out** to clear the Hub session and end the Keycloak login session.

The local default ticket cache is in-memory and intended for one Hub process. Restarting the Hub ends active sessions. Multi-instance deployments need a shared `IDistributedCache`, shared ASP.NET Data Protection keys, HTTPS, and an appropriately managed OIDC client secret.

## Troubleshooting

- **Keycloak says `Invalid parameter: redirect_uri`:** register `http://localhost:5173/signin-oidc` in Keycloak and open the UI at `http://localhost:5173`, not `127.0.0.1`. Check that Vite's `/auth` and `/signin-oidc` proxy rules are running so the Hub sees the forwarded browser-facing host.
- **Hub reports an authority or metadata error:** confirm the realm URL opens at `http://localhost:8081/realms/kro-studio/.well-known/openid-configuration` and that Docker's Keycloak container is ready.
- **Login succeeds but every POST returns 400:** reload the app so `/auth/session` can issue a fresh CSRF token and antiforgery cookie; confirm the Vite `/auth` and `/signin-oidc` proxy rules are active.
- **Browser does not retain the session cookie:** use the same hostname (`localhost`) throughout this guide. Do not mix `localhost` and `127.0.0.1`.
- **The app signs in but the cluster is disconnected:** this is independent of OIDC. Configure a local kubeconfig or `Kubernetes:InCluster=true` for a cluster test.
