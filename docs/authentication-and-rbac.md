# KRO Studio Authentication and RBAC Design

**Status:** MVP design, aligned with the proposed local-first architecture  
**Audience:** Contributors, cluster administrators, and users deploying KRO Studio  
**Related documents:** [Architecture and design](architecture-and-design.md), [project blueprint](kro-studio-project-documentation.md)

This document specifies how a person accesses KRO Studio, how the backend authenticates to the Kubernetes API server, and what Kubernetes permissions the supported workflows require. These are separate trust boundaries: logging in to the web application does not itself grant Kubernetes permissions.

## 1. Decisions and boundaries

The MVP is a single-user, local-first application instance. Its backend reads a kubeconfig provided at runtime and uses the identity selected by that kubeconfig. The browser talks only to the same-origin KRO Studio API; it never receives Kubernetes tokens, client keys, certificates, or kubeconfig contents. Kubernetes authenticates the backend's requests and authorizes each request using the effective Kubernetes identity's RBAC grants.

| Concern | MVP design | Later/shared deployment |
| --- | --- | --- |
| Person to KRO Studio | Local operator on a loopback-bound instance; no separate account system is defined for MVP | Require an explicitly configured user authentication layer, such as an authenticated reverse proxy or platform identity provider |
| KRO Studio backend to Kubernetes | Runtime-provided kubeconfig; use its current context and credentials | A separately designed in-cluster mode may use a dedicated service account |
| Kubernetes authorization | Kubernetes RBAC is authoritative; no permission is inferred from hidden UI controls | Still authoritative; application identity-to-cluster identity mapping must be designed before team access |
| Credential delivery | Runtime file/configuration to backend only; never image, repository, or browser bundle | Secret and identity lifecycle must be owned by the deployment platform |

The MVP does not promise per-user Kubernetes impersonation or a multi-user session model. If multiple people can reach one backend, they all exercise the backend's configured Kubernetes identity unless a future design explicitly maps authenticated users to distinct Kubernetes credentials. Do not expose the MVP backend as a shared service on the assumption that local loopback behavior is an authentication system.

## 2. Two authentication hops

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant Studio as KRO Studio API
    participant Kube as Kubernetes API server
    User->>Browser: Open local KRO Studio
    Browser->>Studio: Same-origin application request
    Studio->>Kube: API request with kubeconfig-derived credentials
    Kube->>Kube: Authenticate identity, then authorize verb/resource/scope
    Kube-->>Studio: Resource or Forbidden/Unauthenticated response
    Studio-->>Browser: Safe result or actionable permission error
```

The first hop is **user-to-application authentication**. It determines who may use the web application and protects browser sessions. The second is **backend-to-Kubernetes authentication and authorization**. It determines the Kubernetes principal used for API calls and whether that principal may perform a particular operation. A successful app login is not a Kubernetes grant; a valid kubeconfig is not proof that a web user should be allowed into a shared app.

## 3. User stories

### 3.1 Connect using the configured Kubernetes identity (MVP)

**As a local KRO Studio operator,** I want the backend to connect to the Kubernetes API server using the runtime kubeconfig's selected context, so that KRO Studio can show and manage only the resources my Kubernetes identity is allowed to access.

**Acceptance criteria**

- The deployment instructions explain how to supply a kubeconfig at runtime and how the current context is selected/configured.
- The backend constructs Kubernetes clients from the configured kubeconfig; the browser receives neither the file nor derived credentials.
- A connection/capabilities view distinguishes unreachable API server, failed authentication, missing KRO APIs, and insufficient authorization.
- Requests use the configured identity consistently. A `Forbidden` response is returned as a permission failure; the backend never retries with a broader identity or silently changes context.
- Kubeconfig parsing, TLS verification, credential refresh, and supported credential-provider behavior are delegated to the selected Kubernetes client library where supported. The supported kubeconfig features and runtime dependencies are documented and tested for the release.
- Exec credential plugins, when used, run in the backend's runtime environment. Interactive plugins that require a workstation prompt cannot be assumed to work in a headless container; failures explain that the configured credential mechanism needs attention.
- Logs and API errors never include bearer tokens, private keys, client certificates, or kubeconfig contents.

### 3.2 Read and operate on KRO resources within granted permissions

**As a Kubernetes administrator,** I want KRO Studio to use a least-privilege identity and report exactly which operation was denied, so that I can grant only the Kubernetes permissions needed for the intended workflow.

**Acceptance criteria**

- Read-only discovery can be used without granting write permissions.
- RGD authoring permissions are separate from instance permissions and are explicitly cluster-scoped because RGDs are cluster-scoped.
- Instance permissions are bound at the scope of the generated resource: namespace-scoped for namespaced instances, cluster-scoped for cluster-scoped instances.
- A denied list/read/write or composed-resource lookup is shown as denied or incomplete data, never as an empty result or a healthy state.
- The error identifies the attempted action and resource type/scope where Kubernetes provides that information, without exposing credentials.
- The UI may disable an operation when known to be unavailable, but every operation is still authorized by the API server. UI visibility is not a security boundary.

### 3.3 Authenticate a user in a future shared deployment

**As a team member,** I want to sign in through the organization's approved identity provider before using a shared KRO Studio deployment, so that an unauthenticated visitor cannot use the app's Kubernetes identity.

**Acceptance criteria for that future capability**

- The shared deployment has an explicit, supported user authentication configuration and denies anonymous access by default.
- The application validates the authenticated identity on every protected request and applies an explicit policy to it.
- The design states whether all users share a service account or whether users map to distinct Kubernetes identities. No implicit identity forwarding or impersonation is allowed.
- Session protection, logout, CSRF protections where cookie sessions are used, TLS termination, trusted proxy headers, and authorization failure behavior are documented.
- If all users share one Kubernetes service account, the UI clearly describes that cluster operations execute with that shared identity; app-level roles do not replace Kubernetes RBAC.

## 4. Kubernetes API server authentication design

### 4.1 MVP connection flow

1. The operator supplies a kubeconfig to the backend runtime (for example, a mounted read-only file or configured path). It is not committed or copied into the image.
2. The backend loads the configured context and creates a Kubernetes client. Cluster endpoint and TLS trust settings come from that configuration.
3. The Kubernetes client presents the configured credential mechanism to the API server. Depending on the kubeconfig and client support, this may use a token, client certificate, or exec credential plugin.
4. Kubernetes authenticates the principal, then its configured authorizer (RBAC in the expected deployment) decides each request based on verb, API group/resource, subresource, namespace, and name.
5. KRO Studio maps the response into a stable application result. `401`/authentication failures, `403`/authorization failures, connectivity errors, and KRO capability gaps remain distinct.

KRO Studio does not implement Kubernetes authentication, mint tokens, store a second cluster credential, or use Kubernetes impersonation in the MVP. Credential refresh is performed by the Kubernetes client/configured provider. A kubeconfig can reference executable credential plugins; since those commands run with the backend process's privileges, deployments must mount only trusted configuration and provide required executables intentionally.

### 4.2 Credential handling requirements

- Keep kubeconfig files and referenced credentials outside source control, image layers, static web assets, and ordinary app settings.
- Mount credentials read-only when the deployment platform permits it; restrict file access to the backend process identity.
- Do not provide a web form that uploads arbitrary kubeconfig files as part of the MVP.
- Avoid returning raw Kubernetes client exceptions or configuration values to the browser.
- Do not log request authorization headers, exec-plugin output, token response bodies, or credential-bearing environment variables.
- Do not disable API-server certificate validation to make a connection work.
- Document that rotating or expiring credentials may require provider refresh or operator action; display connection/authentication state instead of retrying indefinitely.

## 5. Kubernetes RBAC requirements

Kubernetes permissions are additive. Administrators can grant the requirements below through their own Role/RoleBinding and ClusterRole/ClusterRoleBinding policy. KRO Studio does not create, edit, or bind roles for the user. Exact API resource names and scope must be confirmed from discovery and the supported KRO release; the table describes application behavior, not a universal ready-to-apply manifest.

### 5.1 Permission matrix

| Feature / operation | Resource scope | Minimum verbs expected | Notes |
| --- | --- | --- | --- |
| API discovery and capability checks | Non-resource discovery endpoints and API resources | `get` for discovery; resource-specific `get`/`list` as needed | Discovery is needed to resolve API groups, versions, names, and scope. Do not assume every cluster applies identical discovery access policy. |
| Browse and inspect RGDs | Cluster-scoped RGD resource (`kro.run`, currently `resourcegraphdefinitions`) | `get`, `list` | `watch` only if the implementation uses watches; otherwise polling does not need it. |
| Create or update an RGD | Cluster-scoped RGD | `create`, `update` and/or `patch` according to the HTTP operation used | Dry-run uses the same authorization as the corresponding create/update request; dry-run is not a separate RBAC verb. |
| Delete an RGD | Cluster-scoped RGD | `delete` | High-impact operation; keep separate from read-only access and require UI confirmation. |
| Read RGD status/subresources, if addressed separately | Cluster-scoped RGD subresource(s) | `get`; possibly `watch` | Grant only if the client calls the subresource endpoint. Reading the object's status as part of `get` does not by itself require a separate status rule. |
| Inspect generated CRD/API metadata | Cluster-scoped `customresourcedefinitions.apiextensions.k8s.io` | `get`, and `list` only if discovery searches by listing | KRO creates/manages CRDs. KRO Studio only reads them; it does not need CRD create/update/delete. |
| List/read generated instances | Generated custom resource, namespaced or cluster-scoped per its CRD | `get`, `list` | Bind to selected namespaces for namespaced instance APIs; cluster-wide listing requires cluster-wide permission. |
| Create/update/delete generated instances | Generated custom resource, same scope as above | `create`, `update` and/or `patch`, `delete` | Grant each mutation only when that workflow is enabled. A namespaced instance grant does not grant RGD access. |
| Read events for an object | Usually namespaced core `events` (and, if supported, `events` API group) | `get`, `list`; `watch` only for watches | Event access may be needed in each namespace shown. Events are supplemental diagnostics; denial must not hide the primary object's state. |
| Inspect composed resources | Each composed resource GVR and applicable namespace | `get`, `list` for supported resource types | There is no single safe generic permission for arbitrary composed resources. Resource type and namespace coverage must be explicitly configured. Never grant Secret reads just to support this view. |

The `resourcegraphdefinitions.kro.run` name and `kro.run/v1alpha1` API are the current KRO API documented by KRO. Pin and verify these identifiers against the supported KRO release. KRO's own controller permissions are separate: permissions required by the controller to reconcile an RGD must not be copied wholesale to the KRO Studio identity.

### 5.2 Suggested grant profiles

**Read-only discovery profile**

- Read/list RGDs and their required status information.
- Read the CRD metadata needed to resolve generated APIs.
- Read/list only the generated instance APIs and namespaces intended for this user.
- Read relevant events and explicitly supported composed-resource types if those screens are enabled.
- No create, update, patch, or delete permissions.

**RGD author profile**

- Read-only discovery permissions above.
- `create`, `update`/`patch` on the cluster-scoped RGD resource; add `delete` only if RGD deletion is enabled for that user.
- No permission to create or modify CRDs merely because KRO creates a CRD from the RGD.

**Instance operator profile**

- Read-only discovery permissions above.
- Required mutation verbs on approved generated custom resource types and scopes.
- No RGD mutation unless separately granted.

These profiles are conceptual grants, not predefined Kubernetes roles shipped by the MVP. A cluster administrator should tailor namespace coverage, generated API resource lists, composed-resource types, and delete access to the deployment. KRO RGDs can define resources with broad effects; permission to create or change an RGD is therefore a high-trust capability. In KRO's current access-control guidance, the project warns that RGD creation can amount to broad cluster access depending on controller permissions and configuration. Review the cluster's KRO access-control mode and restrict RGD authors accordingly.

### 5.3 Role scope and bindings

- Use a `ClusterRole` for cluster-scoped RGD operations and CRD metadata reads.
- A `ClusterRole` containing namespaced instance permissions can be bound with a `RoleBinding` in each approved namespace to limit those rules to that namespace.
- Use a `ClusterRoleBinding` only when cluster-wide access is intended, such as access to cluster-scoped generated instances or deliberate all-namespace viewing.
- Do not bind a read/write ClusterRole cluster-wide solely for convenience when namespace-specific RoleBindings meet the requirement.
- Never include `secrets` in broad read permissions. Composed-resource discovery must skip Secrets by default and return a redacted reference only when it can be obtained safely from the parent object or supported metadata.
- Avoid wildcards (`*`) for API groups, resources, and verbs. Add permissions as supported resource types and operations become known.

## 6. User-facing connection and authorization behavior

KRO Studio should classify failures as follows:

| Condition | User-facing result | Expected next step |
| --- | --- | --- |
| API server unreachable / TLS failure | Cluster unavailable, with safe connection detail | Check endpoint, network, CA trust, and server status |
| Credential missing, expired, or rejected | Kubernetes authentication failed | Refresh/configure the kubeconfig credential provider |
| Kubernetes returns `Forbidden` | Permission denied for the requested operation | Ask a cluster administrator for the specific resource/scope/verb |
| KRO API absent | Connected, but KRO is not detected | Install or enable a supported KRO version |
| Generated API not established yet | RGD is processing; instance API pending | Wait for KRO conditions and discovery |
| Some child/event reads are forbidden | Partial inspection; inaccessible data identified | Grant optional read permissions only if that view is required |

The backend must not translate `Forbidden` into an empty list, silently fall back to a different credential, or mark incomplete observations as healthy. A read failure on optional events or a child resource should not erase a successfully retrieved RGD or instance.

## 7. Implementation sequence / story breakdown

The initial vertical slice for Kubernetes server authentication should follow this order:

1. Add runtime configuration for kubeconfig path/context, with safe defaults for local use and clear startup diagnostics.
2. Add a single Kubernetes client factory used by connection checks and feature services; avoid creating clients from request-supplied credentials.
3. Implement a connection check and API discovery check; report authentication, connectivity, and authorization outcomes separately.
4. Add typed handling for Kubernetes `Unauthorized` and `Forbidden` responses, including operation/resource metadata where safe.
5. Verify read-only RGD discovery, then add RGD dry-run/write and dynamic instance operations using the same client identity.
6. Document and exercise minimum RBAC profiles against a disposable cluster, including read-only, missing permission, namespace-bound, and cluster-scoped cases.
7. Before any shared deployment mode, implement and document user authentication, deployment identity mapping, session protections, and an explicit policy for shared service-account access.

## 8. Out of scope for the MVP

- A username/password database or local account administration UI.
- Browser-held Kubernetes credentials, direct browser-to-cluster API calls, or kubeconfig upload.
- Kubernetes impersonation, token exchange, or per-user credential brokering.
- A shared in-cluster service account deployment advertised as secure for multiple users.
- Automatic installation or mutation of RBAC grants by KRO Studio.
- Broad arbitrary resource management beyond the documented KRO workflows.

## 9. References

- [Kubernetes authentication](https://kubernetes.io/docs/reference/access-authn-authz/authentication/)
- [Kubernetes RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)
- [Kubernetes API concepts and subresources](https://kubernetes.io/docs/reference/using-api/api-concepts/)
- [KRO ResourceGraphDefinition API](https://kro.run/api/crds/resourcegraphdefinition/)
- [KRO access control](https://kro.run/docs/advanced/access-control/)

