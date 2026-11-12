# Contributing to KRO Studio

Thanks for considering a contribution. KRO Studio is an early-stage project, so focused fixes, documentation improvements, and feedback from real KRO workflows are especially useful.

## Before you start

- Check the [roadmap](docs/roadmap.md) and existing issues to see whether the work is already tracked.
- For a significant change, open an issue or discussion first so the expected behavior and scope are clear.
- For security vulnerabilities, follow [SECURITY.md](SECURITY.md); do not open a public issue with exploit details.

## Set up locally

Install the .NET 10 SDK, Node.js 24, and npm. From the repository root, start the Hub:

```sh
dotnet run --project src/Hub --launch-profile http
```

In a second terminal:

```sh
cd src/Web
npm ci
npm run dev
```

Open the Vite URL printed in the terminal. To exercise Kubernetes-backed workflows, configure `KUBECONFIG` to a disposable cluster. The Development profile permits login-free use only on loopback; do not expose it to a network. The [kind demo](scripts/demo-kind.sh) creates a disposable cluster with KRO and a sample RGD.

## Make a change

- Keep changes focused and explain user-visible behavior in the pull request.
- Follow existing patterns in the relevant frontend feature or backend capability folder.
- Do not add credentials, kubeconfig files, tokens, or real cluster data.
- Preserve server-side authorization and validation. UI visibility is not an authorization boundary.
- Do not include Secret payloads in API responses, logs, screenshots, fixtures, or documentation.
- Update user and deployment documentation when behavior or configuration changes.

## Pull requests

Include the problem and approach, relevant screenshots for UI changes, security/RBAC impact, and how you verified the change. Keep the diff reviewable and link related issues. CI runs the .NET build, chart validation, container build, and kind smoke install.

By submitting a contribution, you agree that it may be distributed under the repository's [Apache-2.0 license](LICENSE).
