import type { ComposedResource, Condition, K8sObject } from '../api/types';

export const objectName = (value?: K8sObject | null) => value?.metadata?.name ?? 'Unnamed';
export const objectNamespace = (value?: K8sObject | null) => value?.metadata?.namespace ?? '—';
export const conditionsOf = (value?: K8sObject | null): Condition[] => (Array.isArray(value?.status?.conditions) ? value!.status!.conditions : []);

/** Stable id for a composed resource (used by the graph and the inspector). */
export function resourceNodeId(resource: ComposedResource): string {
  const object = resource.object;
  return object.metadata?.uid ?? `${object.kind ?? 'Resource'}/${object.metadata?.namespace ?? ''}/${objectName(object)}/${resource.resourceId}`;
}

const STATE_LABELS: Record<string, string> = {
  ACTIVE: 'Ready',
  IN_PROGRESS: 'Processing',
  FAILED: 'Failed',
  ERROR: 'Failed',
  DELETING: 'Deleting',
};

/** Status label for a generated KRO instance. */
export function instanceStatus(item: K8sObject): string {
  const ready = conditionsOf(item).find((condition) => condition.type === 'Ready');
  if (ready?.status === 'True') return 'Ready';
  const state = item.status?.state as string | undefined;
  if (state && STATE_LABELS[state]) return STATE_LABELS[state];
  return ready?.reason ?? 'Processing';
}

const WORKLOADS = ['Deployment', 'StatefulSet', 'ReplicaSet'];
export const LOGGABLE_KINDS = ['Pod', 'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job'];
export const canShowLogs = (kind?: string) => Boolean(kind && LOGGABLE_KINDS.includes(kind));

/** Best-effort health label for any composed Kubernetes object. */
export function resourceStatus(object: K8sObject): string {
  const status = object.status ?? {};
  const conditions = conditionsOf(object);
  const condition = (type: string) => conditions.find((entry) => entry.type === type);

  switch (object.kind) {
    case 'Pod': {
      const waiting = (status.containerStatuses ?? []).map((entry: any) => entry?.state?.waiting?.reason).find(Boolean);
      if (waiting) return waiting;
      if (status.phase === 'Running') return condition('Ready')?.status === 'True' ? 'Ready' : 'Processing';
      return status.phase ?? 'Processing';
    }
    case 'Job':
      if (condition('Failed')?.status === 'True') return 'Failed';
      return condition('Complete')?.status === 'True' ? 'Complete' : 'Processing';
    case 'DaemonSet':
      return (status.numberReady ?? 0) >= (status.desiredNumberScheduled ?? 0) ? 'Ready' : 'Processing';
    default:
      break;
  }
  if (object.kind && WORKLOADS.includes(object.kind)) {
    if (condition('Progressing')?.status === 'False' || condition('ReplicaFailure')?.status === 'True') return 'Failed';
    const desired = object.spec?.replicas ?? 1;
    return (status.readyReplicas ?? 0) >= desired ? 'Ready' : 'Processing';
  }
  const ready = condition('Ready') ?? condition('Available') ?? condition('Established');
  if (ready) return ready.status === 'True' ? 'Ready' : ready.reason ?? 'Processing';
  return 'Created';
}
