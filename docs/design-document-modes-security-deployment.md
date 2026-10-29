# KroStudio Design Document: Helm-Based Release

Author: Shashwat | Status: Draft v2 (Helm-only scope) | Date: October 29, 2026

KroStudio ships as one Helm release: a single image running inside the cluster, where users log in with a ServiceAccount token and Kubernetes RBAC decides what each person can do. Local binaries, kubeconfig handling and multiple run modes are out of scope for v0.1.

## 1. Scope and decisions

v0.1 supports exactly one deployment shape: the Hub and the UI in one pod, installed with Helm.

| Decision | Choice | Why |
| --- | --- | --- |
| Run mode | In-cluster only | Removes kubeconfig handling, loopback rewrites, exec-plugin problems and Docker networking |
| Distribution | Helm chart (OCI) plus container image on GHCR | One install path to build, test and document |
| Login (v0.1) | Paste a ServiceAccount token | Smallest auth that still enforces per-user permissions |
| Authorization | Kubernetes RBAC, evaluated on the user's own token | The Hub holds no cluster permissions of its own |
| Login (v0.2) | OIDC, then impersonation | Replaces token paste without changing the rest of the design |
| Access | ClusterIP plus `kubectl port-forward`; optional Ingress with TLS | Nothing is exposed unless the admin opts in |
| Replicas | 1 | Sessions live in memory in v0.1 |
| Local development | Kubeconfig loader in the Development environment only | Keeps the dev loop; never documented or shipped as a mode |

### 1.1 Goals

- No unauthenticated access to any cluster operation.
- Permissions are enforced by Kubernetes RBAC, not by KroStudio.
- Install with two commands: `helm install`, then `kubectl port-forward`.
- One process and one image, with no shell and no package manager at runtime.
- Connection failures are diagnosed in the UI with the exact failing step.

### 1.2 Out of scope for v0.1

- Single binary, Homebrew, Scoop, winget and krew.
- Kubeconfig mounting, context switching and the `host.docker.internal` rewrite.
- Multi-cluster management from one instance.
- OIDC login and impersonation (v0.2).
- Dry-run diffs and delete confirmations (v0.2).
- Code signing and notarization.

## 2. Findings that still apply

Six of the ten findings from the current setup remain once the scope is Helm-only; the other four disappear because the pod has no kubeconfig.

| ID | Finding | Severity | Addressed by |
| --- | --- | --- | --- |
| F1 | The API has no authentication, so anyone who reaches the port acts with the Hub's credentials | High | SEC-1, SEC-2, SEC-7 |
| F2 | A web page in the user's browser can call the API (CSRF) or use DNS rebinding against a port-forward or Ingress host | High | SEC-3, SEC-4, SEC-5 |
| F4 | `AllowedHosts: "*"` disables host validation, and the CORS allow-list does nothing behind a same-origin setup | Medium | SEC-4, SEC-5 |
| F5 | Container hardening is partial: no read-only filesystem, no dropped capabilities, tags not pinned | Medium | SEC-8, DEP-6, SEC-14 |
| F6 | nginx and supervisord add two extra processes, an apt layer and config files for no functional gain | Medium | DEP-1, DEP-2 |
| F10 | The kro version is static config, and connection failures are not diagnosed in the UI | Medium | CON-3, CON-4, CON-6 |

Dropped from scope: F3 (whole kubeconfig mounted), F7 (loopback server addresses), F8 (exec-plugin credentials) and F9 (context fixed at start). A pod uses in-cluster configuration, so none of them can occur.

## 3. Architecture and request flow

One pod runs one process, and the user's own token reaches the Kubernetes API server, so the cluster decides what each person can do.

### 3.1 Components

- **Hub (.NET):** serves the React build, `/api`, `/health` and `/ready` on port 8080.
- **Pod ServiceAccount:** has no RoleBindings or ClusterRoleBindings. The pod uses it only to read the cluster CA certificate and the API server address.
- **Service:** ClusterIP by default, with an optional Ingress.
- **Browser:** holds only an opaque session cookie, never the Kubernetes token.

### 3.2 Login and request flow

1. The user opens KroStudio through `kubectl port-forward` or the Ingress, and the Hub serves the UI.
2. The login screen asks for a token created with `kubectl create token`.
3. The Hub sends the token to the API server in a SelfSubjectReview call. A success returns the username and groups.
4. The Hub stores the token, identity and expiry in an in-memory session and sets an opaque HttpOnly, SameSite=Strict cookie.
5. On each API call the Hub checks the session, builds a client with that token against the in-cluster API address, and forwards the request.
6. Kubernetes evaluates RBAC for the token's identity. A 403 reaches the UI as a permissions message. A 401 ends the session and returns the user to login.

### 3.3 Why this shape

- Users can only do what their own RBAC allows, including on instances of generated CRDs in arbitrary API groups. KroStudio never needs a permission list for them.
- The API server audit log records the real user, not a shared Hub identity.
- A compromised UI request cannot do more than the logged-in user could do with `kubectl`.
- In v0.2, OIDC login replaces the pasted token and the Hub impersonates the user. Steps 5 and 6 stay the same.

## 4. Requirements

Priority: **M** = must have for v0.1, **S** = should have for v0.1 if time allows, **C** = could have later.

### 4.1 Security

| ID | Requirement | Priority |
| --- | --- | --- |
| SEC-1 | Every `/api` request except login must carry a valid session. Others receive 401. | M |
| SEC-2 | Login validates the token with a SelfSubjectReview before creating a session. An invalid token creates no session. | M |
| SEC-3 | The session cookie is HttpOnly and SameSite=Strict, Secure when served over HTTPS, with an opaque random ID of at least 256 bits. The token never reaches browser storage or JavaScript. | M |
| SEC-4 | The Hub validates the `Host` header against an allow-list set in Helm values. Other hosts receive 403. | M |
| SEC-5 | Mutating requests must have an `Origin` matching the Hub and a custom CSRF header. Others receive 403. | M |
| SEC-6 | Tokens live only in memory. They are never logged or written to disk, a Secret or a ConfigMap. A session ends at the earlier of the token's expiry and a configured TTL (default 8 hours). | M |
| SEC-7 | The chart creates no RoleBindings or ClusterRoleBindings for the Hub's ServiceAccount. | M |
| SEC-8 | The pod runs non-root with a read-only root filesystem, all capabilities dropped, no privilege escalation and the RuntimeDefault seccomp profile. | M |
| SEC-9 | A `readOnly` setting blocks every mutating endpoint at the API, not only in the UI. | M |
| SEC-10 | Secrets are not listed or read unless `allowSecrets` is enabled. | S |
| SEC-11 | The login endpoint is rate limited per client address. | S |
| SEC-12 | The chart offers a NetworkPolicy template: ingress from the ingress controller or port-forward only, egress to DNS and the API server. | S |
| SEC-13 | Logs never contain tokens, Authorization headers or cookie values. | M |
| SEC-14 | Base images are pinned by digest. Release artifacts include checksums, a signature and an SBOM. | C |

### 4.2 Deployment and packaging

| ID | Requirement | Priority |
| --- | --- | --- |
| DEP-1 | The Hub serves the UI itself (static files and SPA fallback). nginx and supervisord are removed. | M |
| DEP-2 | The runtime image is the chiseled ASP.NET image, listens on one port (8080) and runs non-root. | M |
| DEP-3 | The Hub has a `--healthcheck` mode, and exposes `/health` (liveness) and `/ready` (API server reachable) for Kubernetes probes. | M |
| DEP-4 | The image is published for linux/amd64 and linux/arm64 on GHCR. | M |
| DEP-5 | The Helm chart is published to an OCI registry with a `values.schema.json`. | M |
| DEP-6 | Chart defaults: ClusterIP Service, 1 replica, hardened security context, resource requests and limits. | M |
| DEP-7 | The chart offers an optional Ingress with TLS and an optional NetworkPolicy. | S |
| DEP-8 | Pushing a `v*` tag builds the image, packages and pushes the chart, and creates a GitHub Release with notes. | M |
| DEP-9 | A `helm test` hook or documented smoke test confirms `/ready` after install. | C |

### 4.3 Connection and UX

| ID | Requirement | Priority |
| --- | --- | --- |
| CON-1 | The Hub connects with in-cluster configuration (service host and port, mounted CA). No kubeconfig is used. | M |
| CON-2 | The login screen shows how to create a token and warns that tokens expire. | M |
| CON-3 | After login the UI runs the connection checklist in section 6.4. | M |
| CON-4 | The kro version is detected from the cluster. The static `KroVersion` setting is removed. | S |
| CON-5 | Actions the user lacks permission for are hidden or disabled, with an explanation, using SelfSubjectAccessReview. | S |
| CON-6 | A 401 ends the session with a "token expired" message. A 403 names the missing permission. | M |
| CON-7 | Documentation covers port-forward access and Ingress setup. | M |
| CON-8 | Live status updates use watch and server-sent events instead of polling. | C |

### 4.4 Write safety

| ID | Requirement | Priority |
| --- | --- | --- |
| WS-1 | Create and update offer a server-side dry-run preview with a diff before the user confirms. | S, v0.2 |
| WS-2 | Deleting a resource requires typing its name. Deleting an RGD with live instances lists the affected instances. | S, v0.2 |
| WS-3 | Each mutation writes a structured log entry with the user identity, verb, resource and result. | S |

### 4.5 Development and non-functional

| ID | Requirement | Priority |
| --- | --- | --- |
| DEV-1 | A kubeconfig loader exists for local development only. It activates when `ASPNETCORE_ENVIRONMENT=Development` and `KROSTUDIO_DEV_KUBECONFIG` is set. In any other environment the Hub refuses to start with that variable set. | M |
| NFR-1 | Supported clusters: Kubernetes 1.28 or newer (SelfSubjectReview is GA there), and the current and previous kro minor versions. | M |
| NFR-2 | The Hub is ready to serve within a few seconds and logs in a structured format. | S |
| NFR-3 | The README has a quick start, an access guide, a token and RBAC guide, and a short threat model. | M |

## 5. Security design

The main risks are a hostile web page driving an open session and a stolen or over-privileged token; session, Host, Origin and CSRF checks plus a permissionless pod address both.

### 5.1 Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| A hostile page calls the API using the victim's cookie (CSRF) | SameSite=Strict cookie, Origin check, required custom header (SEC-3, SEC-5) |
| DNS rebinding against a port-forward or Ingress host | Host allow-list (SEC-4) |
| Token theft through XSS | The token never reaches JavaScript (HttpOnly session cookie); strict Content-Security-Policy |
| Token leaked through logs or error pages | Tokens are never logged; the Authorization header is stripped from diagnostics (SEC-13) |
| A compromised Hub pod | No RBAC bindings (SEC-7), hardened pod (SEC-8), NetworkPolicy (SEC-12), short sessions (SEC-6). Residual risk: tokens of active sessions sit in memory. |
| An over-privileged user token | Docs recommend a dedicated ServiceAccount per user with a scoped role; `readOnly` mode (SEC-9) |
| An Ingress exposed to the internet | Off by default; TLS required in docs; login rate limit (SEC-11) |
| Exposure of Secrets through the UI | Disabled unless `allowSecrets` is on (SEC-10) |

### 5.2 Request pipeline

Static assets and the SPA fallback are served first so the login page can load. Every `/api` request then passes these checks in order:

1. **Host:** reject with 403 unless the host is on the allow-list. The default list is `localhost`, `127.0.0.1` and the Ingress host when one is configured.
2. **Origin and CSRF:** for non-GET and non-HEAD requests, reject with 403 when `Origin` is present and does not match, or when the CSRF header is missing.
3. **Session:** reject with 401 unless the cookie maps to a live session. The login endpoint is exempt, and rate limited.
4. **Read-only:** reject mutating methods with 403 when `readOnly` is set.
5. **Handler:** call the API server with the session's token.

### 5.3 Session and cookie rules

- The session ID is a 256-bit random value from a cryptographic generator, compared in constant time.
- The cookie is `HttpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` when the request arrived over HTTPS (or `X-Forwarded-Proto: https` from a trusted proxy). Plain HTTP on `localhost` through port-forward is allowed.
- Sessions are stored in memory and are lost on restart, which forces a new login. This is why v0.1 runs one replica.
- A session ends when the token's `exp` claim passes, when the configured TTL passes, when the user logs out, or when the API server returns 401.
- The Hub sends `Content-Security-Policy: default-src 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `frame-ancestors 'none'`.

### 5.4 Example roles and token creation

The chart can install example roles (`rbac.createExampleRoles`). A viewer role needs only read access to RGDs and CRDs. Access to instances is granted per generated API group by the cluster admin, because those groups are defined by each RGD.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: krostudio-viewer
rules:
  - apiGroups: ["kro.run"]
    resources: ["resourcegraphdefinitions"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apiextensions.k8s.io"]
    resources: ["customresourcedefinitions"]
    verbs: ["get", "list", "watch"]
```

A user then gets a short-lived token like this:

```bash
kubectl create serviceaccount alice -n kro-system
kubectl create clusterrolebinding alice-krostudio \
  --clusterrole=krostudio-viewer --serviceaccount=kro-system:alice
kubectl create token alice -n kro-system --duration=8h
```

The API server may cap the requested duration, so the docs must say that tokens can expire sooner than asked.

## 6. Connection design

Connecting is a login plus a six-step checklist that names the exact step that failed.

### 6.1 Cluster address

The Hub reads `KUBERNETES_SERVICE_HOST` and `KUBERNETES_SERVICE_PORT` and trusts the CA certificate at the standard ServiceAccount path. No kubeconfig, context or loopback rewrite exists in the release image.

### 6.2 How users reach KroStudio

| Path | When | Setup |
| --- | --- | --- |
| Port-forward (default) | Individual use, trials | `kubectl port-forward -n kro-system svc/kro-studio 8080:80`, then open `http://localhost:8080`. `localhost` is on the Host allow-list by default. |
| Ingress with TLS | Shared use | Set `ingress.enabled`, `ingress.host` and `ingress.tls`. The chart adds the host to the allow-list and marks the cookie Secure. |
| In-cluster only | Other services call it | Leave the Service as ClusterIP and add the service DNS name to `allowedHosts`. |

### 6.3 Login screen

- A single token field and a sign-in button.
- The exact command to create a token, with the namespace filled in from chart values.
- A note that tokens expire and a link to the RBAC guide.
- Specific errors: "Token rejected or expired" (401), "KroStudio cannot reach the API server" (network), "Too many attempts" (rate limit).

### 6.4 Connection checklist

After login the UI runs these checks in order, shows pass or fail for each, and stops at the first failure.

| Step | Check | Message on failure |
| --- | --- | --- |
| 1. API reachable | `GET /version` with the in-cluster CA | "The pod cannot reach the API server. Check NetworkPolicy egress." |
| 2. Token valid | SelfSubjectReview | "Token rejected or expired. Create a new one with `kubectl create token`." |
| 3. kro installed | The `resourcegraphdefinitions.kro.run` CRD exists | "kro CRDs not found. Install kro first." |
| 4. kro version | Read from the kro controller deployment or CRD | Informational; warns when outside the supported range |
| 5. Controller ready | Controller deployment is available and RGD conditions are readable | A banner explaining the controller is not ready |
| 6. Permissions | SelfSubjectAccessReview for RGDs and instances | Not a failure: the UI hides actions the user cannot perform |

The detection source for steps 4 and 5 must be confirmed against kro 0.9.x before implementation.

### 6.5 Error mapping

- **401 from the API server:** end the session, return to login, show "token expired".
- **403 from the API server:** keep the session, show the verb, resource and API group that was denied.
- **Network or 5xx errors:** keep the session, show a retry option and the failing step from the checklist.

## 7. Image, chart and release

The release is one multi-arch image and one OCI Helm chart, both built and published by a single tag-triggered pipeline.

### 7.1 Image

The Hub serves the UI from `wwwroot`, so the runtime stage needs only the chiseled ASP.NET image.

```dockerfile
FROM node:24-alpine AS ui-build
WORKDIR /w
COPY src/Web/package*.json ./
RUN npm ci
COPY src/Web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /w
COPY src/Hub/KroStudio.Hub.csproj src/Hub/
RUN dotnet restore src/Hub/KroStudio.Hub.csproj
COPY src/Hub/ src/Hub/
RUN dotnet publish src/Hub/KroStudio.Hub.csproj -c Release -o /publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled AS runtime
WORKDIR /app
COPY --from=api-build /publish/ ./
COPY --from=ui-build /w/dist/ ./wwwroot/
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "KroStudio.Hub.dll"]
```

The chiseled image has no shell or curl, so the health check is built into the Hub (`--healthcheck`). Kubernetes probes call `/health` and `/ready` directly.

### 7.2 Chart contents

- Deployment with a hardened security context: `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, seccomp `RuntimeDefault`, and an `emptyDir` mounted at `/tmp`.
- Service (ClusterIP) and a ServiceAccount with no bindings.
- Optional Ingress and optional NetworkPolicy.
- Optional example ClusterRoles (`krostudio-viewer`, `krostudio-editor`).
- `values.schema.json` so bad values fail at install time.
- `NOTES.txt` that prints the port-forward command and the token command after install.

### 7.3 Key chart values

| Value | Default | Purpose |
| --- | --- | --- |
| `image.repository`, `image.tag` | GHCR image, chart appVersion | Image to run |
| `replicaCount` | 1 | Must stay 1 while sessions are in memory |
| `service.type` | ClusterIP | No external exposure by default |
| `ingress.enabled`, `ingress.host`, `ingress.tls` | false | Optional external access |
| `allowedHosts` | `localhost`, `127.0.0.1` | Host header allow-list |
| `config.readOnly` | false | Block all mutating endpoints |
| `config.allowSecrets` | false | Allow listing and reading Secrets |
| `session.ttl` | 8h | Upper bound on session length |
| `networkPolicy.enabled` | false | Restrict ingress and egress |
| `rbac.createExampleRoles` | false | Install the viewer and editor roles |
| `resources` | Small requests and limits | Pod sizing |

### 7.4 Release pipeline

Pushing a tag that matches `v*` runs these steps:

1. Build the UI once and publish the Hub.
2. Build and push the multi-arch image (amd64 and arm64) to GHCR with the version tag.
3. Package the chart with the same version and push it to the OCI registry.
4. Create a kind cluster, install the chart, and check that `/ready` returns success (smoke test).
5. Create the GitHub Release with notes and the checksums of any attached files.

Users then install with:

```bash
helm install kro-studio oci://ghcr.io/<owner>/charts/kro-studio \
  --version 0.1.0 -n kro-system --create-namespace
```

## 8. To-do lists

Six phases take v0.1 from decisions to a tested release. Each phase ends with an exit criterion, so it is clear when to move on.

### Phase 0: Decisions

- [ ] Choose the repository name, license and GHCR owner.
- [ ] Choose the chart name and namespace default (`kro-system`).
- [ ] Decide whether v0.1 documents Ingress or only port-forward.
- [ ] Decide the default session TTL (proposed: 8 hours).

Exit: the open questions in section 9.4 have answers.

### Phase 1: Single-process image (DEP-1 to DEP-3)

- [ ] Serve static files and the SPA fallback from the Hub (`wwwroot`).
- [ ] Add `/health` and `/ready`, and the `--healthcheck` mode.
- [ ] Switch the Dockerfile to the chiseled image on port 8080.
- [ ] Delete `nginx.conf`, `supervisord.conf` and the apt layer.
- [ ] Remove the CORS settings from release builds and replace `AllowedHosts: "*"` with the configured allow-list.
- [ ] Check that deep links and page refresh work in the SPA.

Exit: the image runs one process, serves the UI and API on port 8080 and passes its health check.

### Phase 2: Login, session and request checks (SEC-1 to SEC-6, SEC-9, SEC-13, DEV-1)

- [ ] Build the in-cluster client factory (service host and port, mounted CA, bearer token per session).
- [ ] Implement login: SelfSubjectReview, session creation, HttpOnly SameSite=Strict cookie.
- [ ] Implement the in-memory session store with TTL, token expiry and logout.
- [ ] Add the request pipeline: Host, Origin and CSRF header, session, read-only.
- [ ] Add security response headers and a strict Content-Security-Policy.
- [ ] Add login rate limiting (SEC-11).
- [ ] Add the login screen, CSRF header on every UI mutation, and 401 and 403 handling in the UI.
- [ ] Audit logging to confirm that no token, cookie or Authorization header is logged.
- [ ] Add the Development-only kubeconfig loader, and make the Hub refuse to start with it outside Development.
- [ ] Write tests: no session returns 401, bad Host returns 403, cross-origin POST returns 403, read-only blocks writes.

Exit: automated tests show that no API operation succeeds without a valid session, from another origin or with a wrong Host.

### Phase 3: Connection checklist (CON-2 to CON-6)

- [ ] Implement the six-step checklist endpoint and screen.
- [ ] Confirm the kro version and controller detection sources against kro 0.9.x.
- [ ] Remove the static `KroVersion` setting.
- [ ] Use SelfSubjectAccessReview results to hide or disable actions the user cannot perform.
- [ ] Map 401, 403 and network errors to the messages in section 6.5.

Exit: each failure type (no API access, bad token, no kro, controller not ready, no permission) shows its own message.

### Phase 4: Helm chart (DEP-5 to DEP-7, SEC-7, SEC-8, SEC-12)

- [ ] Write the Deployment with the hardened security context and probes.
- [ ] Write the Service, ServiceAccount (no bindings), optional Ingress and optional NetworkPolicy.
- [ ] Write the optional example ClusterRoles.
- [ ] Add `values.schema.json` and `NOTES.txt`.
- [ ] Run `helm lint` and `helm template` checks in CI.

Exit: `helm install` on a clean kind cluster produces a running pod whose `/ready` succeeds.

### Phase 5: Release pipeline and docs (DEP-4, DEP-8, DEP-9, CON-7, NFR-3)

- [ ] Write the tag-triggered workflow (image, chart, smoke test, GitHub Release).
- [ ] Publish the image and chart to GHCR as `v0.1.0-rc1`.
- [ ] Write the README: quick start, access guide, token and RBAC guide, threat model summary.
- [ ] Install the release candidate on a clean cluster using only the README.

Exit: a stranger can install and log in using the README alone.

### Phase 6: Acceptance test

- [ ] Create two users with different RBAC (one viewer, one editor) on a kind cluster.
- [ ] Confirm each sees and can do only what their role allows, including instances of a generated CRD.
- [ ] Confirm the API server audit log shows each real user.
- [ ] Confirm `readOnly` blocks writes for the editor.
- [ ] Confirm that an expired token returns the user to login.
- [ ] Tag `v0.1.0`.

Exit: all checks above pass on a fresh cluster.

## 9. Testing, risks and next steps

The largest v0.1 risk is login friction from short-lived pasted tokens, and OIDC in v0.2 is the planned fix.

### 9.1 Testing

- **Unit tests:** session store, cookie flags, Host and Origin checks, token-expiry handling and error mapping.
- **Integration tests:** the Hub against a kind cluster in CI, covering login, the connection checklist, read-only mode and per-user RBAC.
- **Security tests:** automated checks for a missing session, a wrong Host, a cross-origin mutation, and that logs contain no tokens.
- **Compatibility:** the chart installed on kind and one other distribution (for example k3s), with the current and previous kro minor versions.
- **Release check:** install the release candidate from the published chart on a clean cluster before tagging.

### 9.2 Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Pasted tokens expire quickly (an hour by default) | Users re-login often and may give up | Clear expiry message, docs for longer durations, OIDC in v0.2 |
| Sessions are in memory | A restart forces re-login; no replicas above 1 | Document it, keep `replicaCount` at 1, move to shared sessions later |
| A compromised pod exposes tokens of active sessions | High | Short sessions, hardened pod, NetworkPolicy; impersonation in v0.2 removes stored user tokens |
| kro API or CRD changes between versions | Breakage in the UI | Version detection, compatibility matrix, tests on two kro versions |
| SelfSubjectReview requires Kubernetes 1.28 or newer | Older clusters cannot log in | State the minimum version; optionally fall back to an access-review probe |
| An Ingress without TLS is exposed to the internet | Token interception | Off by default; docs and chart warn; Secure cookie when HTTPS |

### 9.3 After v0.1

- OIDC login with PKCE, and impersonation: the Hub's ServiceAccount then needs only the `impersonate` verb on users and groups.
- Dry-run preview with diff, and typed delete confirmations (WS-1, WS-2).
- Mutation audit log (WS-3) and live updates through watch and server-sent events (CON-8).
- Signed images and charts, SBOM and digest-pinned bases (SEC-14).
- Shared or persisted sessions so the Hub can run more than one replica.
- A single binary and package-manager installs, only if users ask for a local mode.

### 9.4 Open questions

1. What are the repository name, license and GHCR owner?
2. Does v0.1 document Ingress, or only port-forward access?
3. Is 8 hours the right default session TTL, given that tokens may expire sooner?
4. Should the chart ship the example ClusterRoles, or only document them?
5. Is the first audience individual platform engineers or teams sharing a cluster? This sets how soon OIDC is needed.
