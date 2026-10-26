import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowLeft, ArrowRight, Box, ChevronDown, CircleHelp, Clipboard, Database, ExternalLink, FileCode2, GitBranch, LayoutDashboard, Layers3, Plus, RefreshCw, Search, ShieldCheck, X, Trash2, Pencil, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

type Definition = { name: string; kind: string; apiVersion: string; generatedKind: string | null; readiness: string; createdAt: string | null };
type Connection = { connected: boolean; context: string | null; kubernetesVersion: string | null; message: string };
type Capability = { clusterApiAvailable: boolean; kroApiAvailable: boolean; message: string };
type KroInstallation = { version: string; documentationUrl: string };
type InstallationResult = { alreadyInstalled: boolean; version: string; resourcesApplied: number; message: string };
type Manifest = Record<string, any>;
type GeneratedApi = { id: string; group: string; version: string; plural: string; kind: string; namespaced: boolean; schema: Manifest | null; definitionName?: string };
type InstancePage = { items: Manifest[]; continue: string | null };
type InstanceTab = 'Overview' | 'Resources' | 'Events' | 'YAML';

const starterYaml = `apiVersion: kro.run/v1alpha1
kind: ResourceGraphDefinition
metadata:
  name: web-application
spec:
  schema:
    apiVersion: v1alpha1
    kind: WebApplication
    spec:
      name: string
      image: string
      replicas: integer | default=2
  resources:
    - id: deployment
      template:
        apiVersion: apps/v1
        kind: Deployment
        metadata:
          name: ${'${schema.spec.name}'}
        spec:
          replicas: ${'${schema.spec.replicas}'}
          selector:
            matchLabels:
              app: ${'${schema.spec.name}'}
          template:
            metadata:
              labels:
                app: ${'${schema.spec.name}'}
            spec:
              containers:
                - name: app
                  image: ${'${schema.spec.image}'}
`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try { const body = await response.json(); detail = body.detail ?? body.title ?? body.message ?? detail; } catch { /* response has no JSON body */ }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
const enc = (value: string) => encodeURIComponent(value);
const nsQuery = (namespace: string) => namespace ? `?namespace=${enc(namespace)}` : '';
const namespaceQueryFor = (definitionName: string, namespace: string, apis: GeneratedApi[], definitions: Definition[]) => {
  const kind = definitions.find((item) => item.name === definitionName)?.generatedKind;
  const api = apis.find((entry) => entry.definitionName === definitionName) ?? apis.find((entry) => entry.kind === kind);
  return api?.namespaced ? nsQuery(namespace) : '';
};
const objectName = (value: Manifest) => value?.metadata?.name ?? 'Unnamed';
const objectNamespace = (value: Manifest) => value?.metadata?.namespace ?? '—';
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export default function App() {
  const [activeNav, setActiveNav] = useState('Resource graphs');
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [apis, setApis] = useState<GeneratedApi[]>([]);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [capabilities, setCapabilities] = useState<Capability | null>(null);
  const [kroInstallation, setKroInstallation] = useState<KroInstallation | null>(null);
  const [selected, setSelected] = useState<Definition | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<Manifest | null>(null);
  const [selectedApi, setSelectedApi] = useState<GeneratedApi | null>(null);
  const [instances, setInstances] = useState<Manifest[]>([]);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [pageTokens, setPageTokens] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [namespace, setNamespace] = useState('default');
  const [instanceData, setInstanceData] = useState<{ resources: Manifest[]; events: Manifest[]; warnings: string[] }>({ resources: [], events: [], warnings: [] });
  const [resourceLogs, setResourceLogs] = useState<{ podName: string; container: string; text: string }[]>([]);
  const [logsResource, setLogsResource] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [filterOpen, setFilterOpen] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editorMode, setEditorMode] = useState<'create-rgd' | 'edit-rgd' | 'create-instance' | 'edit-instance'>('create-rgd');
  const [yaml, setYaml] = useState(starterYaml);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [installingKro, setInstallingKro] = useState(false);
  const [showKroInstallDialog, setShowKroInstallDialog] = useState(false);
  const [restartingKro, setRestartingKro] = useState(false);
  const [showKroRestartDialog, setShowKroRestartDialog] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState('Overview');
  const [instanceTab, setInstanceTab] = useState<InstanceTab>('Overview');
  const [instanceSearch, setInstanceSearch] = useState('');
  const [apiSearch, setApiSearch] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [cluster, feature, installInfo] = await Promise.all([request<Connection>('/api/v1/connection'), request<Capability>('/api/v1/capabilities'), request<KroInstallation>('/api/v1/kro-installation')]);
      setConnection(cluster); setCapabilities(feature); setKroInstallation(installInfo);
      if (cluster.connected && feature.kroApiAvailable) {
        const list = await request<Definition[]>('/api/v1/rgds'); setDefinitions(list);
        const resolved = await Promise.allSettled(list.map((item) => request<GeneratedApi>(`/api/v1/rgds/${enc(item.name)}/api`)));
        setApis(resolved.flatMap((result, index) => result.status === 'fulfilled' ? [{ ...result.value, definitionName: list[index].name }] : []));
      } else { setDefinitions([]); setApis([]); }
    } catch (e) {
      setConnection({ connected: false, context: null, kubernetesVersion: null, message: 'The local API is not available. Start the API to connect to your cluster.' });
      setCapabilities(null); setKroInstallation(null); setDefinitions([]); setApis([]); setError(messageOf(e));
    } finally { setLoading(false); }
  }, []);
  async function installKro() {
    setInstallingKro(true); setError('');
    try {
      const result = await request<InstallationResult>('/api/v1/kro-installation', { method: 'POST' });
      setShowKroInstallDialog(false); setNotice(result.message); await refresh();
    } catch (e) { setError(messageOf(e)); }
    finally { setInstallingKro(false); }
  }
  async function restartKro() {
    setRestartingKro(true); setError('');
    try {
      const result = await request<{ message: string }>('/api/v1/kro-controller/restart', { method: 'POST' });
      setShowKroRestartDialog(false); setNotice(result.message);
    } catch (e) { setError(messageOf(e)); }
    finally { setRestartingKro(false); }
  }
  async function retryRgd() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const result = await request<{ message: string }>(`/api/v1/rgds/${enc(selected.name)}/retry`, { method: 'POST' });
      setNotice(result.message);
      await refresh();
      const [latestDefinitions, latestManifest] = await Promise.all([
        request<Definition[]>('/api/v1/rgds'),
        request<Manifest>(`/api/v1/rgds/${enc(selected.name)}`),
      ]);
      setDefinitions(latestDefinitions); setSelected(latestDefinitions.find((item) => item.name === selected.name) ?? selected); setManifest(latestManifest);
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timer); }, [notice]);
  useEffect(() => { if (!error) return; const timer = window.setTimeout(() => setError(''), 7000); return () => window.clearTimeout(timer); }, [error]);

  const loadInstances = useCallback(async (definitionName: string, pageToken: string | null = null) => {
    setBusy(true);
    try {
      const namespaceQuery = namespaceQueryFor(definitionName, namespace, apis, definitions);
      const path = `/api/v1/rgds/${enc(definitionName)}/instances${namespaceQuery}${pageToken ? `${namespaceQuery ? '&' : '?'}continue=${enc(pageToken)}` : ''}`;
      const result = await request<InstancePage>(path); setInstances(result.items ?? []); setContinueToken(result.continue ?? null);
    } catch (e) { setInstances([]); setContinueToken(null); setError(messageOf(e)); }
    finally { setBusy(false); }
  }, [namespace, apis, definitions]);
  useEffect(() => { if (activeNav === 'Instances' && selected && !selectedInstance) { setPageIndex(0); setPageTokens([null]); void loadInstances(selected.name); } }, [activeNav, selected, selectedInstance, loadInstances]);

  const filteredApis = useMemo(() => apis.filter((api) => `${api.kind} ${api.group} ${api.plural}`.toLowerCase().includes(apiSearch.toLowerCase())), [apis, apiSearch]);
  const filteredInstances = useMemo(() => instances.filter((item) => `${objectName(item)} ${objectNamespace(item)}`.toLowerCase().includes(instanceSearch.toLowerCase())), [instances, instanceSearch]);

  async function openDefinition(definition: Definition) {
    setSelected(definition); setSelectedInstance(null); setSelectedApi(null); setActiveNav('Resource graphs'); setTab('Overview');
    setManifest(null); setError('');
    try { setManifest(await request<Manifest>(`/api/v1/rgds/${enc(definition.name)}`)); }
    catch (e) { setError(messageOf(e)); }
  }
  function navigate(nav: string) {
    setActiveNav(nav); setSelected(null); setManifest(null); setSelectedInstance(null); setSelectedApi(null); setError('');
    if (nav === 'Instances' && definitions.length) setSelected(definitions[0]);
  }
  function startRgd(mode: 'create-rgd' | 'edit-rgd') {
    setEditorMode(mode); setYaml(mode === 'edit-rgd' && manifest ? pretty(manifest) : starterYaml); setShowEditor(true);
  }
  function startInstance(mode: 'create-instance' | 'edit-instance', item?: Manifest) {
    if (!selected || !selected.generatedKind) { setError('This definition does not expose a generated API yet.'); return; }
    const api = apis.find((entry) => entry.definitionName === selected.name) ?? apis.find((entry) => entry.kind === selected.generatedKind);
    if (!api) { setError('The generated API is not currently discoverable.'); return; }
    setSelectedApi(api); setEditorMode(mode);
    const body = item ? structuredClone(item) : { apiVersion: `${api.group}/${api.version}`, kind: api.kind, metadata: { name: '', ...(api.namespaced ? { namespace } : {}) }, spec: {} };
    setYaml(pretty(body)); setShowEditor(true);
  }
  async function saveEditor() {
    setBusy(true);
    try {
      const instanceQuery = selected ? namespaceQueryFor(selected.name, namespace, apis, definitions) : '';
      const route = editorMode === 'create-rgd' ? '/api/v1/rgds' : editorMode === 'edit-rgd' ? `/api/v1/rgds/${enc(selected!.name)}` : editorMode === 'create-instance' ? `/api/v1/rgds/${enc(selected!.name)}/instances${instanceQuery}` : `/api/v1/rgds/${enc(selected!.name)}/instances/${enc(objectName(selectedInstance!))}${instanceQuery}`;
      const method = editorMode.startsWith('create') ? 'POST' : 'PUT';
      const body = { yaml };
      const result = await request<Manifest>(route, { method, body: JSON.stringify(body) });
      setShowEditor(false);
      if (editorMode.endsWith('rgd')) {
        setNotice(editorMode === 'create-rgd' ? 'Resource graph created.' : 'Resource graph updated.'); await refresh();
        const name = result?.metadata?.name ?? selected?.name;
        if (name) { const item = { name, kind: 'ResourceGraphDefinition', apiVersion: result.apiVersion ?? 'kro.run/v1alpha1', generatedKind: result.spec?.schema?.kind ?? null, readiness: 'Processing', createdAt: result.metadata?.creationTimestamp ?? null }; await openDefinition(item); }
      } else { setNotice(editorMode === 'create-instance' ? 'Instance created.' : 'Instance updated.'); if (selected) await loadInstances(selected.name, pageTokens[pageIndex] ?? null); }
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  async function validateRgd() {
    setBusy(true);
    try {
      const body = await request<Manifest>(`/api/v1/rgds/validate?update=${editorMode === 'edit-rgd'}`, { method: 'POST', body: JSON.stringify({ yaml }) });
      setNotice(`API validation passed${body?.metadata?.name ? ` for ${body.metadata.name}` : ''}. No changes were saved.`);
    } catch (e) { setError(`Validation failed: ${messageOf(e)}`); }
    finally { setBusy(false); }
  }
  async function removeRgd() {
    if (!selected || !window.confirm(`Delete resource graph “${selected.name}” from the cluster?`)) return;
    setBusy(true); try { await request(`/api/v1/rgds/${enc(selected.name)}`, { method: 'DELETE' }); setNotice(`Deleted ${selected.name}.`); setSelected(null); await refresh(); }
    catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  async function removeInstance(item: Manifest) {
    if (!selected || !window.confirm(`Delete instance “${objectName(item)}” from the cluster?`)) return;
    try { await request(`/api/v1/rgds/${enc(selected.name)}/instances/${enc(objectName(item))}${namespaceQueryFor(selected.name, namespace, apis, definitions)}`, { method: 'DELETE' }); setNotice(`Deleted ${objectName(item)}.`); await loadInstances(selected.name, pageTokens[pageIndex] ?? null); }
    catch (e) { setError(messageOf(e)); }
  }
  async function openInstance(item: Manifest) {
    if (!selected) return;
    setSelectedInstance(item); setInstanceTab('Overview'); setInstanceData({ resources: [], events: [], warnings: [] }); setResourceLogs([]); setLogsResource(null); setError('');
    const name = objectName(item); const query = namespaceQueryFor(selected.name, namespace, apis, definitions);
    try {
      const [resources, events] = await Promise.allSettled([
        request<{ resources: { resourceId: string; object: Manifest; parentResourceName?: string | null }[]; warnings: string[] }>(`/api/v1/rgds/${enc(selected.name)}/instances/${enc(name)}/resources${query}`),
        request<{ items: Manifest[] }>(`/api/v1/rgds/${enc(selected.name)}/instances/${enc(name)}/events${nsQuery(namespace)}`),
      ]);
      setInstanceData({ resources: resources.status === 'fulfilled' ? (resources.value.resources ?? []).map((entry) => ({ resourceId: entry.resourceId, parentResourceName: entry.parentResourceName, ...entry.object })) : [], warnings: resources.status === 'fulfilled' ? resources.value.warnings ?? [] : [messageOf(resources.reason)], events: events.status === 'fulfilled' ? events.value.items ?? [] : [] });
    } catch (e) { setError(messageOf(e)); }
  }
  async function loadResourceLogs(resource: Manifest) {
    if (!selected || !selectedInstance) return;
    const resourceName = objectName(resource);
    setLogsResource(resourceName); setResourceLogs([]); setBusy(true); setError('');
    try {
      const query = namespaceQueryFor(selected.name, namespace, apis, definitions);
      const logs = await request<{ podName: string; container: string; text: string }[]>(`/api/v1/rgds/${enc(selected.name)}/instances/${enc(objectName(selectedInstance))}/resources/${enc(resourceName)}/logs${query}`);
      setResourceLogs(logs ?? []);
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  async function selectApi(api: GeneratedApi) {
    setSelectedApi(api); setSelected(null); setSelectedInstance(null); setActiveNav('API catalog'); setError('');
    const definition = definitions.find((item) => item.name === api.definitionName) ?? definitions.find((item) => item.generatedKind === api.kind);
    if (definition) { try { setManifest(await request<Manifest>(`/api/v1/rgds/${enc(definition.name)}`)); } catch { setManifest(null); } }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Layers3 size={19}/></div><div><strong>kro<span>studio</span></strong><small>PLATFORM WORKSPACE</small></div></div>
      <div className="cluster-switch"><span className="cluster-dot"/><span className="cluster-name"><b>{connection?.context ?? 'Local cluster'}</b><small>{connection?.kubernetesVersion ?? (connection?.connected ? 'Connected' : 'No context connected')}</small></span><ChevronDown size={15}/></div>
      <div className="side-label">WORKSPACE</div><nav className="navigation">
        <NavItem icon={<LayoutDashboard size={17}/>} label="Overview" active={activeNav === 'Overview'} onClick={() => navigate('Overview')}/>
        <NavItem icon={<GitBranch size={17}/>} label="Resource graphs" active={activeNav === 'Resource graphs'} count={definitions.length} onClick={() => navigate('Resource graphs')}/>
        <NavItem icon={<Box size={17}/>} label="Instances" active={activeNav === 'Instances'} onClick={() => navigate('Instances')}/>
        <NavItem icon={<Database size={17}/>} label="API catalog" active={activeNav === 'API catalog'} onClick={() => navigate('API catalog')}/>
        <NavItem icon={<ShieldCheck size={17}/>} label="RBAC advisor" active={activeNav === 'RBAC advisor'} onClick={() => navigate('RBAC advisor')}/>
      </nav>
      <div className="side-label tools-label">TOOLS</div><nav className="navigation"><button className="nav-item" onClick={() => startRgd('create-rgd')}><FileCode2 size={17}/> YAML playground</button></nav>
      <div className="sidebar-bottom"><a className="help-card" href="https://kro.run/docs/" target="_blank" rel="noreferrer"><span className="help-icon"><CircleHelp size={17}/></span><span><b>KRO documentation</b><small>Explore guides and concepts</small></span><ExternalLink size={14}/></a><div className="user-row"><div className="avatar">KS</div><div className="user-meta"><b>Local operator</b><small>Personal workspace</small></div></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{selectedInstance ? objectName(selectedInstance) : selectedApi?.kind ?? selected?.name ?? activeNav}</b></div><div className="top-actions"><div className="connection-indicator"><span className={`status-dot ${connection?.connected ? 'green' : 'amber'}`}/>{connection?.connected ? 'Cluster connected' : 'Cluster disconnected'}</div>{connection?.connected && capabilities?.kroApiAvailable && <button className="secondary-btn" onClick={() => setShowKroRestartDialog(true)} disabled={restartingKro}>Restart controller</button>}<button className="icon-btn" aria-label="Refresh data" onClick={() => void refresh()}><RefreshCw size={16}/></button><div className="avatar top-avatar">KS</div></div></header>
      <div className="content-wrap">
        {connection?.connected && capabilities?.clusterApiAvailable && !capabilities.kroApiAvailable && <section className="kro-install-banner"><div className="kro-install-icon"><Layers3 size={17}/></div><div className="kro-install-copy"><b>KRO isn’t installed in this cluster</b><p>Install KRO {kroInstallation ? `v${kroInstallation.version}` : ''} to create and manage resource graphs.</p></div><a className="kro-doc-link" href={kroInstallation?.documentationUrl ?? 'https://kro.run/docs/getting-started/Installation/'} target="_blank" rel="noreferrer">Install details <ExternalLink size={13}/></a><button className="primary-btn" onClick={() => setShowKroInstallDialog(true)} disabled={installingKro}>Install KRO <ArrowRight size={15}/></button></section>}
        {selectedInstance && selected ? <InstanceDetail item={selectedInstance} definition={selected} data={instanceData} tab={instanceTab} setTab={setInstanceTab} back={() => setSelectedInstance(null)} edit={() => startInstance('edit-instance', selectedInstance)} remove={() => void removeInstance(selectedInstance)} namespace={namespace} logs={resourceLogs} logsResource={logsResource} loadLogs={loadResourceLogs} logsLoading={busy}/> : activeNav === 'Instances' ? <InstancesPage definitions={definitions} selected={selected} instances={filteredInstances} loading={loading || busy} namespace={namespace} setNamespace={(value) => { setNamespace(value); setPageIndex(0); setPageTokens([null]); }} search={instanceSearch} setSearch={setInstanceSearch} pageIndex={pageIndex} hasNext={Boolean(continueToken)} previous={() => { const next = Math.max(0, pageIndex - 1); setPageIndex(next); if (selected) void loadInstances(selected.name, pageTokens[next]); }} next={() => { if (!selected || !continueToken) return; const tokens = [...pageTokens.slice(0, pageIndex + 1), continueToken]; setPageTokens(tokens); setPageIndex(pageIndex + 1); void loadInstances(selected.name, continueToken); }} choose={(name) => { const item = definitions.find((entry) => entry.name === name); if (item) { setSelected(item); setSelectedInstance(null); setPageIndex(0); setPageTokens([null]); } }} create={() => startInstance('create-instance')} open={openInstance} remove={(item) => void removeInstance(item)} /> : selectedApi ? <ApiDetail api={selectedApi} definition={definitions.find((item) => item.name === selectedApi.definitionName) ?? definitions.find((item) => item.generatedKind === selectedApi.kind)} manifest={manifest} back={() => { setSelectedApi(null); setActiveNav('API catalog'); }} /> : selected ? <DefinitionDetail definition={selected} manifest={manifest} active={activeNav} tab={tab} setTab={setTab} back={() => { setSelected(null); setManifest(null); setActiveNav('Resource graphs'); }} edit={() => startRgd('edit-rgd')} createInstance={() => startInstance('create-instance')} remove={() => void removeRgd()} retry={() => void retryRgd()} busy={busy} openInstances={() => { setActiveNav('Instances'); setSelectedInstance(null); }} /> : activeNav === 'RBAC advisor' ? <RbacAdvisorPage definitions={definitions} namespace={namespace}/> : activeNav === 'API catalog' ? <ApiCatalog apis={filteredApis} search={apiSearch} setSearch={setApiSearch} loading={loading} onSelect={(api) => void selectApi(api)}/> : activeNav === 'Resource graphs' ? <ResourceGraphCatalog definitions={definitions} loading={loading} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} filterOpen={filterOpen} setFilterOpen={setFilterOpen} create={() => startRgd('create-rgd')} open={openDefinition}/> : <Dashboard definitions={definitions} apis={apis} capabilities={capabilities} loading={loading} onNavigate={navigate} onCreate={() => startRgd('create-rgd')} onOpen={openDefinition}/ >}
      </div>
      <footer className="page-footer"><span>KRO STUDIO <span className="footer-sep">·</span> v0.1.0</span><span className="footer-links"><span><span className={`status-dot ${connection?.connected ? 'green' : 'amber'}`}/>{connection?.connected ? 'Connected' : 'Waiting for cluster'}</span><a href="https://kro.run/docs/" target="_blank" rel="noreferrer">Documentation <ExternalLink size={12}/></a><span className="footer-credits">Made for platform engineers <span>✳</span></span></span></footer>
    </main>
    {showEditor && <EditorDialog mode={editorMode} yaml={yaml} setYaml={setYaml} busy={busy} close={() => setShowEditor(false)} validate={validateRgd} save={saveEditor}/>}
    {showKroInstallDialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !installingKro) setShowKroInstallDialog(false); }}><section className="kro-install-dialog" role="dialog" aria-modal="true" aria-labelledby="kro-install-title"><div className="dialog-heading"><div><span className="dialog-kicker">CLUSTER INSTALLATION</span><h2 id="kro-install-title">Install KRO {kroInstallation ? `v${kroInstallation.version}` : ''}?</h2><p>This applies the official KRO release manifest to the connected cluster.</p></div><button className="icon-btn" onClick={() => setShowKroInstallDialog(false)} aria-label="Close" disabled={installingKro}><X size={18}/></button></div><div className="kro-install-impact"><ShieldCheck size={16}/><span>Creates the KRO controller, CRDs, and cluster-wide access roles in the <b>kro-system</b> namespace. Your Kubernetes credentials need permission to create cluster-scoped resources.</span></div><div className="dialog-actions"><button className="secondary-btn" onClick={() => setShowKroInstallDialog(false)} disabled={installingKro}>Cancel</button><button className="primary-btn" onClick={() => void installKro()} disabled={installingKro}><Layers3 size={15}/>{installingKro ? 'Installing…' : 'Install KRO'}</button></div><div className="dialog-footer-note">Version {kroInstallation?.version ?? '0.9.4'} · official KRO release manifest</div></section></div>}
    {showKroRestartDialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !restartingKro) setShowKroRestartDialog(false); }}><section className="kro-install-dialog" role="dialog" aria-modal="true" aria-labelledby="kro-restart-title"><div className="dialog-heading"><div><span className="dialog-kicker">CONTROLLER ACTION</span><h2 id="kro-restart-title">Restart the KRO controller?</h2><p>This starts a rolling restart of the controller in kro-system. Reconciliation will resume when it is ready.</p></div><button className="icon-btn" onClick={() => setShowKroRestartDialog(false)} aria-label="Close" disabled={restartingKro}><X size={18}/></button></div><div className="dialog-actions"><button className="secondary-btn" onClick={() => setShowKroRestartDialog(false)} disabled={restartingKro}>Cancel</button><button className="primary-btn" onClick={() => void restartKro()} disabled={restartingKro}><RefreshCw size={15}/>{restartingKro ? 'Restarting…' : 'Restart controller'}</button></div></section></div>}
    {(notice || error) && <div className={`toast ${error ? 'toast-error' : ''}`}><span className="toast-check">{error ? '!' : '✓'}</span>{error || notice}<button onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss"><X size={15}/></button></div>}
  </div>;
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Unexpected error'; }
function NavItem({ icon, label, active, count, onClick }: { icon: React.ReactNode; label: string; active: boolean; count?: number; onClick: () => void }) { return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}{label}{count !== undefined && <span className="nav-count">{count}</span>}</button>; }
function StatCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) { return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><span className="stat-label">{label}</span><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></div>; }
function ReadinessBadge({ status }: { status: string }) { const tone = status.toLowerCase() === 'ready' ? 'ready' : status.toLowerCase() === 'failed' ? 'failed' : 'processing'; return <span className={`readiness ${tone}`}><span/>{status}</span>; }
function formatDate(value?: string | null) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date); }
function Empty({ icon, title, detail, action }: { icon: React.ReactNode; title: string; detail: string; action?: React.ReactNode }) { return <div className="empty-state"><div className="empty-icon">{icon}</div><b>{title}</b><span>{detail}</span>{action}</div>; }

type RbacFinding = { identity: string; check: string; status: 'allowed' | 'denied' | 'unknown' | 'observed failure' | 'observed issue'; verb: string; apiGroup: string; resource: string; namespace: string | null; detail: string; source: string };
type RbacReport = { studioIdentity: string; controllerIdentity: string; checkedAt: string; studio: RbacFinding[]; controller: RbacFinding[]; note: string };
type RbacRequirement = { label: string; verb: string; apiGroup: string; resource: string; namespace: string | null };
type RbacPlannedObject = { kind: string; name: string; manifest: Manifest; exists: boolean; managedByStudio: boolean; matchesPlan: boolean; inspectable: boolean; canUpdate: boolean };
type RbacPlan = { definitionName: string; controllerIdentity: string; serviceAccountVerified: boolean; planToken: string; requirements: RbacRequirement[]; clusterRole: RbacPlannedObject; clusterRoleBinding: RbacPlannedObject; impact: string };

function RbacAdvisorPage({ definitions, namespace }: { definitions: Definition[]; namespace: string }) {
  const [definitionName, setDefinitionName] = useState(definitions[0]?.name ?? '');
  const [targetNamespace, setTargetNamespace] = useState(namespace || 'default');
  const [instanceName, setInstanceName] = useState('');
  const [report, setReport] = useState<RbacReport | null>(null);
  const [plan, setPlan] = useState<RbacPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const controllerAttention = report?.controller.filter((finding) => finding.status === 'denied' || finding.status === 'unknown' || finding.status === 'observed failure' || finding.status === 'observed issue') ?? [];
  const observedFailures = report?.controller.filter((finding) => finding.status === 'observed failure' || finding.status === 'observed issue') ?? [];
  const controllerAllowed = report?.controller.filter((finding) => finding.status === 'allowed').length ?? 0;
  const generatedPatchFinding = report?.controller.find((finding) => finding.check === 'Patch generated instances');
  const refresh = useCallback(async () => {
    setLoading(true); setProblem(''); setPlan(null); setConfirmed(false);
    try {
      const query = new URLSearchParams();
      if (definitionName) query.set('definitionName', definitionName);
      if (targetNamespace) query.set('namespace', targetNamespace);
      if (instanceName.trim()) query.set('instanceName', instanceName.trim());
      setReport(await request<RbacReport>(`/api/v1/rbac-advisor?${query.toString()}`));
    } catch (error) { setProblem(messageOf(error)); }
    finally { setLoading(false); }
  }, [definitionName, targetNamespace, instanceName]);
  useEffect(() => {
    if (!definitionName) { setReport(null); return; }
    const timer = window.setTimeout(() => void refresh(), 250);
    return () => window.clearTimeout(timer);
  }, [definitionName, refresh]);
  async function preview() {
    setLoading(true); setProblem(''); setMessage(''); setConfirmed(false);
    try { const query = targetNamespace ? `?namespace=${enc(targetNamespace)}` : ''; setPlan(await request<RbacPlan>(`/api/v1/rbac-advisor/controller/${enc(definitionName)}/plan${query}`)); }
    catch (error) { setProblem(messageOf(error)); }
    finally { setLoading(false); }
  }
  async function applyPlan() {
    if (!plan || !confirmed) return;
    setApplying(true); setProblem(''); setMessage('');
    try {
      const result = await request<{ created: string[]; message: string }>(`/api/v1/rbac-advisor/controller/${enc(definitionName)}/apply`, { method: 'POST', body: JSON.stringify({ confirmed: true, namespace: targetNamespace || null, planToken: plan.planToken }) });
      setMessage(result.message); setPlan(null); setConfirmed(false); await refresh();
    } catch (error) { setProblem(messageOf(error)); }
    finally { setApplying(false); }
  }
  return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>CLUSTER ACCESS</div><h1>RBAC advisor</h1><p className="page-subtitle">Find the permission blocking KRO, review its scope, and apply a focused repair.</p></div><button className="secondary-btn" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14}/>{loading ? 'Checking…' : 'Refresh checks'}</button></div>
    {problem && <div className="advisor-error">{problem}</div>}{message && <div className="advisor-success">{message}</div>}
    {report && <section className={`advisor-summary ${controllerAttention.length ? 'needs-attention' : 'all-clear'}`}><div className="advisor-summary-icon">{controllerAttention.length ? <AlertTriangle size={19}/> : <ShieldCheck size={19}/>}</div><div className="advisor-summary-copy"><b>{controllerAttention.length ? `${controllerAttention.length} controller check${controllerAttention.length === 1 ? '' : 's'} need attention` : 'Controller checks look good'}</b><span>{observedFailures.length ? `${observedFailures.length} observed issue${observedFailures.length === 1 ? '' : 's'} found in the selected graph or instance.` : 'Authorization and observed controller status for the selected resource graph.'}</span></div><div className="advisor-summary-stats"><span><b>{controllerAllowed}</b> allowed</span><span><b>{controllerAttention.length}</b> to review</span></div></section>}
    <section className="overview-card advisor-controller"><div className="card-heading"><div><h2>KRO controller access</h2><p>{report?.controllerIdentity ?? 'kro-system:kro'} · permissions are derived from the selected resource graph.</p></div><span className="advisor-time">{report ? `Updated ${formatDate(report.checkedAt)}` : 'Choose a graph to begin'}</span></div>
      <div className="advisor-controls"><label className="form-field advisor-graph-field"><span>Resource graph</span><select value={definitionName} onChange={(event) => { setDefinitionName(event.target.value); setPlan(null); }}><option value="">Select a resource graph</option>{definitions.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.generatedKind ?? 'API pending'}</option>)}</select></label><label className="form-field"><span>Instance namespace</span><input value={targetNamespace} onChange={(event) => setTargetNamespace(event.target.value)} placeholder="All namespaces"/></label><label className="form-field"><span>Instance name <small>optional</small></span><input value={instanceName} onChange={(event) => setInstanceName(event.target.value)} placeholder="Inspect ManagementFailed"/></label><div className="advisor-actions"><button className="secondary-btn" onClick={() => void refresh()} disabled={!definitionName || loading}><RefreshCw size={14}/>{loading ? 'Checking…' : 'Check'}</button><button className="primary-btn" onClick={() => void preview()} disabled={!definitionName || loading}><ShieldCheck size={14}/>Review repair</button></div></div>
      {observedFailures.length > 0 && <div className="advisor-diagnostics"><div className="advisor-diagnostics-heading"><AlertTriangle size={17}/><div><b>Controller reported a reconciliation failure</b><span>{instanceName ? `Details for ${instanceName}` : 'Observed on the selected resource graph'}</span></div></div>{observedFailures.map((finding, index) => <div className="advisor-diagnostic" key={`${finding.check}-${index}`}><b>{finding.check}</b><p>{finding.detail}</p><small>{finding.source}{finding.namespace ? ` · ${finding.namespace}` : ''}</small></div>)}<p className="advisor-diagnostics-hint">{generatedPatchFinding ? `Generated-instance patch check: ${generatedPatchFinding.status} · ${generatedPatchFinding.apiGroup}/${generatedPatchFinding.resource}.` : 'Compare the failure message with denied or unknown permission checks below.'} A denied patch check can prevent KRO from updating instance metadata or finalizers.</p></div>}
      {report?.controller.length ? <><div className="advisor-results-heading"><div><h3>Permission checks</h3><span>Each row names the verb and Kubernetes resource that was checked.</span></div><div className="advisor-legend"><span className="allowed-dot"/>Allowed <span className="attention-dot"/>Needs review</div></div><FindingTable findings={report.controller.filter((finding) => finding.status !== 'observed failure' && finding.status !== 'observed issue')}/></> : <div className="inline-empty">Choose a resource graph to check controller permissions.</div>}
      {report?.note && <details className="advisor-note"><summary>How these results work</summary><p>{report.note}</p></details>}
    </section>
    {report && <details className="overview-card advisor-studio"><summary><span><b>Studio identity checks</b><small>{report.studioIdentity} · {report.studio.filter((finding) => finding.status === 'denied' || finding.status === 'unknown').length} need review</small></span><ChevronDown size={16}/></summary><FindingTable findings={report.studio}/></details>}
    {plan && <section className="overview-card advisor-plan"><div className="card-heading"><div><h2>Review controller RBAC changes</h2><p>These are the exact objects the studio will create or safely update.</p></div></div><div className="warning-row advisor-impact">{plan.impact}</div><div className="advisor-role-status">{[plan.clusterRole, plan.clusterRoleBinding].map((item) => <div key={item.kind}><b>{item.kind}/{item.name}</b><span>{!item.inspectable ? 'Could not inspect; create only, conflicts will be rejected' : item.exists ? item.managedByStudio && item.matchesPlan ? 'Already exists and matches' : item.canUpdate ? 'Will be updated with reviewed rules' : 'Name conflict: will not be changed' : 'Will be created'}</span></div>)}</div><div className="advisor-rule-table"><div className="advisor-rule-head"><span>API GROUP</span><span>RESOURCE</span><span>VERBS</span><span>SCOPE</span></div>{Object.values(plan.requirements.reduce<Record<string, { apiGroup: string; resource: string; verbs: string[]; scope: string }>>((acc, rule) => { const key = `${rule.apiGroup}/${rule.resource}`; const current = acc[key] ?? { apiGroup: rule.apiGroup || 'core', resource: rule.resource, verbs: [], scope: rule.namespace ? `Namespace ${rule.namespace}` : 'All namespaces / cluster scope' }; if (!current.verbs.includes(rule.verb)) current.verbs.push(rule.verb); acc[key] = current; return acc; }, {})).map((rule) => <div className="advisor-rule-row" key={`${rule.apiGroup}/${rule.resource}`}><code>{rule.apiGroup}</code><code>{rule.resource}</code><span>{rule.verbs.sort().join(', ')}</span><span>{rule.scope}</span></div>)}</div><details className="advisor-manifests"><summary>View manifests</summary><h3>{plan.clusterRole.kind}/{plan.clusterRole.name}</h3><pre className="json-pre">{pretty(plan.clusterRole.manifest)}</pre><h3>{plan.clusterRoleBinding.kind}/{plan.clusterRoleBinding.name}</h3><pre className="json-pre">{pretty(plan.clusterRoleBinding.manifest)}</pre></details><label className="advisor-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}/><span>I reviewed the permissions and want KRO Studio to create missing objects and update any safely extendable studio-managed role.</span></label><div className="dialog-actions"><button className="secondary-btn" onClick={() => { setPlan(null); setConfirmed(false); }}>Cancel</button><button className="primary-btn" onClick={() => void applyPlan()} disabled={!confirmed || applying || plan.clusterRole.exists && (!plan.clusterRole.inspectable || (!plan.clusterRole.matchesPlan && !plan.clusterRole.canUpdate)) || plan.clusterRoleBinding.exists && (!plan.clusterRoleBinding.inspectable || !plan.clusterRoleBinding.matchesPlan)}>{applying ? 'Applying…' : 'Apply reviewed RBAC'}</button></div></section>}
  </>;
}

function FindingTable({ findings }: { findings: RbacFinding[] }) { return <div className="advisor-findings">{findings.map((finding, index) => <div className="advisor-finding" key={`${finding.identity}-${finding.check}-${index}`}><span className={`advisor-status ${finding.status.replace(' ', '-')}`}>{finding.status}</span><div className="advisor-finding-main"><b>{finding.check}</b><small>{finding.verb} · {finding.apiGroup}/{finding.resource}{finding.namespace ? ` · ${finding.namespace}` : ''}</small><p>{finding.detail}</p></div><span className="advisor-source">{finding.source}</span></div>)}</div>; }

function ResourceGraphCatalog({ definitions, loading, query, setQuery, statusFilter, setStatusFilter, filterOpen, setFilterOpen, create, open }: { definitions: Definition[]; loading: boolean; query: string; setQuery: (value: string) => void; statusFilter: string; setStatusFilter: (value: string) => void; filterOpen: boolean; setFilterOpen: (value: boolean) => void; create: () => void; open: (definition: Definition) => void }) {
  const filtered = useMemo(() => definitions.filter((item) => `${item.name} ${item.generatedKind ?? ''}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === 'All statuses' || item.readiness === statusFilter)), [definitions, query, statusFilter]);
  return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>KRO STUDIO <span className="eyebrow-dot">·</span> RESOURCE MANAGEMENT</div><h1>Resource graphs</h1><p className="page-subtitle">Create and manage the definitions that compose your platform APIs.</p></div><button className="primary-btn" onClick={create}><Plus size={17}/> Create resource graph</button></div><div className="section-title-row"><div><div className="section-title"><h2>All resource graphs</h2><span className="total-pill">{loading ? '…' : definitions.length}</span></div><p>Cluster-scoped definitions and their generated Kubernetes APIs.</p></div><div className="table-tools"><label className="search-box"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search graphs..."/></label><div className="filter-wrap"><button className="filter-btn" onClick={() => setFilterOpen(!filterOpen)}><span className="filter-dot"/>{statusFilter}<ChevronDown size={14}/></button>{filterOpen && <div className="filter-menu">{['All statuses', 'Ready', 'Processing', 'Failed'].map((status) => <button key={status} className={status === statusFilter ? 'selected' : ''} onClick={() => { setStatusFilter(status); setFilterOpen(false); }}>{status}</button>)}</div>}</div></div></div><div className="table-card"><div className="table-head"><span>NAME</span><span>GENERATED API</span><span>STATUS</span><span>CREATED</span><span/></div>{loading ? <div className="empty-state"><div className="loader"/><b>Looking for resource graphs</b><span>Reading definitions from your cluster…</span></div> : filtered.length ? filtered.map((item) => <button className="table-row" key={item.name} onClick={() => open(item)}><span className="name-cell"><span className="resource-icon"><GitBranch size={16}/></span><span><b>{item.name}</b><small>{item.kind}</small></span></span><span className="api-cell">{item.generatedKind ? <><span className="api-chip">API</span><b>{item.generatedKind}</b></> : <span className="muted">Discovering…</span>}</span><span><ReadinessBadge status={item.readiness}/></span><span className="date-cell">{formatDate(item.createdAt)}</span><span className="row-arrow"><ArrowRight size={16}/></span></button>) : <Empty icon={<GitBranch size={20}/>} title={query || statusFilter !== 'All statuses' ? 'No matching resource graphs' : 'No resource graphs found'} detail={query || statusFilter !== 'All statuses' ? 'Change the search or status filter.' : 'Create your first definition to generate a reusable API.'} action={<button className="text-action" onClick={create}>Create resource graph <ArrowRight size={14}/></button>}/>}<div className="table-footer"><span>Showing <b>{filtered.length}</b> resource graphs</span><span>{statusFilter}</span></div></div></>;
}

function Dashboard({ definitions, apis, capabilities, loading, onNavigate, onCreate, onOpen }: { definitions: Definition[]; apis: GeneratedApi[]; capabilities: Capability | null; loading: boolean; onNavigate: (nav: string) => void; onCreate: () => void; onOpen: (definition: Definition) => void }) {
  return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>KRO STUDIO <span className="eyebrow-dot">·</span> RESOURCE MANAGEMENT</div><h1>Workspace overview</h1><p className="page-subtitle">Live health and resources from your Kubernetes cluster.</p></div><button className="primary-btn" onClick={onCreate}><Plus size={17}/> Create resource graph</button></div>
    <section className="stats-grid"><StatCard icon={<GitBranch size={17}/>} label="RESOURCE GRAPHS" value={loading ? '—' : String(definitions.length).padStart(2, '0')} detail="Cluster-scoped definitions" tone="blue"/><StatCard icon={<ShieldCheck size={17}/>} label="READY" value={loading ? '—' : String(definitions.filter((item) => item.readiness === 'Ready').length).padStart(2, '0')} detail="Accepted by KRO" tone="green"/><StatCard icon={<Box size={17}/>} label="GENERATED APIS" value={loading ? '—' : String(apis.length).padStart(2, '0')} detail="Discoverable custom APIs" tone="violet"/><StatCard icon={<Layers3 size={17}/>} label="KRO API" value={loading ? '—' : capabilities?.kroApiAvailable ? 'Detected' : 'Unavailable'} detail={capabilities?.message ?? 'ResourceGraphDefinition API'} tone="amber"/></section>
    <section className="catalog-section"><div className="section-title-row"><div><div className="section-title"><h2>Resource graphs</h2><span className="total-pill">{loading ? '…' : definitions.length}</span></div><p>Cluster-scoped definitions that compose Kubernetes resources.</p></div><button className="quiet-action" onClick={() => onNavigate('Resource graphs')}>Open catalog <ArrowRight size={14}/></button></div><div className="table-card"><div className="table-head"><span>NAME</span><span>GENERATED API</span><span>STATUS</span><span>CREATED</span><span/></div>{loading ? <div className="empty-state"><div className="loader"/><b>Loading cluster resources</b><span>Reading live definitions and generated APIs…</span></div> : definitions.length ? definitions.slice(0, 5).map((item) => <button className="table-row" key={item.name} onClick={() => onOpen(item)}><span className="name-cell"><span className="resource-icon"><GitBranch size={16}/></span><span><b>{item.name}</b><small>{item.kind}</small></span></span><span className="api-cell"><b>{item.generatedKind ?? 'Resolving…'}</b></span><span><ReadinessBadge status={item.readiness}/></span><span className="date-cell">{formatDate(item.createdAt)}</span><span className="row-arrow"><ArrowRight size={16}/></span></button>) : <Empty icon={<GitBranch size={20}/>} title="No resource graphs yet" detail="Create a definition to generate a reusable Kubernetes API." action={<button className="text-action" onClick={onCreate}>Create resource graph <ArrowRight size={14}/></button>}/>}</div></section>
    <section className="lower-grid"><div className="activity-card"><div className="lower-heading"><div><h2>Cluster connection</h2><p>Live connection state from the backend.</p></div></div><div className="activity-empty"><div className="activity-circle"><Activity size={15}/></div><span>{loading ? 'Checking cluster connection…' : 'Connection and API status are shown in the header and cards above.'}</span></div></div><div className="quick-card"><div className="quick-top"><span className="sparkle-icon"><Layers3 size={16}/></span><span className="coming-label">WORKSPACE ACTIONS</span></div><h3>Manage generated<br/>instances.</h3><p>Browse, inspect, create, update, and remove resources created by KRO.</p><button className="quick-link" onClick={() => onNavigate('Instances')}>Open instances <ArrowRight size={15}/></button></div></section>
  </>;
}

function DefinitionDetail({ definition, manifest, active, tab, setTab, back, edit, createInstance, remove, retry, busy, openInstances }: { definition: Definition; manifest: Manifest | null; active: string; tab: string; setTab: (value: string) => void; back: () => void; edit: () => void; createInstance: () => void; remove: () => void; retry: () => void; busy: boolean; openInstances: () => void }) {
  const sections = ['Overview', 'Schema', 'Resources', 'YAML']; const spec = manifest?.spec ?? {}; const schema = spec.schema ?? {}; const resources = Array.isArray(spec.resources) ? spec.resources : spec.resources && typeof spec.resources === 'object' ? Object.entries(spec.resources).map(([id, template]) => ({ id, template })) : [];
  return <><div className="detail-back"><button onClick={back}><ArrowLeft size={15}/> Resource graphs</button><span>/</span>{definition.name}</div><div className="detail-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>RESOURCE GRAPH DEFINITION</div><h1>{definition.name}</h1><p className="page-subtitle">{definition.kind} <span className="detail-dot">·</span> {definition.apiVersion}</p></div><div className="detail-actions"><button className="secondary-btn" onClick={retry} disabled={busy}><RefreshCw size={15}/>{busy ? 'Retrying…' : 'Retry reconciliation'}</button><button className="secondary-btn" onClick={edit}><Pencil size={15}/> Edit YAML</button><button className="secondary-btn danger-btn" onClick={remove}><Trash2 size={15}/> Delete</button><button className="primary-btn" onClick={createInstance} disabled={!definition.generatedKind}><Plus size={17}/> Create instance</button></div></div>
    {active === 'Instances' ? <InstancesPageInline definition={definition} openInstances={openInstances}/> : <><div className="detail-tabs">{sections.map((name) => <button className={`detail-tab ${tab === name ? 'active' : ''}`} key={name} onClick={() => setTab(name)}>{name}{name === 'Resources' && <span className="tab-count">{resources.length}</span>}</button>)}</div>
      {tab === 'Overview' && <><div className="detail-stats"><div><span>READINESS</span><ReadinessBadge status={definition.readiness}/></div><div><span>GENERATED API KIND</span><b>{definition.generatedKind ?? 'Pending discovery'}</b></div><div><span>SCOPE</span><b>Cluster-scoped definition</b></div><div><span>CREATED</span><b>{formatDate(definition.createdAt)}</b></div></div><div className="overview-card"><h2>Schema overview</h2><p>Generated API {schema.kind ? `${schema.kind} · ${schema.apiVersion ?? ''}` : 'schema details appear when the definition is available.'}</p><div className="metadata-row"><span>Spec properties</span><b>{Object.keys(schema.spec ?? {}).join(', ') || 'No properties declared'}</b></div></div><div className="detail-columns"><section className="overview-card conditions-card"><div className="card-heading"><div><h2>Conditions</h2><p>Latest KRO processing signals.</p></div><ReadinessBadge status={definition.readiness}/></div>{manifest?.status?.state && <div className="metadata-row"><span>State</span><b>{manifest.status.state}</b></div>}{Array.isArray(manifest?.status?.conditions) && manifest.status.conditions.length ? <div className="condition-list">{manifest.status.conditions.map((condition: Manifest, index: number) => <div className="condition-row" key={index}><span>{condition.type ?? 'Condition'}</span><span>{condition.status ?? 'Unknown'}</span><div className="condition-detail">{condition.reason && <b>{condition.reason}</b>}{condition.message && <p>{condition.message}</p>}{!condition.reason && !condition.message && <span>—</span>}</div></div>)}</div> : <div className="inline-empty"><Activity size={16}/> No condition details reported by the cluster.</div>}</section><section className="overview-card metadata-card"><h2>Metadata</h2><div className="metadata-row"><span>Name</span><b>{definition.name}</b></div><div className="metadata-row"><span>API version</span><b>{definition.apiVersion}</b></div><div className="metadata-row"><span>Resource version</span><b>{manifest?.metadata?.resourceVersion ?? '—'}</b></div><div className="metadata-row"><span>Created</span><b>{formatDate(definition.createdAt)}</b></div></section></div></>}
      {tab === 'Schema' && <JsonPanel title="Generated instance schema" value={schema} empty="The API schema is not present in this definition."/>}
      {tab === 'Resources' && <section className="overview-card"><h2>Declared resources</h2><p>Resource templates declared in this graph definition.</p>{resources.length ? <div className="resource-list">{resources.map((resource: Manifest, index: number) => <div className="resource-list-row" key={resource.id ?? index}><span className="resource-icon"><Box size={16}/></span><div><b>{resource.id ?? `Resource ${index + 1}`}</b><small>{resource.template?.apiVersion ?? 'Unknown API'} · {resource.template?.kind ?? 'Unknown kind'}</small></div><code>{resource.template?.metadata?.name ?? 'Name generated from schema'}</code></div>)}</div> : <Empty icon={<Box size={20}/>} title="No declared resources" detail="This definition does not contain a resources list."/>}</section>}
      {tab === 'YAML' && <JsonPanel title="Manifest (JSON is valid YAML)" value={manifest} empty="Manifest is unavailable."/>}
    </>}
  </>;
}
function InstancesPageInline({ definition, openInstances }: { definition: Definition; openInstances: () => void }) { return <div className="overview-card tab-placeholder"><div className="tab-placeholder-icon"><Box size={20}/></div><h2>Instances of {definition.generatedKind ?? 'this graph'}</h2><p>Review generated resources and their Kubernetes status.</p><button className="primary-btn" onClick={openInstances}>Open instance list <ArrowRight size={14}/></button></div>; }

function InstancesPage({ definitions, selected, instances, loading, namespace, setNamespace, search, setSearch, pageIndex, hasNext, previous, next, choose, create, open, remove }: { definitions: Definition[]; selected: Definition | null; instances: Manifest[]; loading: boolean; namespace: string; setNamespace: (value: string) => void; search: string; setSearch: (value: string) => void; pageIndex: number; hasNext: boolean; previous: () => void; next: () => void; choose: (name: string) => void; create: () => void; open: (item: Manifest) => void; remove: (item: Manifest) => void }) {
  const [scopeDraft, setScopeDraft] = useState(namespace);
  useEffect(() => setScopeDraft(namespace), [namespace]);
  return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>GENERATED RESOURCES</div><h1>Instances</h1><p className="page-subtitle">Live custom resource instances managed by KRO.</p></div><button className="primary-btn" onClick={create} disabled={!selected?.generatedKind}><Plus size={17}/> Create instance</button></div>
    <div className="toolbar-card"><label className="form-field"><span>Resource graph</span><select value={selected?.name ?? ''} onChange={(event) => choose(event.target.value)}>{definitions.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.generatedKind ?? 'API pending'}</option>)}</select></label>{selected && definitions.find((item) => item.name === selected.name)?.generatedKind && <label className="form-field"><span>Namespace / event scope</span><input value={scopeDraft} onChange={(event) => setScopeDraft(event.target.value)} onBlur={() => setNamespace(scopeDraft)} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur(); } }} placeholder="Namespace"/></label>}<label className="search-box"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search instances..."/></label></div>
    <div className="table-card"><div className="table-head instance-table-head"><span>NAME</span><span>NAMESPACE</span><span>STATUS</span><span>CREATED</span><span>ACTIONS</span></div>{loading ? <div className="empty-state"><div className="loader"/><b>Loading instances</b><span>Reading generated resources from the cluster…</span></div> : !selected ? <Empty icon={<GitBranch size={20}/>} title="No resource graphs available" detail="Create or connect a resource graph to manage its instances."/> : !selected.generatedKind ? <Empty icon={<Database size={20}/>} title="Generated API is not ready" detail="This definition needs a generated API kind before instances can be listed."/> : instances.length ? instances.map((item) => <div className="table-row instance-row" key={`${objectNamespace(item)}-${objectName(item)}`}><button className="instance-name" onClick={() => open(item)}><span className="resource-icon"><Box size={16}/></span><b>{objectName(item)}</b></button><span>{objectNamespace(item)}</span><span><ReadinessBadge status={readinessOf(item)}/></span><span className="date-cell">{formatDate(item.metadata?.creationTimestamp)}</span><span className="row-actions"><button aria-label="Inspect instance" onClick={() => open(item)}><ArrowRight size={15}/></button><button aria-label="Delete instance" onClick={() => remove(item)}><Trash2 size={14}/></button></span></div>) : <Empty icon={<Box size={20}/>} title="No instances found" detail="Create an instance to apply this resource graph to your cluster." action={<button className="text-action" onClick={create}>Create instance <ArrowRight size={14}/></button>}/>}<div className="table-footer"><span>Page <b>{pageIndex + 1}</b> · up to 100 results per page</span><div className="pagination"><button disabled={pageIndex === 0 || loading} onClick={previous}>Previous</button><button disabled={!hasNext || loading} onClick={next}>Next</button></div></div></div>
  </>;
}
function readinessOf(item: Manifest) { const ready = item.status?.conditions?.find((condition: Manifest) => condition.type === 'Ready'); return ready?.status === 'True' ? 'Ready' : ready?.reason ?? 'Processing'; }

function ApiCatalog({ apis, search, setSearch, loading, onSelect }: { apis: GeneratedApi[]; search: string; setSearch: (value: string) => void; loading: boolean; onSelect: (api: GeneratedApi) => void }) { return <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>DISCOVERED CUSTOM RESOURCES</div><h1>API catalog</h1><p className="page-subtitle">Generated APIs discovered from your resource graph definitions.</p></div></div><div className="section-title-row"><div><div className="section-title"><h2>Generated APIs</h2><span className="total-pill">{loading ? '…' : apis.length}</span></div><p>API discovery is resolved against the connected Kubernetes cluster.</p></div><label className="search-box"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search APIs..."/></label></div><div className="table-card"><div className="table-head api-table-head"><span>KIND</span><span>API GROUP / VERSION</span><span>RESOURCE</span><span>SCOPE</span><span/></div>{loading ? <div className="empty-state"><div className="loader"/><b>Discovering generated APIs</b><span>Checking each resource graph against Kubernetes API discovery…</span></div> : apis.length ? apis.map((api) => <button className="table-row api-row" key={api.id} onClick={() => onSelect(api)}><span className="name-cell"><span className="resource-icon"><Database size={16}/></span><b>{api.kind}</b></span><span>{api.group}/{api.version}</span><span><code>{api.plural}</code></span><span>{api.namespaced ? 'Namespaced' : 'Cluster'}</span><span className="row-arrow"><ArrowRight size={16}/></span></button>) : <Empty icon={<Database size={20}/>} title="No generated APIs discovered" detail="A ready resource graph with a served custom resource API will appear here."/>}</div></>; }

function ApiDetail({ api, definition, manifest, back }: { api: GeneratedApi; definition?: Definition; manifest: Manifest | null; back: () => void }) { return <><div className="detail-back"><button onClick={back}><ArrowLeft size={15}/> API catalog</button><span>/</span>{api.kind}</div><div className="detail-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>GENERATED CUSTOM API</div><h1>{api.kind}</h1><p className="page-subtitle">{api.group}/{api.version} · {api.plural}</p></div></div><div className="detail-stats"><div><span>RESOURCE</span><b>{api.plural}</b></div><div><span>SCOPE</span><b>{api.namespaced ? 'Namespaced' : 'Cluster'}</b></div><div><span>DEFINITION</span><b>{definition?.name ?? '—'}</b></div><div><span>API VERSION</span><b>{api.version}</b></div></div><div className="detail-columns"><JsonPanel title="OpenAPI schema" value={api.schema} empty="Kubernetes did not return an OpenAPI schema for this API."/><JsonPanel title="Resource graph schema" value={manifest?.spec?.schema} empty="The resource graph definition is unavailable."/></div></>; }

function InstanceDetail({ item, definition, data, tab, setTab, back, edit, remove, namespace, logs, logsResource, loadLogs, logsLoading }: { item: Manifest; definition: Definition; data: { resources: Manifest[]; events: Manifest[]; warnings: string[] }; tab: InstanceTab; setTab: (value: InstanceTab) => void; back: () => void; edit: () => void; remove: () => void; namespace: string; logs: { podName: string; container: string; text: string }[]; logsResource: string | null; loadLogs: (resource: Manifest) => void; logsLoading: boolean }) {
  const [selectedResource, setSelectedResource] = useState<Manifest | null>(null);
  const [inspectTab, setInspectTab] = useState<'Manifest' | 'Logs'>('Manifest');
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const dragState = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const graphCanvas = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ key: string; d: string }[]>([]);
  useEffect(() => { setSelectedResource(data.resources[0] ?? null); setInspectTab('Manifest'); }, [data.resources]);
  useEffect(() => setViewport({ x: 0, y: 0, scale: 1 }), [item]);
  useEffect(() => {
    const canvas = graphCanvas.current;
    if (!canvas) return;
    const measure = () => {
      const root = canvas.querySelector<HTMLElement>('[data-graph-node="root"]');
      const viewportRect = canvas.getBoundingClientRect();
      if (!root) return;
      const point = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return { x: (rect.left + rect.width / 2 - viewportRect.left) / viewport.scale, y: (rect.top + rect.height / 2 - viewportRect.top) / viewport.scale };
      };
      const rootPoint = point(root);
      const byUid = new Map(data.resources.map((resource, index) => [resource.metadata?.uid, index]).filter(([uid]) => Boolean(uid)) as [string, number][]);
      setEdges(data.resources.map((resource, index) => {
        const node = canvas.querySelector<HTMLElement>(`[data-graph-node="resource-${index}"]`);
        if (!node) return null;
        const nodePoint = point(node);
        const explicitParentIndex = resource.parentResourceName ? data.resources.findIndex((candidate) => objectName(candidate) === resource.parentResourceName) : -1;
        const owner = resource.metadata?.ownerReferences?.find((reference: Manifest) => byUid.has(reference.uid));
        const parentIndex = explicitParentIndex >= 0 ? explicitParentIndex : owner ? byUid.get(owner.uid) : undefined;
        const parent = parentIndex === undefined ? rootPoint : (() => {
          const element = canvas.querySelector<HTMLElement>(`[data-graph-node="resource-${parentIndex}"]`);
          return element ? point(element) : rootPoint;
        })();
        const midY = parent.y + (nodePoint.y - parent.y) * 0.52;
        return { key: String(index), d: `M ${parent.x} ${parent.y} C ${parent.x} ${midY}, ${nodePoint.x} ${midY}, ${nodePoint.x} ${nodePoint.y}` };
      }).filter((edge): edge is { key: string; d: string } => edge !== null));
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [data.resources, viewport.scale, viewport.x, viewport.y, tab]);
  const canShowLogs = (resource: Manifest | null) => Boolean(resource && ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job'].includes(resource.kind));
  const zoom = (factor: number) => setViewport((value) => ({ ...value, scale: Math.min(1.6, Math.max(.6, value.scale * factor)) }));
  const resetGraph = () => {
    const view = document.querySelector<HTMLElement>('.graph-viewport');
    const canvas = graphCanvas.current;
    if (!view || !canvas) { setViewport({ x: 0, y: 0, scale: 1 }); return; }
    const scale = Math.min(1, (view.clientWidth - 24) / canvas.offsetWidth, (view.clientHeight - 24) / canvas.offsetHeight);
    setViewport({ x: (view.clientWidth - canvas.offsetWidth * scale) / 2, y: (view.clientHeight - canvas.offsetHeight * scale) / 2, scale });
  };
  const startGraphDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    dragState.current = { x: event.clientX, y: event.clientY, originX: viewport.x, originY: viewport.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveGraphDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    setViewport((value) => ({ ...value, x: dragState.current!.originX + event.clientX - dragState.current!.x, y: dragState.current!.originY + event.clientY - dragState.current!.y }));
  };
  const stopGraphDrag = () => { dragState.current = null; };
  const onGraphWheel = (event: React.WheelEvent<HTMLDivElement>) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.08 : .92); };
  const selectedName = selectedResource ? objectName(selectedResource) : '';
  const selectedKind = selectedResource?.kind ?? '';
  const tabs: InstanceTab[] = ['Overview', 'Resources', 'Events', 'YAML'];
  return <><div className="detail-back"><button onClick={back}><ArrowLeft size={15}/> Instances</button><span>/</span>{objectName(item)}</div><div className="detail-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>GENERATED INSTANCE · {definition.generatedKind}</div><h1>{objectName(item)}</h1><p className="page-subtitle">{objectNamespace(item)} <span className="detail-dot">·</span> {item.apiVersion}</p></div><div className="detail-actions"><button className="secondary-btn" onClick={edit}><Pencil size={15}/> Edit YAML</button><button className="secondary-btn danger-btn" onClick={remove}><Trash2 size={15}/> Delete</button></div></div><div className="detail-tabs">{tabs.map((name) => <button className={`detail-tab ${tab === name ? 'active' : ''}`} key={name} onClick={() => setTab(name)}>{name}{name === 'Resources' && <span className="tab-count">{data.resources.length}</span>}{name === 'Events' && <span className="tab-count">{data.events.length}</span>}</button>)}</div>
    {tab === 'Overview' && <><div className="detail-stats"><div><span>STATUS</span><ReadinessBadge status={readinessOf(item)}/></div><div><span>NAMESPACE</span><b>{objectNamespace(item)}</b></div><div><span>CREATED</span><b>{formatDate(item.metadata?.creationTimestamp)}</b></div><div><span>RESOURCE GRAPH</span><b>{definition.name}</b></div></div><div className="overview-card"><h2>Instance status</h2>{item.status?.conditions?.length ? <div className="condition-list">{item.status.conditions.map((condition: Manifest, index: number) => <div className="condition-row" key={index}><span>{condition.type}</span><span>{condition.status}</span><span>{condition.reason ?? condition.message ?? '—'}</span></div>)}</div> : <div className="inline-empty"><Activity size={16}/> No status conditions reported.</div>}</div></>}
    {tab === 'Resources' && <section className="resource-explorer"><div className="overview-card resource-graph-card"><div className="resource-graph-heading"><div><h2>Resource graph</h2><p>Live objects composed for this instance. Select a node to inspect it; drag the canvas or use the controls to navigate.</p></div><div className="graph-toolbar"><span className="total-pill">{data.resources.length} resources</span><button aria-label="Zoom out" onClick={() => zoom(.85)}><ZoomOut size={14}/></button><button aria-label="Zoom in" onClick={() => zoom(1.18)}><ZoomIn size={14}/></button><button aria-label="Fit graph" onClick={resetGraph}><Maximize2 size={14}/></button></div></div>{data.warnings.map((warning) => <div className="warning-row" key={warning}>{warning}</div>)}{data.resources.length ? <div className="graph-viewport" onPointerDown={startGraphDrag} onPointerMove={moveGraphDrag} onPointerUp={stopGraphDrag} onPointerCancel={stopGraphDrag} onWheel={onGraphWheel}><div className="graph-canvas" ref={graphCanvas} style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}><svg className="graph-edges" aria-hidden="true">{edges.map((edge) => <path key={edge.key} d={edge.d}/>)}</svg><div className="graph-root" data-graph-node="root"><span className="graph-node-icon"><GitBranch size={16}/></span><span><b>{objectName(item)}</b><small>{definition.generatedKind} · instance</small></span><ReadinessBadge status={readinessOf(item)}/></div><div className="graph-resource-grid">{data.resources.map((resource, index) => <button data-graph-node={`resource-${index}`} className={`graph-resource-node ${selectedName === objectName(resource) ? 'selected' : ''}`} key={`${resource.resourceId ?? 'resource'}-${objectName(resource)}-${index}`} onClick={() => { setSelectedResource(resource); setInspectTab('Manifest'); }}><span className="resource-icon"><Box size={16}/></span><span className="graph-node-copy"><b>{objectName(resource)}</b><small>{resource.resourceId ?? 'composed resource'} · {resource.kind ?? 'Resource'}</small></span><ReadinessBadge status={readinessOf(resource)}/></button>)}</div></div><div className="graph-zoom-label">{Math.round(viewport.scale * 100)}%</div></div> : <Empty icon={<Box size={20}/>} title="No composed resources returned" detail={data.warnings[0] ?? 'KRO has not reported child resources for this instance.'}/>}</div>
      {selectedResource && <aside className="resource-inspector"><div className="inspector-heading"><span className="resource-icon"><Box size={16}/></span><div><b>{selectedName}</b><small>{selectedResource.resourceId ?? 'composed resource'} · {selectedKind}</small></div></div><div className="inspector-tabs"><button className={inspectTab === 'Manifest' ? 'active' : ''} onClick={() => setInspectTab('Manifest')}><FileCode2 size={13}/> YAML</button>{canShowLogs(selectedResource) && <button className={inspectTab === 'Logs' ? 'active' : ''} onClick={() => { setInspectTab('Logs'); if (logsResource !== selectedName) loadLogs(selectedResource); }}><Activity size={13}/> Logs</button>}</div>{inspectTab === 'Logs' && !canShowLogs(selectedResource) ? <pre className="resource-manifest">{pretty(selectedResource)}</pre> : inspectTab === 'Manifest' ? <pre className="resource-manifest">{pretty(selectedResource)}</pre> : <div className="resource-log-view">{logsLoading && logsResource === selectedName ? <div className="inline-empty">Loading recent logs…</div> : logsResource !== selectedName ? <div className="inline-empty">Loading recent logs…</div> : logs.length ? logs.map((entry) => <section className="log-container" key={`${entry.podName}-${entry.container}`}><div><b>{entry.podName}</b><small>{entry.container}</small></div><pre>{entry.text || 'No recent output.'}</pre></section>) : <div className="inline-empty">No pod logs are available for this resource. Logs appear for Pods and supported workloads with matching Pods.</div>}</div>}</aside>}
    </section>}
    {tab === 'Events' && <section className="overview-card"><h2>Kubernetes events</h2><p>Events associated with this instance in {namespace}.</p>{data.events.length ? <div className="event-list">{data.events.map((event, index) => <div className="event-row" key={event.metadata?.uid ?? index}><ReadinessBadge status={event.type === 'Warning' ? 'Warning' : 'Normal'}/><div><b>{event.reason ?? 'Event'}</b><p>{event.message ?? 'No event message'}</p><small>{event.source?.component ?? 'Kubernetes'} · {formatDate(event.lastTimestamp ?? event.eventTime)}</small></div></div>)}</div> : <Empty icon={<Activity size={20}/>} title="No related events" detail="No Kubernetes events were returned for this instance."/>}</section>}
    {tab === 'YAML' && <JsonPanel title="Instance manifest" value={item} empty="Instance manifest is unavailable."/>}
  </>;
}

function JsonPanel({ title, value, empty }: { title: string; value: unknown; empty: string }) { return <div className="yaml-panel"><div className="yaml-toolbar"><span><FileCode2 size={15}/>{title}</span><button onClick={() => { if (value) void navigator.clipboard?.writeText(pretty(value)); }} disabled={!value}><Clipboard size={13}/> Copy</button></div>{value ? <pre>{pretty(value)}</pre> : <div className="inline-empty">{empty}</div>}</div>; }

function EditorDialog({ mode, yaml, setYaml, busy, close, validate, save }: { mode: 'create-rgd' | 'edit-rgd' | 'create-instance' | 'edit-instance'; yaml: string; setYaml: (value: string) => void; busy: boolean; close: () => void; validate: () => void; save: () => void }) {
  const rgd = mode.endsWith('rgd'); const creating = mode.startsWith('create'); const title = rgd ? creating ? 'Create resource graph' : 'Edit resource graph' : creating ? 'Create instance' : 'Update instance';
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}><section className="create-dialog"><div className="dialog-heading"><div><span className="dialog-kicker">{rgd ? 'RESOURCE GRAPH YAML' : 'GENERATED API MANIFEST'}</span><h2>{title}</h2><p>{rgd ? 'Validate with the Kubernetes API, then apply the manifest.' : 'Edit the Kubernetes manifest and save it to the connected cluster.'}</p></div><button className="icon-btn" onClick={close} aria-label="Close" disabled={busy}><X size={18}/></button></div><div className="editor-toolbar"><span><span className="editor-dot"/>manifest.yaml</span><span>{rgd ? 'YAML' : 'JSON / YAML'}</span></div><textarea className="yaml-editor" spellCheck={false} value={yaml} onChange={(event) => setYaml(event.target.value)} aria-label="Manifest editor"/><div className="editor-hint"><ShieldCheck size={14}/>{rgd ? 'Server validation performs a dry run and does not persist the manifest.' : 'The manifest must match the discovered API kind, version, and namespace.'}</div><div className="dialog-actions"><button className="secondary-btn" onClick={rgd ? validate : () => { try { JSON.parse(yaml); window.alert('Manifest JSON syntax is valid.'); } catch { window.alert('This instance editor expects valid JSON.'); } }} disabled={busy}><ShieldCheck size={15}/>{busy ? 'Working…' : rgd ? 'Validate with API' : 'Check JSON'}</button><button className="primary-btn" onClick={save} disabled={busy}><ArrowRight size={15}/>{busy ? 'Saving…' : creating ? 'Create' : 'Save changes'}</button></div><div className="dialog-footer-note">Changes are applied to the connected Kubernetes cluster.</div></section></div>;
}
