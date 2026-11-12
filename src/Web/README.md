# KRO Studio web UI

React, TypeScript, and Vite frontend for the KRO Studio Hub. The app calls the Hub's same-origin `/api/v1` routes; Kubernetes credentials stay on the backend.

## Run locally

From the repository root, start the Hub in one terminal:

```sh
dotnet run --project src/Hub --launch-profile http
```

In another terminal:

```sh
cd src/Web
npm ci
npm run dev
```

Vite binds to loopback (normally <http://localhost:5173>) and forwards `/api`, `/auth`, and OIDC callback routes to the Hub at `http://127.0.0.1:8080`. The Hub's `http` launch profile enables login-free Development mode on loopback. For a Kubernetes-backed session, configure `KUBECONFIG` to a disposable cluster first.

## Build

```sh
npm run build
```

The Docker build runs this build and copies the generated `dist` files into the Hub's `wwwroot`; a deployed container serves UI and API from one process.

## Structure

- `src/app`: application layout, navigation, auth and namespace providers, and routes.
- `src/api`: API contracts, request client, endpoint functions, query hooks, and query keys.
- `src/features`: pages grouped by overview, RGDs, generated APIs, instances, cluster status, and RBAC.
- `src/features/instances/graph`: model, layout, React Flow graph, resource nodes, and inspector.
- `src/components`: shared tables, editors, dialogs, status badges, and controls.
- `src/lib`: Kubernetes object helpers, YAML conversion, status mapping, formatting, and local preferences.
- `src/styles`: tokens, shared layout/components, and feature styles.

Keep Kubernetes authorization and validation on the server. The UI may hide unavailable operations for clarity, but it must not be treated as a security boundary. See the [architecture guide](../../docs/architecture-and-design.md) and [contribution guide](../../CONTRIBUTING.md).
