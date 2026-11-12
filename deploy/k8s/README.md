# Helm deployment

This chart deploys one KRO Studio Hub pod behind a ClusterIP Service. It creates a
ServiceAccount but deliberately grants it no Kubernetes Roles or bindings. Review and
grant the minimum Kubernetes permissions needed by the selected features separately.
All signed-in users share that service account as their Kubernetes identity. Do not grant
cluster-admin. The chart requires OIDC; `UserAuth:Mode=none` is restricted to local
Development listeners.

Shared deployments require OIDC. Before installation, choose an image tag or digest,
set the OIDC authority and client ID, and list every external hostname accepted by the
Hub. The OIDC client must allow the callback URI `https://<host>/signin-oidc`, unless
`auth.oidc.redirectUri` explicitly sets another URI. Put client secrets in a Kubernetes
Secret and pass its name with `auth.oidc.clientSecret.secretName`; do not put secrets in
values files. TLS should terminate at the ingress or a trusted reverse proxy. If a
proxy sends forwarded headers, list its IP address under `auth.trustedProxies`.

```sh
helm upgrade --install kro-studio deploy/k8s \
  --namespace kro-studio --create-namespace \
  --set image.repository=ghcr.io/OWNER/kro-studio \
  --set image.tag=VERSION \
  --set auth.oidc.authority=https://login.example.com/realms/kro \
  --set auth.oidc.clientId=kro-studio \
  --set 'auth.allowedHosts[0]=studio.example.com' \
  --set ingress.enabled=true \
  --set ingress.host=studio.example.com \
  --set ingress.tls.secretName=kro-studio-tls
```

Use a digest instead of a mutable tag for a reproducible deployment by setting
`image.digest=sha256:<64 hex digits>` and leaving `image.tag` empty. The chart rejects
replica counts other than one because the OIDC ticket store is in memory. Session
lifetime is capped at 24 hours; the default is eight hours. Set `readOnly=true` to reject
all mutating `/api/v1` requests on the server.

Ingress and NetworkPolicy are optional. A NetworkPolicy, when enabled, allows DNS and
requires `networkPolicy.egress.additionalRules` for the Kubernetes API endpoint and any
OIDC endpoint; its ingress selectors should match only the ingress controller or trusted
caller pods. NetworkPolicy enforcement depends on the cluster CNI.

The pod runs as UID/GID 1654, with a read-only root filesystem, no Linux capabilities,
no privilege escalation, RuntimeDefault seccomp, and a size-limited writable `/tmp`.
Liveness uses the built-in `--healthcheck` command and `/health`; readiness probes `/ready`,
which reports ready only after the configured Kubernetes API responds.

Validate locally with `helm lint deploy/k8s` and `helm template kro-studio deploy/k8s`.
The `Build and chart validation` workflow runs on pull requests and branch updates. It
also installs the chart on a fresh kind cluster and waits for `/ready`; the release
workflow reuses these checks before publishing.

## Install a published release

The Release workflow publishes a versioned image and chart when a `v*` tag is pushed.
For example, the `v0.1.0-rc1` tag publishes chart version `0.1.0-rc1` and the image tag
`v0.1.0-rc1`. The workflow installs the published OCI chart into a new kind cluster and
checks `/ready` before it creates the GitHub prerelease.

Create `values-production.yaml` with deployment-specific settings. Do not commit OIDC
client secrets in that file; create the Kubernetes Secret separately. A minimal starting
file is:

```yaml
image:
  repository: ghcr.io/OWNER/REPOSITORY
  tag: v0.1.0-rc1
  pullPolicy: IfNotPresent
auth:
  allowedHosts:
    - studio.example.com
  oidc:
    authority: https://login.example.com/realms/kro
    clientId: kro-studio
    clientSecret:
      secretName: kro-studio-oidc
ingress:
  enabled: true
  host: studio.example.com
  tls:
    enabled: true
    secretName: kro-studio-tls
```

Install that exact candidate from OCI on a clean cluster:

```sh
helm upgrade --install kro-studio oci://ghcr.io/OWNER/charts/kro-studio \
  --version 0.1.0-rc1 --namespace kro-studio --create-namespace \
  --values values-production.yaml
kubectl rollout status deployment/kro-studio-kro-studio -n kro-studio --timeout=180s
kubectl port-forward -n kro-studio svc/kro-studio-kro-studio 18080:80
```

In another terminal, verify the readiness endpoint using the configured allowed host:

```sh
curl --fail --header 'Host: studio.example.com' http://127.0.0.1:18080/ready
```

The release workflow performs the automated kind smoke install. This manual installation
also verifies the published candidate and operator-provided OIDC, TLS, host, and RBAC
settings on the target cluster. See the [deployment and security design](../../docs/design-document-modes-security-deployment.md)
and [authentication and RBAC guide](../../docs/authentication-and-rbac.md) for threat
model, identity mode, and least-privilege guidance.
