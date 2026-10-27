import { useState } from 'react';
import { AlertTriangle, ChevronDown, RefreshCw, ShieldCheck } from 'lucide-react';
import { messageOf } from '../../api/client';
import { useApplyRbac, useDefinitions, useRbacPlan, useRbacReport } from '../../api/hooks';
import type { RbacPlan } from '../../api/types';
import { useNamespace } from '../../app/NamespaceProvider';
import { Field } from '../../components/Field';
import { PageHeader } from '../../components/PageHeader';
import { useDebounced } from '../../hooks/useDebounced';
import { formatDate } from '../../lib/format';
import { FindingList } from './FindingList';
import { RepairPlan } from './RepairPlan';
import { isObserved, needsAttention } from './summarize';

export function RbacAdvisorPage() {
  const { data: definitions = [] } = useDefinitions();
  const { namespace } = useNamespace();
  const [selectedGraph, setSelectedGraph] = useState('');
  const [targetNamespace, setTargetNamespace] = useState(namespace || 'default');
  const [instanceName, setInstanceName] = useState('');
  const [plan, setPlan] = useState<RbacPlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');

  const definitionName = selectedGraph || definitions[0]?.name || '';
  const debounced = useDebounced({ definitionName, namespace: targetNamespace, instanceName }, 300);
  const reportQuery = useRbacReport(debounced);
  const planMutation = useRbacPlan();
  const applyMutation = useApplyRbac();
  const report = reportQuery.data;

  const attention = report?.controller.filter(needsAttention) ?? [];
  const observed = report?.controller.filter(isObserved) ?? [];
  const allowed = report?.controller.filter((finding) => finding.status === 'allowed').length ?? 0;
  const patchFinding = report?.controller.find((finding) => finding.check === 'Patch generated instances');
  const problem = reportQuery.error ?? planMutation.error ?? applyMutation.error;

  const preview = () => {
    setMessage(''); setConfirmed(false); applyMutation.reset();
    planMutation.mutate({ definitionName, namespace: targetNamespace || undefined }, { onSuccess: setPlan });
  };
  const apply = () => {
    if (!plan || !confirmed) return;
    applyMutation.mutate({ definitionName, payload: { confirmed: true, namespace: targetNamespace || null, planToken: plan.planToken } }, {
      onSuccess: (result) => { setMessage(result.message); setPlan(null); setConfirmed(false); },
    });
  };

  return (
    <>
      <PageHeader title="RBAC advisor" subtitle="Find the permission blocking KRO, review its scope, and apply a focused repair." actions={<button className="btn" onClick={() => void reportQuery.refetch()} disabled={reportQuery.isFetching || !definitionName}><RefreshCw size={14} className={reportQuery.isFetching ? 'spin' : ''} />{reportQuery.isFetching ? 'Checking…' : 'Refresh checks'}</button>} />
      {problem && <div className="callout callout--danger">{messageOf(problem)}</div>}
      {message && <div className="callout callout--success">{message}</div>}

      {report && (
        <section className={`summary ${attention.length ? 'summary--attention' : 'summary--clear'}`}>
          <div className="summary__icon">{attention.length ? <AlertTriangle size={19} /> : <ShieldCheck size={19} />}</div>
          <div className="summary__copy">
            <b>{attention.length ? `${attention.length} controller check${attention.length === 1 ? '' : 's'} need attention` : 'Controller checks look good'}</b>
            <span>{observed.length ? `${observed.length} observed issue${observed.length === 1 ? '' : 's'} found in the selected graph or instance.` : 'Authorization and observed controller status for the selected resource graph.'}</span>
          </div>
          <div className="summary__stats"><span><b>{allowed}</b> allowed</span><span><b>{attention.length}</b> to review</span></div>
        </section>
      )}

      <section className="card">
        <div className="card__heading"><div><h2>KRO controller access</h2><p>{report?.controllerIdentity ?? 'kro-system:kro'} · permissions are derived from the selected resource graph.</p></div><span className="muted-text">{report ? `Updated ${formatDate(report.checkedAt)}` : 'Choose a graph to begin'}</span></div>
        <div className="advisor-controls">
          <Field label="Resource graph" className="advisor-controls__graph">
            <select value={definitionName} onChange={(event) => { setSelectedGraph(event.target.value); setPlan(null); }}>
              <option value="">Select a resource graph</option>
              {definitions.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.generatedKind ?? 'API pending'}</option>)}
            </select>
          </Field>
          <Field label="Instance namespace"><input value={targetNamespace} onChange={(event) => setTargetNamespace(event.target.value)} placeholder="All namespaces" /></Field>
          <Field label="Instance name" hint="optional"><input value={instanceName} onChange={(event) => setInstanceName(event.target.value)} placeholder="Inspect a failing instance" /></Field>
          <button className="btn btn--primary" onClick={preview} disabled={!definitionName || planMutation.isPending}><ShieldCheck size={14} />{planMutation.isPending ? 'Preparing…' : 'Review repair'}</button>
        </div>

        {observed.length > 0 && (
          <div className="diagnostics">
            <div className="diagnostics__heading"><AlertTriangle size={17} /><div><b>Controller reported a reconciliation failure</b><span>{instanceName ? `Details for ${instanceName}` : 'Observed on the selected resource graph'}</span></div></div>
            {observed.map((finding, index) => <div className="diagnostic" key={`${finding.check}-${index}`}><b>{finding.check}</b><p>{finding.detail}</p><small>{finding.source}{finding.namespace ? ` · ${finding.namespace}` : ''}</small></div>)}
            <p className="diagnostics__hint">{patchFinding ? `Generated-instance patch check: ${patchFinding.status} · ${patchFinding.apiGroup}/${patchFinding.resource}.` : 'Compare the failure message with denied or unknown permission checks below.'} A denied patch check can prevent KRO from updating instance metadata or finalizers.</p>
          </div>
        )}

        {report?.controller.length ? (
          <>
            <div className="results-heading">
              <div><h3>Permission checks</h3><span>Each row names the verb and Kubernetes resource that was checked.</span></div>
              <div className="legend"><span className="dot dot--green dot--small" />Allowed <span className="dot dot--amber dot--small" />Needs review</div>
            </div>
            <FindingList findings={report.controller.filter((finding) => !isObserved(finding))} />
          </>
        ) : <div className="inline-empty">{reportQuery.isFetching ? 'Checking permissions…' : 'Choose a resource graph to check controller permissions.'}</div>}

        {report?.note && <details className="disclosure"><summary>How these results work</summary><p>{report.note}</p></details>}
      </section>

      {report && (
        <details className="card disclosure disclosure--card">
          <summary><span><b>Studio identity checks</b><small>{report.studioIdentity} · {report.studio.filter(needsAttention).length} need review</small></span><ChevronDown size={16} /></summary>
          <FindingList findings={report.studio} />
        </details>
      )}

      {plan && <RepairPlan plan={plan} confirmed={confirmed} onConfirm={setConfirmed} applying={applyMutation.isPending} onApply={apply} onCancel={() => { setPlan(null); setConfirmed(false); }} />}
    </>
  );
}
