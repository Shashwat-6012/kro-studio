# Docker Compose deployment

The Docker image serves the compiled UI and Hub from one process. This Compose setup is for a trusted host behind a TLS-terminating reverse proxy; it is **not** a login-free local mode. Shared deployments should generally use the [Helm chart](../k8s/README.md), which supports Kubernetes Secrets for the OIDC client secret and provides the hardened pod defaults.

The Hub requires OIDC outside local loopback Development mode. The Compose file therefore requires an OIDC authority, client ID and secret, an allowed browser-facing hostname, and the IP address of the trusted proxy that forwards host and protocol headers. Configure the OIDC callback as `https://<ALLOWED_HOST>/signin-oidc`.

Set these variables in your shell or an ignored `.env` file (never commit that file):

```text
KUBECONFIG_PATH=/absolute/path/to/kubeconfig
KUBECONTEXT=your-context
UI_PORT=8080
ALLOWED_HOST=studio.example.com
TRUSTED_PROXY_IP=172.18.0.1
OIDC_AUTHORITY=https://login.example.com/realms/kro
OIDC_CLIENT_ID=kro-studio
OIDC_CLIENT_SECRET=replace-with-secret
```

Start the container with:

```sh
docker compose -f deploy/docker/docker-compose.yml up --build
```

The service publishes its port only on host loopback by default. Configure the proxy to reach that port and terminate TLS. The Hub uses the supplied kubeconfig identity for Kubernetes calls. For production, prefer a platform-managed secret and the Helm chart rather than putting the OIDC secret in a Compose environment file.
