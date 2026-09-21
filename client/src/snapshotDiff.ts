import type { GraphDocument, GraphEdge, GraphNode } from '../../shared/graph';

/** 同一节点在当前图与快照图之间的逐字段变化（方向：当前 → 快照，即恢复后会发生什么）。 */
export interface NodeChange {
  /** 当前图中的节点 */
  current: GraphNode;
  /** 快照中的节点 */
  snapshot: GraphNode;
  /** 中文字段级变化描述，如「初始可信度 50%→80%」 */
  changes: string[];
}

/** 同一连线在当前图与快照图之间的逐字段变化（方向：当前 → 快照）。 */
export interface EdgeChange {
  current: GraphEdge;
  snapshot: GraphEdge;
  changes: string[];
}

/** 快照图与当前图的结构化差异；恢复 = 用快照整体替换当前图。 */
export interface GraphDiff {
  /** 仅在快照中存在的节点：恢复后回到画布 */
  nodesRestored: GraphNode[];
  /** 仅在当前图中存在的节点：恢复后从画布消失 */
  nodesRemoved: GraphNode[];
  /** 两边都存在但属性不同的节点 */
  nodesChanged: NodeChange[];
  /** 仅在快照中存在的连线 */
  edgesRestored: GraphEdge[];
  /** 仅在当前图中存在的连线 */
  edgesRemoved: GraphEdge[];
  /** 两边都存在但属性不同的连线 */
  edgesChanged: EdgeChange[];
  /** 图名称是否会被快照名称替换 */
  nameChanged: boolean;
  /** 快照与当前图完全一致（恢复不产生任何变化） */
  identical: boolean;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const stanceText = (stance: GraphEdge['stance']) => (stance === 'support' ? '支持' : '反驳');
const kindText = (kind: GraphNode['kind']) => (kind === 'claim' ? '观点' : '证据');

function diffNode(current: GraphNode, snapshot: GraphNode): string[] {
  const changes: string[] = [];
  if (current.label !== snapshot.label) changes.push('标签');
  if (current.kind !== snapshot.kind) changes.push(`类型 ${kindText(current.kind)}→${kindText(snapshot.kind)}`);
  if (current.initialBelief !== snapshot.initialBelief) {
    changes.push(`初始可信度 ${percent(current.initialBelief)}→${percent(snapshot.initialBelief)}`);
  }
  if (current.anchored !== snapshot.anchored) changes.push(snapshot.anchored ? '改为固定' : '取消固定');
  if (Boolean(current.positionLocked) !== Boolean(snapshot.positionLocked)) {
    changes.push(snapshot.positionLocked ? '锁定位置' : '解除位置锁定');
  }
  if (current.position.x !== snapshot.position.x || current.position.y !== snapshot.position.y) {
    changes.push('位置');
  }
  return changes;
}

function diffEdge(current: GraphEdge, snapshot: GraphEdge): string[] {
  const changes: string[] = [];
  if (current.source !== snapshot.source || current.target !== snapshot.target) changes.push('两端节点');
  if (current.stance !== snapshot.stance) {
    changes.push(`关系 ${stanceText(current.stance)}→${stanceText(snapshot.stance)}`);
  }
  if (current.weight !== snapshot.weight) {
    changes.push(`权重 ${percent(current.weight)}→${percent(snapshot.weight)}`);
  }
  return changes;
}

/** 计算「当前图 → 快照图」的差异：恢复该快照后画布会发生的变化。 */
export function diffGraphs(current: GraphDocument, snapshot: GraphDocument): GraphDiff {
  const currentNodeById = new Map(current.nodes.map((node) => [node.id, node] as const));
  const snapshotNodeById = new Map(snapshot.nodes.map((node) => [node.id, node] as const));

  const nodesRestored = snapshot.nodes.filter((node) => !currentNodeById.has(node.id));
  const nodesRemoved = current.nodes.filter((node) => !snapshotNodeById.has(node.id));
  const nodesChanged: NodeChange[] = [];
  for (const snapshotNode of snapshot.nodes) {
    const currentNode = currentNodeById.get(snapshotNode.id);
    if (!currentNode) continue;
    const changes = diffNode(currentNode, snapshotNode);
    if (changes.length > 0) nodesChanged.push({ current: currentNode, snapshot: snapshotNode, changes });
  }

  const currentEdgeById = new Map(current.edges.map((edge) => [edge.id, edge] as const));
  const snapshotEdgeById = new Map(snapshot.edges.map((edge) => [edge.id, edge] as const));

  const edgesRestored = snapshot.edges.filter((edge) => !currentEdgeById.has(edge.id));
  const edgesRemoved = current.edges.filter((edge) => !snapshotEdgeById.has(edge.id));
  const edgesChanged: EdgeChange[] = [];
  for (const snapshotEdge of snapshot.edges) {
    const currentEdge = currentEdgeById.get(snapshotEdge.id);
    if (!currentEdge) continue;
    const changes = diffEdge(currentEdge, snapshotEdge);
    if (changes.length > 0) edgesChanged.push({ current: currentEdge, snapshot: snapshotEdge, changes });
  }

  const nameChanged = (current.name ?? '') !== (snapshot.name ?? '');
  const identical =
    !nameChanged &&
    nodesRestored.length === 0 &&
    nodesRemoved.length === 0 &&
    nodesChanged.length === 0 &&
    edgesRestored.length === 0 &&
    edgesRemoved.length === 0 &&
    edgesChanged.length === 0;

  return {
    nodesRestored,
    nodesRemoved,
    nodesChanged,
    edgesRestored,
    edgesRemoved,
    edgesChanged,
    nameChanged,
    identical
  };
}
