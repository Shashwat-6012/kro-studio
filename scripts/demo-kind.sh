#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${KIND_CLUSTER_NAME:-kro-studio-demo}"
KRO_VERSION="${KRO_VERSION:-0.9.4}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for command in docker kind kubectl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

if ! kind get clusters | grep -Fxq "$CLUSTER_NAME"; then
  kind create cluster --name "$CLUSTER_NAME" --wait 120s
fi

kubectl config use-context "kind-$CLUSTER_NAME"
kubectl apply -f "https://github.com/kubernetes-sigs/kro/releases/download/v${KRO_VERSION}/kro-core-install-manifests.yaml"
kubectl rollout status deployment/kro -n kro-system --timeout=180s
kubectl wait --for=condition=Established crd/resourcegraphdefinitions.kro.run --timeout=120s

kubectl apply -f "$ROOT_DIR/docs/examples/demo-app-rgd.yaml"
for attempt in $(seq 1 60); do
  state="$(kubectl get rgd demo-app -o jsonpath='{.status.state}' 2>/dev/null || true)"
  if [[ "$state" == "Active" ]]; then
    break
  fi
  sleep 2
done
if [[ "${state:-}" != "Active" ]]; then
  echo "The demo-app RGD did not become Active. Inspect it with: kubectl describe rgd demo-app" >&2
  exit 1
fi

kubectl apply -f "$ROOT_DIR/docs/examples/demo-app-instance.yaml"
echo
echo "Demo cluster is ready (context: kind-$CLUSTER_NAME)."
echo "Start the Hub with: dotnet run --project src/Hub --launch-profile http"
echo "Start the UI with:  cd src/Web && npm ci && npm run dev"
echo "Open the Vite URL, then inspect demo-app / sample-demo in Resource graphs and Instances."
