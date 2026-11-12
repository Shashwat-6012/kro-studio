# KRO Studio

KRO Studio is a local-first workspace for managing KRO ResourceGraphDefinitions and their generated custom resource APIs. The ASP.NET Core Hub and React/Vite UI run as separate projects during development; the release image builds the UI into the Hub so one process serves the app and API.

## Projects

- `src/Web`: React, TypeScript, and Vite UI.
- `src/Hub`: .NET 10 Minimal API and Kubernetes client integration.
- `deploy/docker`: single-image UI and API container packaging.
- `docs`: product requirements, architecture, and authentication/RBAC design.

Backend code uses capability-based feature folders. Each feature owns its routes, request validation, and application service; Kubernetes client creation and API error mapping live in shared infrastructure. Nullable reference types and warnings-as-errors are enabled.

## Run locally

Prerequisites: .NET 10 SDK, Node.js 24, and npm.

Run the API and UI as separate processes:

1. From the repository root, start the API with `dotnet run --project src/Hub --launch-profile http`. It listens at `http://localhost:5244`.
2. In another terminal, start the UI with `cd src/Web`, then `npm run dev`.
3. Open the Vite URL printed in the UI terminal (normally `http://localhost:5173`).

The API exposes its versioned routes under `/api/v1`, a liveness endpoint at `/health`, and Kubernetes-backed readiness at `/ready`. In local development, Vite serves the UI and forwards `/api` requests to the API. The Docker image builds the UI into the Hub's `wwwroot`, where the Hub serves static assets and the SPA fallback. If a separately hosted UI calls the API directly, add its origin to `Cors:AllowedOrigins` in API configuration.

Both processes can start without a cluster. The API reports a disconnected state until Kubernetes is reachable. Set `KUBECONFIG` and optionally `KUBECONTEXT` before starting the API, or set `Kubernetes:KubeconfigPath` and `Kubernetes:Context` in configuration. Credentials remain on the backend.

When a cluster is connected but KRO's `ResourceGraphDefinition` API is missing, the Studio shows an installation banner. Confirming installation applies the official KRO release manifest (default version `0.9.4`) to the connected cluster using the API's Kubernetes identity. The identity needs permission to create cluster-scoped resources, including CRDs and RBAC roles. Change `Kubernetes:KroVersion` to select a different stable KRO release.

## Backend API

- `GET /api/v1/connection` and `/api/v1/capabilities` report cluster and KRO discovery state. `GET /api/v1/kro-installation` reports the configured install version; `POST /api/v1/kro-installation` installs the pinned official KRO raw release manifest when KRO is not already detected.
- `POST /api/v1/kro-controller/restart` requests a rolling restart of the `kro-system/kro` controller deployment.
- `/api/v1/rgds` supports list, read, YAML/JSON dry-run validation, create, update, delete, and `POST /api/v1/rgds/{name}/retry` to request another reconciliation.
- `/api/v1/rgds/{name}/api` resolves a definition to its served generated API through Kubernetes discovery.
- `/api/v1/rgds/{name}/instances` and `/api/v1/apis/{apiId}/instances` support paged list, read, create, update, and delete. Instance conditions/status are returned with the Kubernetes object; `/{instanceName}/events` reads related events.
- `/{instanceName}/resources` inspects only resource kinds declared by the RGD and matches KRO's `kro.run/instance-id` ownership label. Secret objects are skipped; forbidden or undiscovered types are reported as partial results.
- Kubernetes authentication, authorization, validation, conflict, timeout, and availability errors are returned as Problem Details responses.

Validation uses Kubernetes server-side dry-run and does not persist the RGD. KRO acceptance is reported later through the stored RGD conditions. Dynamic API discovery does not enable instance operations until the resource is present in API discovery.

## Deploy with Helm

Shared and release deployments require OIDC. The chart uses a single pod with the Kubernetes ServiceAccount as its cluster identity; the chart intentionally creates no RoleBindings. Before exposing it, configure an OIDC provider, TLS, the allowed hostname, trusted proxy addresses where applicable, and only the Kubernetes permissions the intended workflows need. The [Helm deployment guide](deploy/k8s/README.md) has the full setup. The [authentication and RBAC guide](docs/authentication-and-rbac.md) explains the identity choices and permissions.

The chart and image are published by pushing a version tag such as `v0.1.0-rc1`. The [release workflow](.github/workflows/release.yml) builds both supported image architectures, publishes the OCI chart, installs it on a fresh kind cluster, checks `/ready`, and creates a GitHub Release with generated notes and artifact checksums after the smoke install passes.

## Run the UI and API in Docker

Compose builds one image containing the React UI and ASP.NET Core Hub. The Hub serves the UI from `wwwroot`, provides the SPA fallback, and handles `/api` requests on the same origin. The Hub reads the mounted kubeconfig.

```powershell
$env:KUBECONFIG_PATH = "$HOME\.kube\config"
docker compose -f deploy/docker/docker-compose.yml up --build
```

Open `http://127.0.0.1:8080` to use the UI. The UI and `/api/v1` endpoints share that origin; `/health` checks liveness and `/ready` checks Kubernetes API readiness. Set `UI_PORT` to change the host port and `KUBECONTEXT` to select a kubeconfig context. Compose publishes one port for the combined Hub and UI. Keep this local workflow private; cluster operations use the configured kubeconfig identity. For shared access, use the OIDC-protected Helm deployment.

## Current backend capabilities

- Cluster connectivity and Kubernetes version reporting.
- KRO ResourceGraphDefinition API discovery and catalog/manifest reads.
- RGD dry-run validation and cluster-scoped create, update, and delete.
- Manual KRO controller restart and per-RGD reconciliation retry.
- Generated API resolution by declared group/kind and Kubernetes API discovery, including scope and OpenAPI schema.
- Dynamic custom resource list, read, create, update, delete, and related Kubernetes event retrieval.
- Read-only composed-resource inspection using KRO ownership labels and RGD-declared API types.
- Stable Problem Details mapping for expected Kubernetes failures.

Composed-resource inspection is limited to data that can be associated reliably. It does not scan undeclared resource types or return Secret payloads. Cross-namespace template expressions that cannot be resolved from the instance or manifest may appear as incomplete inspection.
