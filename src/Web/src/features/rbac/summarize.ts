import type { RbacFinding, RbacRequirement } from '../../api/types';

export const needsAttention = (finding: RbacFinding) => ['denied', 'unknown', 'observed failure', 'observed issue'].includes(finding.status);
export const isObserved = (finding: RbacFinding) => finding.status === 'observed failure' || finding.status === 'observed issue';

export type RuleRow = { apiGroup: string; resource: string; verbs: string[]; scope: string };

/** Collapses per-verb requirements into one row per API group + resource. */
export function groupRules(requirements: RbacRequirement[]): RuleRow[] {
  const rows = new Map<string, RuleRow>();
  for (const rule of requirements) {
    const key = `${rule.apiGroup}/${rule.resource}`;
    const row = rows.get(key) ?? { apiGroup: rule.apiGroup || 'core', resource: rule.resource, verbs: [], scope: rule.namespace ? `Namespace ${rule.namespace}` : 'All namespaces / cluster scope' };
    if (!row.verbs.includes(rule.verb)) row.verbs.push(rule.verb);
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => ({ ...row, verbs: [...row.verbs].sort() }));
}
