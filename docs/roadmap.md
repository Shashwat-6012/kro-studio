# Roadmap

This roadmap reflects the repository's current implementation and open work as of November 11, 2026. It is a prioritization guide, not a release schedule. Issues and user feedback may change the order.

## Now: make the core workflow dependable

- [ ] Validate the five-minute kind walkthrough from a clean checkout and keep the sample compatible with the supported KRO version.
- [ ] Add focused backend and end-to-end coverage for critical RGD and instance operations.
- [ ] Make failed instance reconciliation and related events easier to understand after creation.
- [ ] Improve safe, actionable permission-denied messages across UI screens.
- [ ] Complete the security verification listed in [pending work](to-do.md).

## Next: safer operations and onboarding

- [ ] Decide on dry-run diffs for RGD and instance writes before adding implementation complexity.
- [ ] Evaluate impact visibility and typed confirmation for RGD deletion.
- [ ] Improve first-run guidance, empty states, and accessibility using feedback from new users.
- [ ] Document tested KRO and Kubernetes versions for each release.

## Later: release confidence and integrations

- [ ] Publish signed release artifacts, an SBOM, and verifiable image/chart digests.
- [ ] Add integrations only when KRO users identify a clear need and maintainers can support them.
- [ ] Reassess multi-cluster support after the single-cluster workflow is reliable.

## Already available

- RGD catalog, details, create/update/delete, and Kubernetes API server dry-run validation.
- Generated API discovery and instance list/read/create/update/delete.
- Instance status and events, plus inspection of associated composed resources in a graph view.
- RGD reconciliation retry and KRO controller Deployment restart.
- OIDC authentication for shared deployments, optional Kubernetes impersonation, and local kubeconfig development.
- Helm packaging, hardened pod defaults, CI validation, and kind-based chart smoke installation.

Composed-resource inspection is limited to types declared in the RGD and resources associated through KRO ownership metadata. Secret objects are skipped. Results can be partial when Kubernetes permissions or API discovery are incomplete.
