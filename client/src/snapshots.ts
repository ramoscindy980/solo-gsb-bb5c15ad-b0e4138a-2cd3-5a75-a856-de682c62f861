import type { GraphDocument, GraphEdge, GraphNode } from '../../shared/graph';

/** 差异条目：仅一方存在的节点 / 连线 */
export interface SnapshotDiffItem {
  id: string;
  /** 供列表展示的标签（节点为节点标签，连线为「来源 → 目标」） */
  label: string;
}

/** 双方都存在但内容有变化的条目，changes 为逐项中文化描述 */
export interface SnapshotDiffChange extends SnapshotDiffItem {
  changes: string[];
}

/** 快照图与当前画布图的完整差异（方向：当前画布 → 恢复快照后的状态） */
export interface SnapshotDiff {
  /** 仅快照中存在的节点：恢复后将新增 */
  addedNodes: SnapshotDiffItem[];
  /** 仅当前画布中存在的节点：恢复后将被移除 */
  removedNodes: SnapshotDiffItem[];
  /** 两边都存在但属性不同的节点 */
  changedNodes: SnapshotDiffChange[];
  /** 仅快照中存在的连线：恢复后将新增 */
  addedEdges: SnapshotDiffItem[];
  /** 仅当前画布中存在的连线：恢复后将被移除 */
  removedEdges: SnapshotDiffItem[];
  /** 两边都存在但关系 / 权重 / 连接不同的连线 */
  changedEdges: SnapshotDiffChange[];
  /** 快照与当前画布完全一致（无任何差异） */
  identical: boolean;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const kindText = (kind: GraphNode['kind']) => (kind === 'evidence' ? '证据' : '观点');
const stanceText = (stance: GraphEdge['stance']) => (stance === 'support' ? '支持' : '反驳');

function nodeChanges(snapshotNode: GraphNode, currentNode: GraphNode): string[] {
  const changes: string[] = [];
  if (snapshotNode.label !== currentNode.label) {
    changes.push(`标签「${currentNode.label}」→「${snapshotNode.label}」`);
  }
  if (snapshotNode.kind !== currentNode.kind) {
    changes.push(`类型 ${kindText(currentNode.kind)} → ${kindText(snapshotNode.kind)}`);
  }
  if (Math.abs(snapshotNode.initialBelief - currentNode.initialBelief) > 1e-9) {
    changes.push(`初始可信度 ${percent(currentNode.initialBelief)} → ${percent(snapshotNode.initialBelief)}`);
  }
  if (Boolean(snapshotNode.anchored) !== Boolean(currentNode.anchored)) {
    changes.push(snapshotNode.anchored ? '改为固定先验' : '取消固定先验');
  }
  if (Boolean(snapshotNode.positionLocked) !== Boolean(currentNode.positionLocked)) {
    changes.push(snapshotNode.positionLocked ? '改为锁定坐标' : '取消锁定坐标');
  }
  if (
    snapshotNode.position.x !== currentNode.position.x ||
    snapshotNode.position.y !== currentNode.position.y
  ) {
    changes.push(
      `位置 (${Math.round(currentNode.position.x)}, ${Math.round(currentNode.position.y)}) → ` +
        `(${Math.round(snapshotNode.position.x)}, ${Math.round(snapshotNode.position.y)})`
    );
  }
  return changes;
}

function edgeChanges(snapshotEdge: GraphEdge, currentEdge: GraphEdge): string[] {
  const changes: string[] = [];
  if (snapshotEdge.source !== currentEdge.source || snapshotEdge.target !== currentEdge.target) {
    changes.push(`连接 ${currentEdge.source} → ${currentEdge.target} 改为 ${snapshotEdge.source} → ${snapshotEdge.target}`);
  }
  if (snapshotEdge.stance !== currentEdge.stance) {
    changes.push(`关系 ${stanceText(currentEdge.stance)} → ${stanceText(snapshotEdge.stance)}`);
  }
  if (Math.abs(snapshotEdge.weight - currentEdge.weight) > 1e-9) {
    changes.push(`权重 ${percent(currentEdge.weight)} → ${percent(snapshotEdge.weight)}`);
  }
  return changes;
}

/** 用图自身的节点标签生成连线的展示标签。 */
function edgeLabel(graph: GraphDocument, edge: GraphEdge): string {
  const labelById = new Map(graph.nodes.map((node) => [node.id, node.label] as const));
  return `${labelById.get(edge.source) ?? edge.source} → ${labelById.get(edge.target) ?? edge.target}`;
}

/**
 * 计算「恢复快照」相对当前画布的差异：added 为恢复后新增、removed 为恢复后移除、changed 为内容变化。
 * 纯前端计算，不触发任何请求或保存。
 */
export function diffSnapshotWithCurrent(snapshot: GraphDocument, current: GraphDocument): SnapshotDiff {
  const currentNodeById = new Map(current.nodes.map((node) => [node.id, node] as const));
  const snapshotNodeById = new Map(snapshot.nodes.map((node) => [node.id, node] as const));

  const addedNodes: SnapshotDiffItem[] = snapshot.nodes
    .filter((node) => !currentNodeById.has(node.id))
    .map((node) => ({ id: node.id, label: node.label }));
  const removedNodes: SnapshotDiffItem[] = current.nodes
    .filter((node) => !snapshotNodeById.has(node.id))
    .map((node) => ({ id: node.id, label: node.label }));
  const changedNodes: SnapshotDiffChange[] = snapshot.nodes
    .map((node) => {
      const currentNode = currentNodeById.get(node.id);
      if (!currentNode) return null;
      const changes = nodeChanges(node, currentNode);
      return changes.length > 0 ? { id: node.id, label: node.label, changes } : null;
    })
    .filter((item): item is SnapshotDiffChange => item !== null);

  const currentEdgeById = new Map(current.edges.map((edge) => [edge.id, edge] as const));
  const snapshotEdgeById = new Map(snapshot.edges.map((edge) => [edge.id, edge] as const));

  const addedEdges: SnapshotDiffItem[] = snapshot.edges
    .filter((edge) => !currentEdgeById.has(edge.id))
    .map((edge) => ({ id: edge.id, label: edgeLabel(snapshot, edge) }));
  const removedEdges: SnapshotDiffItem[] = current.edges
    .filter((edge) => !snapshotEdgeById.has(edge.id))
    .map((edge) => ({ id: edge.id, label: edgeLabel(current, edge) }));
  const changedEdges: SnapshotDiffChange[] = snapshot.edges
    .map((edge) => {
      const currentEdge = currentEdgeById.get(edge.id);
      if (!currentEdge) return null;
      const changes = edgeChanges(edge, currentEdge);
      return changes.length > 0 ? { id: edge.id, label: edgeLabel(snapshot, edge), changes } : null;
    })
    .filter((item): item is SnapshotDiffChange => item !== null);

  const identical =
    addedNodes.length === 0 &&
    removedNodes.length === 0 &&
    changedNodes.length === 0 &&
    addedEdges.length === 0 &&
    removedEdges.length === 0 &&
    changedEdges.length === 0;

  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, changedEdges, identical };
}

/** 把快照的 ISO 创建时间格式化为本地可读时间；无法解析时原样返回。 */
export function formatSnapshotTime(iso: string): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return iso;
  return time.toLocaleString('zh-CN', { hour12: false });
}
