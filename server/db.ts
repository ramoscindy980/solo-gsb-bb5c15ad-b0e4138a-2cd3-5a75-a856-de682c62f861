import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { GraphDocument, SnapshotRecord, SnapshotSummary } from '../shared/graph.js';

const EMPTY_GRAPH: GraphDocument = { version: 1, name: '我的论证图', nodes: [], edges: [] };

/** 快照数量上限：防止列表无限增长，达到后需先删除旧快照。 */
const SNAPSHOT_LIMIT = 100;

export interface GraphStore {
  getGraph(): GraphDocument;
  replaceGraph(graph: GraphDocument): GraphDocument;
  listSnapshots(): SnapshotSummary[];
  createSnapshot(name: string, graph: GraphDocument): SnapshotSummary;
  getSnapshot(id: string): SnapshotRecord | null;
  deleteSnapshot(id: string): boolean;
  close(): void;
}

interface SnapshotRow {
  id: string;
  name: string;
  created_at: string;
  graph_json: string;
}

export function createGraphStore(databasePath: string): GraphStore {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('claim', 'evidence')),
      initial_belief REAL NOT NULL CHECK (initial_belief BETWEEN 0 AND 1),
      anchored INTEGER NOT NULL DEFAULT 0,
      position_locked INTEGER NOT NULL DEFAULT 0,
      pos_x REAL NOT NULL DEFAULT 0,
      pos_y REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      stance TEXT NOT NULL CHECK (stance IN ('support', 'rebut')),
      weight REAL NOT NULL CHECK (weight BETWEEN 0 AND 1),
      sort_order INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      graph_json TEXT NOT NULL
    );
  `);

  // 旧版本数据库没有 position_locked 列：幂等补列，已有节点默认未锁定。
  const nodeColumns = db.prepare('PRAGMA table_info(nodes)').all() as Array<{ name: string }>;
  if (!nodeColumns.some((column) => column.name === 'position_locked')) {
    db.exec('ALTER TABLE nodes ADD COLUMN position_locked INTEGER NOT NULL DEFAULT 0');
  }

  const hydrate = (): GraphDocument => {
    const meta = db.prepare('SELECT name FROM graph_meta WHERE id = 1').get() as { name: string } | undefined;
    const nodeRows = db
      .prepare(
        'SELECT id, label, kind, initial_belief, anchored, position_locked, pos_x, pos_y FROM nodes ORDER BY sort_order, rowid'
      )
      .all() as Array<{
        id: string;
        label: string;
        kind: 'claim' | 'evidence';
        initial_belief: number;
        anchored: number;
        position_locked: number;
        pos_x: number;
        pos_y: number;
      }>;
    const edgeRows = db
      .prepare('SELECT id, source_id, target_id, stance, weight FROM edges ORDER BY sort_order, rowid')
      .all() as Array<{
        id: string;
        source_id: string;
        target_id: string;
        stance: 'support' | 'rebut';
        weight: number;
      }>;

    return {
      version: 1,
      name: meta?.name ?? '我的论证图',
      nodes: nodeRows.map((row) => ({
        id: row.id,
        label: row.label,
        kind: row.kind,
        initialBelief: row.initial_belief,
        anchored: Boolean(row.anchored),
        positionLocked: Boolean(row.position_locked),
        position: { x: row.pos_x, y: row.pos_y }
      })),
      edges: edgeRows.map((row) => ({
        id: row.id,
        source: row.source_id,
        target: row.target_id,
        stance: row.stance,
        weight: row.weight
      }))
    };
  };

  const replaceGraph = db.transaction((graph: GraphDocument) => {
    db.prepare('DELETE FROM edges').run();
    db.prepare('DELETE FROM nodes').run();
    db.prepare('INSERT OR REPLACE INTO graph_meta (id, name, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)').run(
      graph.name ?? '我的论证图'
    );
    const insertNode = db.prepare(
      `INSERT INTO nodes (id, label, kind, initial_belief, anchored, position_locked, pos_x, pos_y, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    graph.nodes.forEach((node, index) => {
      insertNode.run(
        node.id,
        node.label,
        node.kind,
        node.initialBelief,
        node.anchored ? 1 : 0,
        node.positionLocked ? 1 : 0,
        node.position.x,
        node.position.y,
        index
      );
    });
    const insertEdge = db.prepare(
      `INSERT INTO edges (id, source_id, target_id, stance, weight, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    graph.edges.forEach((edge, index) => {
      insertEdge.run(edge.id, edge.source, edge.target, edge.stance, edge.weight, index);
    });
    return hydrate();
  });

  const count = db.prepare('SELECT COUNT(*) AS count FROM graph_meta').get() as { count: number };
  if (count.count === 0) replaceGraph(EMPTY_GRAPH);

  // 快照为只读：创建后只提供读取 / 删除，绝不提供更新接口。
  const rowToSummary = (row: SnapshotRow): SnapshotSummary => {
    const graph = JSON.parse(row.graph_json) as GraphDocument;
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length
    };
  };

  const listSnapshots = (): SnapshotSummary[] => {
    const rows = db
      .prepare('SELECT id, name, created_at, graph_json FROM snapshots ORDER BY created_at DESC, rowid DESC')
      .all() as SnapshotRow[];
    return rows.map(rowToSummary);
  };

  const createSnapshot = (name: string, graph: GraphDocument): SnapshotSummary => {
    const total = db.prepare('SELECT COUNT(*) AS count FROM snapshots').get() as { count: number };
    if (total.count >= SNAPSHOT_LIMIT) {
      throw new Error(`快照数量已达上限 ${SNAPSHOT_LIMIT} 个，请先删除不再需要的快照。`);
    }
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO snapshots (id, name, created_at, graph_json) VALUES (?, ?, ?, ?)').run(
      id,
      name,
      createdAt,
      JSON.stringify(graph)
    );
    return { id, name, createdAt, nodeCount: graph.nodes.length, edgeCount: graph.edges.length };
  };

  const getSnapshot = (id: string): SnapshotRecord | null => {
    const row = db
      .prepare('SELECT id, name, created_at, graph_json FROM snapshots WHERE id = ?')
      .get(id) as SnapshotRow | undefined;
    if (!row) return null;
    return { ...rowToSummary(row), graph: JSON.parse(row.graph_json) as GraphDocument };
  };

  const deleteSnapshot = (id: string): boolean =>
    db.prepare('DELETE FROM snapshots WHERE id = ?').run(id).changes > 0;

  return {
    getGraph: hydrate,
    replaceGraph: (graph) => replaceGraph(graph) as GraphDocument,
    listSnapshots,
    createSnapshot,
    getSnapshot,
    deleteSnapshot,
    close: () => db.close()
  };
}
