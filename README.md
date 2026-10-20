# KRO Studio

KRO Studio is a local-first workspace for managing KRO ResourceGraphDefinitions and their generated custom resource APIs. The backend is an independent ASP.NET Core API. The React/Vite UI remains a separate project and is not built, copied, or served by the backend.

## Projects

- `src/KroStudio.UI`: React, TypeScript, and Vite UI.
- `src/KroStudio.Web`: .NET 10 Minimal API and Kubernetes client integration.
- `deploy/docker`: API-only container packaging.
- `docs`: product requirements, architecture, and authentication/RBAC design.

Backend code uses capability-based feature folders. Each feature owns its routes, request validation, and application service; Kubernetes client creation and API error mapping live in shared infrastructure. Nullable reference types and warnings-as-errors are enabled.

## Run locally

Prerequisites: .NET 10 SDK, Node.js 24, and npm.

Run the API and UI as separate processes:

1. From the repository root, start the API with `dotnet run --project src/KroStudio.Web --launch-profile http`. It listens at `http://localhost:5244`.
2. In another terminal, start the UI with `cd src/KroStudio.UI`, then `npm run dev`.
3. Open the Vite URL printed in the UI terminal (normally `http://localhost:5173`).

The API exposes its versioned routes under `/api/v1` and a liveness endpoint at `/health`. It returns no HTML or static assets. Vite forwards `/api` requests to the API in local development. If the UI uses a different origin, add it to `Cors:AllowedOrigins` in API configuration.

Both processes can start without a cluster. The API reports a disconnected state until Kubernetes is reachable. Set `KUBECONFIG` and optionally `KUBECONTEXT` before starting the API, or set `Kubernetes:KubeconfigPath` and `Kubernetes:Context` in configuration. Credentials remain on the backend.

When a cluster is connected but KRO's `ResourceGraphDefinition` API is missing, the Studio shows an installation banner. Confirming installation applies the official KRO release manifest (default version `0.9.4`) to the connected cluster using the API's Kubernetes identity. The identity needs permission to create cluster-scoped resources, including CRDs and RBAC roles. Change `Kubernetes:KroVersion` to select a different stable KRO release.

## Backend API

- `GET /api/v1/connection` and `/api/v1/capabilities` report cluster and KRO discovery state. `GET /api/v1/kro-installation` reports the configured install version; `POST /api/v1/kro-installation` installs the pinned official KRO raw release manifest when KRO is not already detected.
- `/api/v1/rgds` supports list, read, YAML/JSON dry-run validation, create, update, and delete.
- `/api/v1/rgds/{name}/api` resolves a definition to its served generated API through Kubernetes discovery.
- `/api/v1/rgds/{name}/instances` and `/api/v1/apis/{apiId}/instances` support paged list, read, create, update, and delete. Instance conditions/status are returned with the Kubernetes object; `/{instanceName}/events` reads related events.
- `/{instanceName}/resources` inspects only resource kinds declared by the RGD and matches KRO's `kro.run/instance-id` ownership label. Secret objects are skipped; forbidden or undiscovered types are reported as partial results.
- Kubernetes authentication, authorization, validation, conflict, timeout, and availability errors are returned as Problem Details responses.

Validation uses Kubernetes server-side dry-run and does not persist the RGD. KRO acceptance is reported later through the stored RGD conditions. Dynamic API discovery does not enable instance operations until the resource is present in API discovery.

## Run the API in Docker

The image contains the API only. It neither installs Node.js nor builds or includes the UI.

```powershell
$env:KUBECONFIG_PATH = "$HOME\.kube\config"
docker compose -f deploy/docker/docker-compose.yml up --build
```

Open `http://127.0.0.1:8080/health` to check that the API is running. Run the UI using its own development server or deployment. Do not expose the unauthenticated MVP API to a shared network; cluster operations use the configured kubeconfig identity.

## Current backend capabilities

- Cluster connectivity and Kubernetes version reporting.
- KRO ResourceGraphDefinition API discovery and catalog/manifest reads.
- RGD dry-run validation and cluster-scoped create, update, and delete.
- Generated API resolution by declared group/kind and Kubernetes API discovery, including scope and OpenAPI schema.
- Dynamic custom resource list, read, create, update, delete, and related Kubernetes event retrieval.
- Read-only composed-resource inspection using KRO ownership labels and RGD-declared API types.
- Stable Problem Details mapping for expected Kubernetes failures.

Composed-resource inspection is limited to data that can be associated reliably. It does not scan undeclared resource types or return Secret payloads. Cross-namespace template expressions that cannot be resolved from the instance or manifest may appear as incomplete inspection.
