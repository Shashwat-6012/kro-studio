import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Box, Boxes, Clock, Cog, FileText, Globe, GitBranch, HardDrive, KeyRound, Network, Play, Server, Shield } from 'lucide-react';
import type { ComponentType } from 'react';
import { StatusBadge } from '../../../components/StatusBadge';
import { cx } from '../../../lib/format';
import type { Tone } from '../../../lib/status';
import type { Direction } from './layout';
import type { ModelNode } from './model';

export type FlowNodeData = { model: ModelNode; dimmed: boolean; direction: Direction };
export type FlowNode = Node<FlowNodeData, 'resource' | 'instance'>;

const ICONS: Record<string, ComponentType<{ size?: number }>> = {
  Pod: Box, Deployment: Boxes, ReplicaSet: Boxes, StatefulSet: Boxes, DaemonSet: Boxes, Service: Network, Ingress: Globe,
  ConfigMap: FileText, Secret: KeyRound, PersistentVolumeClaim: HardDrive, CronJob: Clock, Job: Play,
  ServiceAccount: Cog, Role: Shield, RoleBinding: Shield, ClusterRole: Shield, ClusterRoleBinding: Shield, Namespace: Server,
};
export const KindIcon = ({ kind, size = 16 }: { kind: string; size?: number }) => {
  const Icon = ICONS[kind] ?? Box;
  return <Icon size={size} />;
};

function Handles({ direction }: { direction: Direction }) {
  return (
    <>
      <Handle type="target" position={direction === 'LR' ? Position.Left : Position.Top} isConnectable={false} />
      <Handle type="source" position={direction === 'LR' ? Position.Right : Position.Bottom} isConnectable={false} />
    </>
  );
}

function FlowCard({ data, selected, root }: { data: FlowNodeData; selected: boolean; root?: boolean }) {
  const { model, dimmed, direction } = data;
  const tone: Tone = model.tone;
  return (
    <div className={cx('flow-node', `flow-node--${tone}`, root && 'flow-node--root', selected && 'is-selected', dimmed && 'is-dimmed')}>
      <Handles direction={direction} />
      <span className="flow-node__icon">{root ? <GitBranch size={16} /> : <KindIcon kind={model.kind} />}</span>
      <span className="flow-node__copy">
        <b title={model.name}>{model.name}</b>
        <small title={`${model.kind}${model.resourceId ? ` · ${model.resourceId}` : ''}`}>{root ? `${model.kind} · instance` : `${model.kind}${model.resourceId ? ` · ${model.resourceId}` : ''}`}</small>
      </span>
      <StatusBadge status={model.status} tone={tone} compact />
    </div>
  );
}

export const ResourceFlowNode = ({ data, selected }: NodeProps<FlowNode>) => <FlowCard data={data} selected={selected} />;
export const InstanceFlowNode = ({ data, selected }: NodeProps<FlowNode>) => <FlowCard data={data} selected={selected} root />;
export const nodeTypes = { resource: ResourceFlowNode, instance: InstanceFlowNode };
