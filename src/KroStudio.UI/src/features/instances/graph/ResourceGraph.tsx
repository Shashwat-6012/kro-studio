import { useEffect, useMemo, useState } from 'react';
import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowDownUp, ArrowLeftRight } from 'lucide-react';
import type { ComposedResource, K8sObject } from '../../../api/types';
import { EmptyState } from '../../../components/EmptyState';
import { FilterChips } from '../../../components/FilterChips';
import { SearchInput } from '../../../components/SearchInput';
import { readStorage, writeStorage } from '../../../lib/storage';
import { TONE_COLORS } from '../../../lib/status';
import { Box } from 'lucide-react';
import { layoutModel, type Direction } from './layout';
import { buildModel } from './model';
import { nodeTypes, type FlowNode } from './nodes';

type ToneFilter = 'all' | 'success' | 'warning' | 'danger';
type Props = { instance: K8sObject; resources: ComposedResource[]; selectedId: string | null; onSelect: (id: string | null) => void };

export function ResourceGraph(props: Props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

function Canvas({ instance, resources, selectedId, onSelect }: Props) {
  const { fitView } = useReactFlow();
  const [direction, setDirection] = useState<Direction>(() => (readStorage('kro-studio:graph-direction', 'TB') === 'LR' ? 'LR' : 'TB'));
  const [search, setSearch] = useState('');
  const [tone, setTone] = useState<ToneFilter>('all');

  const model = useMemo(() => buildModel(instance, resources), [instance, resources]);
  const structureKey = useMemo(() => `${model.nodes.map((n) => n.id).join(',')}|${model.edges.map((e) => e.id).join(',')}`, [model]);
  // Only re-run dagre when the topology or direction changes, not on every status refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const positions = useMemo(() => layoutModel(model, direction), [structureKey, direction]);

  const counts = useMemo(() => {
    const resourceNodes = model.nodes.filter((n) => n.type === 'resource');
    return { all: resourceNodes.length, success: resourceNodes.filter((n) => n.tone === 'success').length, warning: resourceNodes.filter((n) => n.tone === 'warning').length, danger: resourceNodes.filter((n) => n.tone === 'danger').length };
  }, [model]);

  const needle = search.trim().toLowerCase();
  const nodes = useMemo<FlowNode[]>(() => model.nodes.map((node) => {
    const matches = node.type === 'instance' || ((tone === 'all' || node.tone === tone) && (!needle || `${node.name} ${node.kind} ${node.resourceId ?? ''}`.toLowerCase().includes(needle)));
    return { id: node.id, type: node.type, position: positions[node.id] ?? { x: 0, y: 0 }, selected: node.id === selectedId, data: { model: node, dimmed: !matches, direction }, draggable: false, connectable: false };
  }), [model, positions, selectedId, needle, tone, direction]);

  const edges = useMemo<Edge[]>(() => model.edges.map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, type: 'smoothstep', animated: edge.tone === 'warning',
    style: { stroke: TONE_COLORS[edge.tone], strokeWidth: 1.6 },
    markerEnd: { type: MarkerType.ArrowClosed, color: TONE_COLORS[edge.tone], width: 16, height: 16 },
  })), [model]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fitView({ padding: 0.18, duration: 250 }), 60);
    return () => window.clearTimeout(timer);
  }, [structureKey, direction, fitView]);

  const changeDirection = (next: Direction) => { setDirection(next); writeStorage('kro-studio:graph-direction', next); };

  if (!resources.length) {
    return <EmptyState icon={<Box size={20} />} title="No composed resources yet" detail="KRO has not reported child resources for this instance. They appear here as the controller creates them." />;
  }

  return (
    <div className="graph">
      <div className="graph__toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Find a resource…" />
        <FilterChips<ToneFilter> active={tone} onChange={setTone} items={[
          { id: 'all', label: 'All', count: counts.all }, { id: 'success', label: 'Ready', count: counts.success },
          { id: 'warning', label: 'Processing', count: counts.warning }, { id: 'danger', label: 'Failing', count: counts.danger },
        ]} />
        <div className="segmented" role="group" aria-label="Layout direction">
          <button className={direction === 'TB' ? 'is-active' : ''} onClick={() => changeDirection('TB')} title="Top to bottom"><ArrowDownUp size={14} /></button>
          <button className={direction === 'LR' ? 'is-active' : ''} onClick={() => changeDirection('LR')} title="Left to right"><ArrowLeftRight size={14} /></button>
        </div>
      </div>
      <div className="graph__canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_event, node) => onSelect(node.id)}
          onPaneClick={() => onSelect(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.2}
          maxZoom={1.6}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#dedfe8" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeStrokeWidth={2} nodeColor={(node) => TONE_COLORS[(node as FlowNode).data.model.tone]} maskColor="rgba(109,86,217,.08)" />
        </ReactFlow>
      </div>
    </div>
  );
}
