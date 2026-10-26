# KRO Studio UI — modular rewrite

## Wire-up
1. Delete `src/ui/` (old App.tsx + styles.css). Replace `src/main.tsx` with the one here.
2. Copy `src/{app,api,components,features,hooks,lib,styles}` into your `src/`.
3. Merge the dependencies from `package.json` and run `npm install`:
   `@tanstack/react-query @xyflow/react @dagrejs/dagre react-router-dom yaml`
4. SPA fallback: the server that hosts the built UI must return `index.html` for unknown paths
   (Vite dev does this already; for .NET use `MapFallbackToFile("index.html")`).

## Layers
- `api/types.ts`      contracts for every /api/v1 payload
- `api/client.ts`     fetch wrapper, ApiError, query-string helper
- `api/endpoints.ts`  one function per endpoint (clusterApi, definitionsApi, instancesApi, rbacApi)
- `api/hooks.ts`      React Query hooks + mutations (toasts live here)
- `lib/`              pure helpers: status → tone (`status.ts`), k8s accessors (`k8s.ts`), yaml, templates
- `components/`       reusable UI (DataTable, Modal, Tabs, StatusBadge, CodePanel, ManifestEditorDialog…)
- `features/*`        one folder per page; instance graph is in `features/instances/graph`
- `styles/`           tokens.css (theme) → base → layout → components → features/*

## Where to change things
- Status colours / how a state like "Inactive" is shown: `lib/status.ts`
- Instance + composed-resource health rules: `lib/k8s.ts` (`instanceStatus`, `resourceStatus`)
- Graph layout/topology: `features/instances/graph/{model,layout}.ts`

## Backend note
`GET /api/v1/rgds/{name}/instances/{instance}?namespace=` is recommended for deep links.
Until it exists the UI falls back to scanning the first 5 list pages.
