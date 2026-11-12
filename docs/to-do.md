# Pending work

This list was reconciled against `design-document-modes-security-deployment.md` and the current Hub, UI, and deployment files on 2026-11-11. The old Helm-only, pasted-token plan is superseded; current code supports OIDC and Kubernetes impersonation, plus local kubeconfig use. Items below are work that remains or needs an explicit security verification.

For the user-facing priorities, see the [project roadmap](roadmap.md). This checklist retains detailed implementation and security follow-up items.

## Security and authentication

- [x] Make the authentication mode explicit and fail closed for shared or release deployments. `UserAuth:Mode=none` must be limited to local single-user use; a deployment must not silently start unauthenticated when auth configuration is absent.
- [x] Add request Host validation with a configured allow-list. Keep `AllowedHosts: "*"` from acting as the production policy, and honor forwarded host/protocol values only from configured trusted proxies.
- [ ] Complete CSRF checks for every unsafe API request and logout: require the CSRF header and validate `Origin` against the request origin. Preserve the current antiforgery token flow and verify behavior in each supported auth mode. (Checks are implemented; mode-by-mode security verification remains.)
- [x] Tighten session rules: use the intended strict SameSite policy where compatible with the OIDC flow, enforce a hard maximum session lifetime rather than indefinitely extending it, and use a cryptographically random opaque ticket key meeting the design’s 256-bit target. Keep authentication tickets server-side.
- [ ] Add security response headers, including a tested Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, and frame protection.
- [x] Rate-limit login and other authentication entry points by client address, accounting only for forwarded client addresses from trusted proxies.
- [ ] Add an API-wide check that Secrets are never returned by default. Composed-resource inspection already skips Secret objects; verify all other resource and diagnostic paths preserve that rule. (Generated API reads now reject Secret kinds; full path audit remains.)
- [ ] Review exception and request logging so bearer tokens, cookies, OIDC tokens, authorization headers, kubeconfig contents, and credential-bearing settings cannot appear in logs or error responses. Keep permission errors actionable without returning sensitive upstream details.
- [ ] Add security verification for anonymous API access, Host rejection, cross-origin writes, CSRF failures, session expiry, read-only enforcement (when added), Secret omission, and credential-free logs.

## Runtime and deployment

- [x] Add the Helm chart. Include a schema-validated values file, single-replica Deployment, ClusterIP Service, ServiceAccount without RoleBindings or ClusterRoleBindings, optional TLS Ingress, optional NetworkPolicy, and install notes.
- [x] Harden the charted pod: non-root, read-only root filesystem, all capabilities dropped, no privilege escalation, RuntimeDefault seccomp, and a writable `/tmp` volume. Keep the pod’s Kubernetes permissions empty unless a separately reviewed deployment mode needs them.
- [x] Add chart settings for authentication, trusted hosts/proxies, session lifetime, `readOnly`, resources, and optional networking. Ensure secure defaults and reject invalid combinations in the schema.
- [x] Implement `readOnly` as a server-side setting that rejects every mutating endpoint, regardless of UI visibility.
- [x] Finish runtime image hardening: move from the general ASP.NET runtime image to the chiseled image and pin the Node, .NET build, and runtime base images by digest. The current Docker image already runs as non-root and serves the UI and API from one process.
- [x] Add `/ready` for Kubernetes API readiness and a Hub `--healthcheck` mode; configure Kubernetes liveness/readiness probes. `/health` remains liveness-only.
- [x] Add Helm lint/template validation and a fresh-kind-cluster install smoke test that checks `/ready`.

## Release and documentation

- [x] Add the release workflow: build and publish linux/amd64 and linux/arm64 images, package and publish the Helm chart as OCI, run the install smoke test, and create a GitHub Release with notes and checksums.
- [ ] Publish a release candidate and install it on a clean cluster using only the documented instructions.
- [x] Update the design document and deployment/authentication docs to match the implemented OIDC/impersonation and local-development model. Remove or mark as superseded the pasted-ServiceAccount-token flow, Helm-only scope, and development-only kubeconfig prohibition.
- [x] Document the shared-deployment threat model, authentication requirements, trusted proxy and TLS setup, least-privilege Kubernetes permissions, and the risk of enabling the unauthenticated local mode.

## Product follow-ups

- [ ] Improve Forbidden feedback so the UI consistently identifies the denied operation and resource/scope when Kubernetes provides that information. The API already maps 403 responses to a dedicated `kubernetes_forbidden` problem code; confirm the displayed detail is safe and specific across all screens.
- [ ] Complete instance creation follow-through: show the created instance’s reconciliation status, surface failed KRO conditions and related events, and make the next troubleshooting action clear.
- [ ] Decide whether to implement and document the design’s optional v0.2 write-safety items: dry-run diff before create/update, typed delete confirmation, and listing affected instances before deleting an RGD.

## Later release hardening

- [ ] Add signed release artifacts and an SBOM, and publish image/chart digests (design item SEC-14).

## Verified as already implemented or superseded

- The Hub serves the built UI and API on the same origin from one process; nginx and supervisord are not part of the current image.
- OIDC authorization-code login, PKCE, server-side authentication tickets, CSRF request tokens, API authorization, and Kubernetes impersonation are implemented. These replace the design doc’s pasted-token v0.1 login proposal, but the security hardening tasks above remain.
- The Docker runtime and chart use a non-root user; the chart also uses a read-only root filesystem and hardened pod security settings.
- Composed-resource inspection skips Secret objects. This does not by itself verify every API response path.
- Kubernetes-backed error mapping already distinguishes 401 authentication failures from 403 permission failures; clearer, consistent UI detail remains open.
- Local kubeconfig support is part of the current local-first workflow, so the old requirement to prohibit kubeconfig outside Development is superseded by the current product design.
