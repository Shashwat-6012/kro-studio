import { useMemo } from 'react';
import type { RbacPlan, RbacPlannedObject } from '../../api/types';
import { CodePanel } from '../../components/CodePanel';
import { groupRules } from './summarize';

function objectState(item: RbacPlannedObject): string {
  if (!item.inspectable) return 'Could not inspect; create only, conflicts will be rejected';
  if (!item.exists) return 'Will be created';
  if (item.managedByStudio && item.matchesPlan) return 'Already exists and matches';
  return item.canUpdate ? 'Will be updated with reviewed rules' : 'Name conflict: will not be changed';
}

export function isPlanBlocked(plan: RbacPlan): boolean {
  const role = plan.clusterRole;
  const binding = plan.clusterRoleBinding;
  return (role.exists && (!role.inspectable || (!role.matchesPlan && !role.canUpdate))) || (binding.exists && (!binding.inspectable || !binding.matchesPlan));
}

type Props = { plan: RbacPlan; confirmed: boolean; onConfirm: (value: boolean) => void; applying: boolean; onApply: () => void; onCancel: () => void };

export function RepairPlan({ plan, confirmed, onConfirm, applying, onApply, onCancel }: Props) {
  const rules = useMemo(() => groupRules(plan.requirements), [plan.requirements]);
  return (
    <section className="card">
      <div className="card__heading"><div><h2>Review controller RBAC changes</h2><p>These are the exact objects the studio will create or safely update.</p></div></div>
      <div className="callout callout--warning">{plan.impact}</div>
      <div className="plan-objects">
        {[plan.clusterRole, plan.clusterRoleBinding].map((item) => <div key={item.kind}><b>{item.kind}/{item.name}</b><span>{objectState(item)}</span></div>)}
      </div>
      <div className="rule-table">
        <div className="rule-table__head"><span>API group</span><span>Resource</span><span>Verbs</span><span>Scope</span></div>
        {rules.map((rule) => <div className="rule-table__row" key={`${rule.apiGroup}/${rule.resource}`}><code>{rule.apiGroup}</code><code>{rule.resource}</code><span>{rule.verbs.join(', ')}</span><span>{rule.scope}</span></div>)}
      </div>
      <details className="disclosure">
        <summary>View manifests</summary>
        <CodePanel title={`${plan.clusterRole.kind}/${plan.clusterRole.name}`} value={plan.clusterRole.manifest} maxHeight={260} />
        <CodePanel title={`${plan.clusterRoleBinding.kind}/${plan.clusterRoleBinding.name}`} value={plan.clusterRoleBinding.manifest} maxHeight={260} />
      </details>
      <label className="check"><input type="checkbox" checked={confirmed} onChange={(event) => onConfirm(event.target.checked)} /><span>I reviewed the permissions and want KRO Studio to create missing objects and update any safely extendable studio-managed role.</span></label>
      <div className="plan-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn--primary" onClick={onApply} disabled={!confirmed || applying || isPlanBlocked(plan)}>{applying ? 'Applying…' : 'Apply reviewed RBAC'}</button>
      </div>
    </section>
  );
}
