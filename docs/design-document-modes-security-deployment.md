# KRO Studio deployment, security, and release design

**Status:** Current implementation and operational guidance
**Last reviewed:** November 11, 2026

This document describes the modes that KRO Studio currently supports. The earlier Helm-only plan with pasted ServiceAccount tokens has been superseded by local kubeconfig support, OIDC sign-in, and Kubernetes service-account or impersonation modes.

## 1. Product and deployment modes

KRO Studio is a local-first workspace. The Hub is an ASP.NET Core API; the React UI can run separately with Vite during development, or be built into the Hub and served from the same origin in the Docker image and Helm deployment.

| Mode | User sign-in | Kubernetes identity | Intended use |
| --- | --- | --- | --- |
| Local development | OIDC with a local provider, or `none` in the Development environment | Local kubeconfig/context | Individual developer workstation |
| Docker Compose | OIDC recommended; unauthenticated mode is restricted to local Development listeners | Mounted kubeconfig | Local evaluation and development |
| Helm shared deployment | OIDC required | Pod service account shared by signed-in users | Team deployment where the shared identity has carefully scoped RBAC |
| OIDC impersonation | OIDC required | Kubeconfig-backed base identity impersonates the verified username and groups | Deployment needing Kubernetes audit identity per signed-in user |

OIDC login and Kubernetes authorization are separate. Signing in proves the web identity; Kubernetes still authorizes each backend operation. In the default Helm mode, every signed-in user operates with the pod service account's Kubernetes permissions. Impersonation requires a trusted OIDC claim mapping and a base kubeconfig identity allowed to impersonate those users and groups.

## 2. Security boundaries and threat model

KRO Studio handles two sensitive boundaries: browser access to the application and backend access to the Kubernetes API. Operators should account for these threats:

| Threat | Mitigation and remaining responsibility |
| --- | --- |
| Anonymous visitor uses the application identity | Release and shared deployments require OIDC. `UserAuth:Mode=none` is limited to local Development listeners. Keep the service private until OIDC is configured. |
| Cross-site request changes data using a user's session | Antiforgery token checks protect unsafe API requests and logout. Use the same browser-facing origin and TLS for shared use. |
| Host-header abuse or spoofed proxy headers | Configure an explicit `auth.allowedHosts` list. Configure `auth.trustedProxies` only for the actual proxy addresses. |
| Stolen or over-privileged Kubernetes credentials | Keep kubeconfigs and OIDC secrets out of images, repositories, browser state, and ordinary settings. Grant only the required verbs and scopes. Consider impersonation where per-user Kubernetes identity is needed. |
| Compromised Hub pod | The chart runs as non-root with a read-only root filesystem, dropped capabilities, seccomp, and no role bindings by default. The pod's configured identity and active server-side OIDC tickets remain sensitive. Restrict network access and Kubernetes permissions. |
| Secret contents appear in the UI | Secret reads are excluded by default. Keep Secret permissions out of broad read grants and audit all response paths before enabling any future Secret workflow. |
| Traffic or session cookie intercepted | Terminate TLS at the ingress or a trusted proxy. Forwarded scheme/host values are honored only from configured trusted proxies. |
| Risky RGD grants broad controller capabilities | Review KRO access-control behavior and restrict RGD authors. KRO Studio RBAC and KRO controller RBAC are distinct. |

The chart creates a ServiceAccount but no RoleBindings or ClusterRoleBindings. Grant only the permissions needed for enabled workflows. If using the chart's service-account mode, bind the minimum permissions to that ServiceAccount. Do not grant `cluster-admin` for convenience.

## 3. Authentication and session behavior

Shared and release deployments use OIDC authorization-code sign-in. The browser receives an HttpOnly cookie with an opaque key; the authentication ticket is stored server-side. OIDC tokens are not exposed to the React app. The default cache is in memory and the chart enforces one replica; restarting the pod ends existing sessions. Session lifetime is configurable up to 24 hours.

The Hub validates the configured host allow-list and CSRF token for unsafe API requests and logout. Configure TLS at the browser-facing endpoint. If TLS ends at a proxy, add only that proxy's addresses to the trusted proxy list. Configure the OIDC provider's callback URI as `https://<host>/signin-oidc` or set an explicit redirect URI.

For local development, the Hub may use `UserAuth:Mode=none` only when running in Development and listening on loopback. Local OIDC can be exercised with the [Keycloak guide](local-keycloak-oidc.md). See [Authentication and RBAC](authentication-and-rbac.md) for the detailed identity model and permission guidance.

## 4. Kubernetes identity and least privilege

The Hub supports two Kubernetes authentication modes:

- **Service account:** in-cluster configuration uses the pod's ServiceAccount. A local process can use the selected kubeconfig context through `KUBECONFIG`, `KUBECONTEXT`, or `Kubernetes:KubeconfigPath` / `Kubernetes:Context`.
- **Impersonation:** requires OIDC and a kubeconfig-backed base identity. The Hub forwards the configured username and group claims as Kubernetes impersonation headers. The base identity must be allowed to impersonate those users/groups. It cannot use in-cluster credentials.

Kubernetes RBAC is authoritative. RGD authoring is cluster-scoped and high trust because KRO may create resources on behalf of an RGD. Generated instance permissions depend on the resource's scope and approved API groups. Grant only required read/write verbs; bind namespaced grants with namespace RoleBindings where possible. The chart leaves RBAC empty so the operator can review and provision it separately. The [authentication and RBAC guide](authentication-and-rbac.md) includes operation-specific guidance.

Never place kubeconfig data, client keys, tokens, or OIDC secrets in source control, image layers, static web assets, or browser storage. Mount runtime credential files read-only where practical. Treat exec credential plugins as code running with the Hub process's privileges.

## 5. Chart and image

The Docker image builds the React UI and .NET Hub into one image. Its runtime base image is the chiseled ASP.NET image; the Node and .NET build/runtime images are pinned by digest. It runs as a non-root user and includes a built-in `--healthcheck` command. `/health` is liveness; `/ready` checks Kubernetes API availability.

The Helm chart provides a single-replica Deployment, ClusterIP Service, unbound ServiceAccount, optional TLS Ingress, optional NetworkPolicy, resource settings, `readOnly`, OIDC configuration, trusted proxy/host settings, and a schema-validated values file. See the [Helm deployment guide](../deploy/k8s/README.md).

## 6. Release process

Pushing a semantic version tag such as `v0.1.0-rc1` starts the GitHub Actions Release workflow. It builds and publishes `linux/amd64` and `linux/arm64` images to GHCR, packages and publishes the chart as OCI, installs the published chart into a fresh kind cluster, and checks `/ready`. If the smoke install succeeds, the workflow creates a GitHub Release with generated notes, the packaged chart, its SHA-256 checksum, and the image digest. Tags containing a prerelease suffix create a prerelease.

Install a published chart with:

```sh
helm upgrade --install kro-studio oci://ghcr.io/OWNER/charts/kro-studio \
  --version 0.1.0 -n kro-studio --create-namespace \
  -f values-production.yaml
```

Prepare `values-production.yaml` with the published image repository/tag, OIDC issuer and client ID, allowed public hostname, TLS ingress, and (when required) the name of a Kubernetes Secret containing the OIDC client secret. Follow the chart notes to confirm readiness. The release workflow's kind install smoke test checks chart/image startup and Kubernetes API readiness; it does not validate a specific identity provider, production ingress, or RBAC policy.

## 7. Decisions and follow-ups

- Pasted ServiceAccount tokens and a Helm-only product scope are superseded by OIDC and local kubeconfig support.
- Local kubeconfig support is an intended workflow, not a Development-only exception. Shared use requires explicit user authentication.
- Optional write-safety items still need a product decision: dry-run diff before create/update, typed delete confirmation, and listing affected instances before deleting an RGD.
- Signed artifacts, an SBOM, and publication of image/chart attestations remain release-hardening work.
- A published release candidate still needs an operator to install it on a clean target cluster using only the documented steps and record any missing or ambiguous instructions.
