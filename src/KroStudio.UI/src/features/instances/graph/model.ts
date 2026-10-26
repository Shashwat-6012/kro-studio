import type { ComposedResource, K8sObject } from '../../../api/types';
import { instanceStatus, objectName, resourceNodeId, resourceStatus } from '../../../lib/k8s';
import { toneOf, type Tone } from '../../../lib/status';

export const INSTANCE_NODE_ID = '__instance__';

export type ModelNode = {
  id: string;
  type: 'instance' | 'resource';
  name: string;
  kind: string;
  /** KRO resource id (the `id:` in the resource graph definition). */
  resourceId?: string;
  status: string;
  tone: Tone;
  object: K8sObject;
};
export type ModelEdge = { id: string; source: string; target: string; tone: Tone };
export type GraphModel = { nodes: ModelNode[]; edges: ModelEdge[] };

/** Turns the instance and its composed resources into a node/edge model (parent links from KRO or ownerReferences). */
export function buildModel(instance: K8sObject, resources: ComposedResource[]): GraphModel {
  const instanceStatusLabel = instanceStatus(instance);
  const nodes: ModelNode[] = [{
    id: INSTANCE_NODE_ID, type: 'instance', name: objectName(instance), kind: instance.kind ?? 'Instance',
    status: instanceStatusLabel, tone: toneOf(instanceStatusLabel), object: instance,
  }];

  const idByUid = new Map<string, string>();
  const idsByName = new Map<string, string[]>();
  for (const resource of resources) {
    const id = resourceNodeId(resource);
    const label = resourceStatus(resource.object);
    nodes.push({ id, type: 'resource', name: objectName(resource.object), kind: resource.object.kind ?? 'Resource', resourceId: resource.resourceId, status: label, tone: toneOf(label), object: resource.object });
    if (resource.object.metadata?.uid) idByUid.set(resource.object.metadata.uid, id);
    const name = objectName(resource.object);
    idsByName.set(name, [...(idsByName.get(name) ?? []), id]);
  }

  const edges: ModelEdge[] = [];
  const toneById = new Map(nodes.map((node) => [node.id, node.tone]));
  for (const resource of resources) {
    const id = resourceNodeId(resource);
    let parent: string | undefined;
    if (resource.parentResourceName) parent = idsByName.get(resource.parentResourceName)?.find((candidate) => candidate !== id);
    if (!parent) {
      const owner = resource.object.metadata?.ownerReferences?.find((reference) => idByUid.has(reference.uid));
      if (owner) parent = idByUid.get(owner.uid);
    }
    parent = parent && parent !== id ? parent : INSTANCE_NODE_ID;
    edges.push({ id: `${parent}->${id}`, source: parent, target: id, tone: toneById.get(id) ?? 'neutral' });
  }
  return { nodes, edges };
}
