param(
    [string]$ClusterName = 'kro-studio-demo',
    [string]$KroVersion = '0.9.4'
)

$ErrorActionPreference = 'Stop'
foreach ($command in @('docker', 'kind', 'kubectl')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $command"
    }
}

$clusters = kind get clusters
if ($LASTEXITCODE -ne 0) { throw 'Could not list kind clusters. Is Docker running?' }
if ($clusters -notcontains $ClusterName) {
    kind create cluster --name $ClusterName --wait 120s
    if ($LASTEXITCODE -ne 0) { throw 'kind could not create the demo cluster.' }
}

kubectl config use-context "kind-$ClusterName"
if ($LASTEXITCODE -ne 0) { throw 'Could not select the kind context.' }

$manifestUrl = "https://github.com/kubernetes-sigs/kro/releases/download/v$KroVersion/kro-core-install-manifests.yaml"
kubectl apply -f $manifestUrl
if ($LASTEXITCODE -ne 0) { throw 'Could not install the official KRO release manifest.' }
kubectl rollout status deployment/kro -n kro-system --timeout=180s
if ($LASTEXITCODE -ne 0) { throw 'The KRO controller did not become ready.' }
kubectl wait --for=condition=Established crd/resourcegraphdefinitions.kro.run --timeout=120s
if ($LASTEXITCODE -ne 0) { throw 'The KRO ResourceGraphDefinition API did not become established.' }

$root = Split-Path -Parent $PSScriptRoot
kubectl apply -f (Join-Path $root 'docs/examples/demo-app-rgd.yaml')
if ($LASTEXITCODE -ne 0) { throw 'Could not apply the sample RGD.' }

$state = ''
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $state = kubectl get rgd demo-app -o 'jsonpath={.status.state}' 2>$null
    if ($LASTEXITCODE -eq 0 -and $state -eq 'Active') { break }
    Start-Sleep -Seconds 2
}
if ($state -ne 'Active') { throw 'The demo-app RGD did not become Active. Inspect it with: kubectl describe rgd demo-app' }

kubectl apply -f (Join-Path $root 'docs/examples/demo-app-instance.yaml')
if ($LASTEXITCODE -ne 0) { throw 'Could not apply the sample instance.' }

Write-Host "`nDemo cluster is ready (context: kind-$ClusterName)."
Write-Host 'Start the Hub with: dotnet run --project src/Hub --launch-profile http'
Write-Host 'Start the UI with:  cd src/Web; npm ci; npm run dev'
Write-Host 'Open the Vite URL, then inspect demo-app / sample-demo in Resource graphs and Instances.'
