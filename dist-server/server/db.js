import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
const EMPTY_GRAPH = { version: 1, name: '我的论证图', nodes: [], edges: [] };
/** 快照名称最大长度 */
export const MAX_SNAPSHOT_NAME_LENGTH = 80;
/** 快照数量上限（安全阀，避免无限增长） */
export const MAX_SNAPSHOTS = 500;
/** 校验并规范化快照名称：去除首尾空白，必须非空且不超过长度上限。 */
export function validateSnapshotName(value) {
    if (typeof value !== 'string')
        throw new Error('快照名称必须是非空字符串。');
    const name = value.trim();
    if (!name)
        throw new Error('快照名称不能为空。');
    if (name.length > MAX_SNAPSHOT_NAME_LENGTH) {
        throw new Error(`快照名称长度不能超过 ${MAX_SNAPSHOT_NAME_LENGTH} 个字符。`);
    }
    return name;
}
export function createGraphStore(databasePath) {
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
      node_count INTEGER NOT NULL,
      edge_count INTEGER NOT NULL,
      graph_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
  `);
    // 旧版本数据库没有 position_locked 列：幂等补列，已有节点默认未锁定。
    const nodeColumns = db.prepare('PRAGMA table_info(nodes)').all();
    if (!nodeColumns.some((column) => column.name === 'position_locked')) {
        db.exec('ALTER TABLE nodes ADD COLUMN position_locked INTEGER NOT NULL DEFAULT 0');
    }
    const hydrate = () => {
        const meta = db.prepare('SELECT name FROM graph_meta WHERE id = 1').get();
        const nodeRows = db
            .prepare('SELECT id, label, kind, initial_belief, anchored, position_locked, pos_x, pos_y FROM nodes ORDER BY sort_order, rowid')
            .all();
        const edgeRows = db
            .prepare('SELECT id, source_id, target_id, stance, weight FROM edges ORDER BY sort_order, rowid')
            .all();
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
    const replaceGraph = db.transaction((graph) => {
        db.prepare('DELETE FROM edges').run();
        db.prepare('DELETE FROM nodes').run();
        db.prepare('INSERT OR REPLACE INTO graph_meta (id, name, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)').run(graph.name ?? '我的论证图');
        const insertNode = db.prepare(`INSERT INTO nodes (id, label, kind, initial_belief, anchored, position_locked, pos_x, pos_y, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        graph.nodes.forEach((node, index) => {
            insertNode.run(node.id, node.label, node.kind, node.initialBelief, node.anchored ? 1 : 0, node.positionLocked ? 1 : 0, node.position.x, node.position.y, index);
        });
        const insertEdge = db.prepare(`INSERT INTO edges (id, source_id, target_id, stance, weight, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`);
        graph.edges.forEach((edge, index) => {
            insertEdge.run(edge.id, edge.source, edge.target, edge.stance, edge.weight, index);
        });
        return hydrate();
    });
    const count = db.prepare('SELECT COUNT(*) AS count FROM graph_meta').get();
    if (count.count === 0)
        replaceGraph(EMPTY_GRAPH);
    const toSummary = (row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        nodeCount: row.node_count,
        edgeCount: row.edge_count
    });
    const listSnapshots = () => {
        const rows = db
            .prepare('SELECT id, name, created_at, node_count, edge_count FROM snapshots ORDER BY created_at DESC, rowid DESC')
            .all();
        return rows.map(toSummary);
    };
    const createSnapshot = (name, graph) => {
        const total = db.prepare('SELECT COUNT(*) AS count FROM snapshots').get();
        if (total.count >= MAX_SNAPSHOTS) {
            throw new Error(`快照数量已达上限（${MAX_SNAPSHOTS}），无法继续保存。`);
        }
        const record = {
            id: `snap-${randomUUID()}`,
            name,
            createdAt: new Date().toISOString(),
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            graph
        };
        db.prepare(`INSERT INTO snapshots (id, name, created_at, node_count, edge_count, graph_json)
       VALUES (?, ?, ?, ?, ?, ?)`).run(record.id, record.name, record.createdAt, record.nodeCount, record.edgeCount, JSON.stringify(graph));
        return record;
    };
    const getSnapshot = (id) => {
        const row = db
            .prepare('SELECT id, name, created_at, node_count, edge_count, graph_json FROM snapshots WHERE id = ?')
            .get(id);
        if (!row)
            return null;
        return { ...toSummary(row), graph: JSON.parse(row.graph_json) };
    };
    return {
        getGraph: hydrate,
        replaceGraph: (graph) => replaceGraph(graph),
        listSnapshots,
        createSnapshot,
        getSnapshot,
        close: () => db.close()
    };
}
