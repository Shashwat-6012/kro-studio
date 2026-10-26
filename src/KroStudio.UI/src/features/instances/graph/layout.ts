import dagre from '@dagrejs/dagre';
import type { GraphModel } from './model';

export type Direction = 'TB' | 'LR';
export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 66;

/** Top-left positions for every node, computed with dagre. */
export function layoutModel(model: GraphModel, direction: Direction): Record<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, nodesep: direction === 'TB' ? 28 : 22, ranksep: direction === 'TB' ? 70 : 90, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of model.nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of model.edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of model.nodes) {
    const point = graph.node(node.id);
    positions[node.id] = { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 };
  }
  return positions;
}
