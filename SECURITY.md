# Security policy

KRO Studio interacts with Kubernetes using the configured cluster identity. A mistake in deployment permissions can therefore affect cluster resources.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** flow in the repository's Security tab when it is available. If private reporting is not enabled, contact the maintainers privately through the contact method listed on the repository profile. Do not include credentials, kubeconfig files, tokens, or sensitive cluster data in a public issue.

Please include the affected version or commit, impact, reproduction steps, and any suggested mitigation. The maintainers will coordinate disclosure and a fix.

## Deployment guidance

- Keep login-free mode on a loopback-only local Development listener.
- Use OIDC, TLS, an explicit host allow-list, and least-privilege Kubernetes permissions for shared deployments.
- The Helm chart's ServiceAccount is intentionally unbound; operators must grant only required permissions.
- Review the [authentication and RBAC guide](docs/authentication-and-rbac.md) before enabling cluster mutations.
