import type { GraphDocument, GraphEdge, GraphNode, SnapshotRecord, SnapshotSummary } from '../../../shared/graph';
import type { GraphDiff } from '../snapshotDiff';

export interface SnapshotCardProps {
  /** 按创建时间倒序的快照摘要列表 */
  list: SnapshotSummary[];
  /** 是否有快照相关请求在进行中 */
  busy: boolean;
  /** 快照操作的状态提示（保存 / 载入 / 删除结果） */
  status: string;
  /** 新快照名称输入框的值 */
  name: string;
  onNameChange: (name: string) => void;
  /** 把当前画布整体保存为只读快照 */
  onSave: () => void;
  /** 点击列表项：载入并预览该快照与当前图的差异（再次点击取消预览） */
  onPreview: (id: string) => void;
  onDelete: (id: string) => void;
  /** 正在预览的完整快照；null 表示未在预览 */
  preview: SnapshotRecord | null;
  /** 预览快照与当前图的差异（随画布编辑实时重算） */
  diff: GraphDiff | null;
  /** 当前画布图（用于差异明细中的节点标签查询） */
  currentGraph: GraphDocument;
  /** 确认后整体恢复快照并沿用自动保存 */
  onConfirmRestore: () => void;
  onCancelPreview: () => void;
  /** 布局整理预览期间：禁止保存 / 恢复快照（任何图编辑都会使布局预览失效） */
  disabled: boolean;
}

/** 创建时间（ISO UTC）按本地时区格式化，如 2026/09/21 10:30。 */
function formatSnapshotTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

const stanceText = (stance: GraphEdge['stance']) => (stance === 'support' ? '支持' : '反驳');

/** 用指定图中的节点标签描述一条连线，如「证据A 支持→ 观点B（60%）」。 */
function edgeLabel(edge: GraphEdge, labelById: Map<string, string>): string {
  return `${labelById.get(edge.source) ?? edge.source} ${stanceText(edge.stance)}→ ${
    labelById.get(edge.target) ?? edge.target
  }（${Math.round(edge.weight * 100)}%）`;
}

function nodeLabel(node: GraphNode): string {
  return `${node.label}（${node.kind === 'claim' ? '观点' : '证据'}）`;
}

/** 版本快照卡片：保存带名称的只读快照、按创建时间列出、预览与当前图的差异并整体恢复。 */
export function SnapshotCard({
  list,
  busy,
  status,
  name,
  onNameChange,
  onSave,
  onPreview,
  onDelete,
  preview,
  diff,
  currentGraph,
  onConfirmRestore,
  onCancelPreview,
  disabled
}: SnapshotCardProps) {
  const snapshotLabelById = new Map((preview?.graph.nodes ?? []).map((node) => [node.id, node.label] as const));
  const currentLabelById = new Map(currentGraph.nodes.map((node) => [node.id, node.label] as const));

  return (
    <section className="panel-card snapshot-card">
      <div className="sensitivity-heading">
        <h2>版本快照</h2>
        {preview && (
          <button type="button" className="sensitivity-close" onClick={onCancelPreview} title="关闭快照预览">
            ✕
          </button>
        )}
      </div>

      <div className="snapshot-save-row">
        <input
          value={name}
          maxLength={80}
          placeholder="快照名称，如：评审前版本"
          disabled={disabled || busy}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim() && !disabled && !busy) onSave();
          }}
        />
        <button
          type="button"
          className="primary snapshot-save"
          disabled={disabled || busy || !name.trim()}
          onClick={onSave}
          title={disabled ? '布局预览期间不能保存快照：请先确认或取消布局整理' : '把当前画布整体保存为只读快照'}
        >
          💾 保存快照
        </button>
      </div>
      <p className="hint">
        把当前画布（含未落库的编辑）整体保存为只读快照；恢复时会整体替换当前图并自动保存，传播与各分析结果随之失效。
      </p>

      {list.length === 0 ? (
        <p className="hint">还没有快照。输入名称后点击「保存快照」创建第一个版本。</p>
      ) : (
        <ul className="snapshot-list">
          {list.map((item) => {
            const active = preview?.id === item.id;
            return (
              <li key={item.id} className="snapshot-row">
                <button
                  type="button"
                  className={`snapshot-item ${active ? 'active' : ''}`}
                  onClick={() => onPreview(item.id)}
                  title={active ? '再次点击取消预览' : '预览该快照与当前图的差异'}
                >
                  <span className="snapshot-item-name">{item.name}</span>
                  <small>
                    {formatSnapshotTime(item.createdAt)} · {item.nodeCount} 节点 · {item.edgeCount} 连线
                  </small>
                </button>
                <button
                  type="button"
                  className="snapshot-delete"
                  disabled={busy}
                  onClick={() => onDelete(item.id)}
                  title="删除该只读快照（不影响当前图）"
                >
                  删除
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {preview && diff && (
        <div className="snapshot-preview" role="region" aria-label="快照差异预览">
          <p className="snapshot-preview-title">
            正在预览「<strong>{preview.name}</strong>」：差异方向为 当前 → 快照，即恢复后画布将发生的变化。
          </p>

          {diff.identical ? (
            <p className="snapshot-identical">✓ 快照与当前图完全一致，恢复不会产生任何变化。</p>
          ) : (
            <>
              <dl className="decomp-summary">
                <dt>将恢复的节点</dt>
                <dd>{diff.nodesRestored.length}</dd>
                <dt>将移除的节点</dt>
                <dd>{diff.nodesRemoved.length}</dd>
                <dt>将改回的节点</dt>
                <dd>{diff.nodesChanged.length}</dd>
                <dt>将恢复的连线</dt>
                <dd>{diff.edgesRestored.length}</dd>
                <dt>将移除的连线</dt>
                <dd>{diff.edgesRemoved.length}</dd>
                <dt>将改回的连线</dt>
                <dd>{diff.edgesChanged.length}</dd>
              </dl>

              {diff.nameChanged && (
                <p className="snapshot-name-change">
                  图名称将改为「{preview.graph.name ?? preview.name}」。
                </p>
              )}

              {diff.nodesRestored.length > 0 && (
                <div className="snapshot-diff-group">
                  <h4>将恢复的节点（{diff.nodesRestored.length}）</h4>
                  <ul>
                    {diff.nodesRestored.map((node) => (
                      <li key={node.id} className="decomp-pos">
                        ＋ {nodeLabel(node)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.nodesRemoved.length > 0 && (
                <div className="snapshot-diff-group">
                  <h4>将移除的节点（{diff.nodesRemoved.length}）</h4>
                  <ul>
                    {diff.nodesRemoved.map((node) => (
                      <li key={node.id} className="decomp-neg">
                        － {nodeLabel(node)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.nodesChanged.length > 0 && (
                <div className="snapshot-diff-group">
                  <h4>将改回的节点（{diff.nodesChanged.length}）</h4>
                  <ul>
                    {diff.nodesChanged.map((item) => (
                      <li key={item.snapshot.id}>
                        {item.snapshot.label}
                        <small>{item.changes.join('、')}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.edgesRestored.length > 0 && (
                <div className="snapshot-diff-group">
                  <h4>将恢复的连线（{diff.edgesRestored.length}）</h4>
                  <ul>
                    {diff.edgesRestored.map((edge) => (
                      <li key={edge.id} className="decomp-pos">
                        ＋ {edgeLabel(edge, snapshotLabelById)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.edgesRemoved.length > 0 && (
                <div className="snapshot-diff-group">
                  <h4>将移除的连线（{diff.edgesRemoved.length}）</h4>
                  <ul>
                    {diff.edgesRemoved.map((edge) => (
                      <li key={edge.id} className="decomp-neg">
                        － {edgeLabel(edge, currentLabelById)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {diff.edgesChanged.length > 0 && (
                <div className="snapshot-diff-group">
                  <h4>将改回的连线（{diff.edgesChanged.length}）</h4>
                  <ul>
                    {diff.edgesChanged.map((item) => (
                      <li key={item.snapshot.id}>
                        {edgeLabel(item.snapshot, snapshotLabelById)}
                        <small>{item.changes.join('、')}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="snapshot-preview-actions">
            <button
              type="button"
              className="primary"
              disabled={disabled || busy}
              onClick={onConfirmRestore}
              title={disabled ? '布局预览期间不能恢复快照：请先确认或取消布局整理' : '用该快照整体替换当前图并自动保存'}
            >
              ✓ 确认恢复快照
            </button>
            <button type="button" onClick={onCancelPreview}>
              ✕ 取消预览
            </button>
          </div>
          <p className="hint">
            恢复为整体替换：当前画布内容被快照完全覆盖，并沿用现有自动保存写入 SQLite；传播回放与所有分析结果立即失效，需重新运行。
          </p>
        </div>
      )}

      {status && <p className="sensitivity-status">{status}</p>}
    </section>
  );
}
