import type { SnapshotRecord, SnapshotSummary } from '../../../shared/graph';
import { formatSnapshotTime, type SnapshotDiff, type SnapshotDiffChange, type SnapshotDiffItem } from '../snapshots';

export interface SnapshotCardProps {
  /** 全部快照摘要（按创建时间倒序，最新在前） */
  snapshots: SnapshotSummary[];
  /** 名称输入框当前值 */
  name: string;
  onNameChange: (value: string) => void;
  /** 是否有快照请求在进行中（保存 / 载入预览） */
  busy: boolean;
  /** 卡片内的操作反馈 */
  status: string;
  /** 正在预览的快照完整记录；null 表示未选中任何快照 */
  preview: SnapshotRecord | null;
  /** 预览快照与当前画布的差异（preview 为 null 时也为 null） */
  diff: SnapshotDiff | null;
  /** 布局整理预览期间：禁止保存 / 恢复快照（任何图编辑都会使预览失效） */
  graphEditingDisabled?: boolean;
  onSave: () => void;
  /** 点击列表项：载入并预览该快照；再次点击当前项取消预览 */
  onTogglePreview: (id: string) => void;
  onCancelPreview: () => void;
  /** 确认整体恢复：用快照图替换当前画布并沿用现有自动保存 */
  onRestore: () => void;
}

function DiffGroup({ title, items, className }: { title: string; items: SnapshotDiffItem[]; className: string }) {
  if (items.length === 0) return null;
  return (
    <div className="snapshot-diff-group">
      <span className={`snapshot-diff-title ${className}`}>{title}</span>
      <span className="snapshot-diff-chips">
        {items.map((item) => (
          <span key={item.id} className={`snapshot-chip ${className}`}>
            {item.label}
          </span>
        ))}
      </span>
    </div>
  );
}

function DiffChangeGroup({
  title,
  items,
  className
}: {
  title: string;
  items: SnapshotDiffChange[];
  className: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="snapshot-diff-group">
      <span className={`snapshot-diff-title ${className}`}>{title}</span>
      <ul className="snapshot-diff-change-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.label}</strong>
            <small>{item.changes.join('；')}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 版本快照卡片：保存当前图的命名只读快照，预览与当前画布差异后整体恢复。 */
export function SnapshotCard({
  snapshots,
  name,
  onNameChange,
  busy,
  status,
  preview,
  diff,
  graphEditingDisabled = false,
  onSave,
  onTogglePreview,
  onCancelPreview,
  onRestore
}: SnapshotCardProps) {
  const nodeDelta = diff
    ? { added: diff.addedNodes.length, removed: diff.removedNodes.length, changed: diff.changedNodes.length }
    : null;
  const edgeDelta = diff
    ? { added: diff.addedEdges.length, removed: diff.removedEdges.length, changed: diff.changedEdges.length }
    : null;

  return (
    <section className="panel-card snapshot-card">
      <h2>版本快照</h2>

      <div className="snapshot-save-row">
        <input
          value={name}
          maxLength={80}
          placeholder="快照名称（留空自动命名）"
          disabled={graphEditingDisabled}
          onChange={(event) => onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !busy && !graphEditingDisabled) onSave();
          }}
        />
        <button
          type="button"
          className="primary"
          disabled={busy || graphEditingDisabled}
          onClick={onSave}
          title="把当前画布整体保存为只读快照"
        >
          {busy ? '处理中…' : '保存快照'}
        </button>
      </div>
      {graphEditingDisabled && (
        <p className="hint layout-disabled-hint">
          正在预览“一键整理布局”：请先<strong>确认应用</strong>或<strong>取消</strong>，再保存或恢复快照。
        </p>
      )}
      <p className="hint">
        快照为只读副本，随 SQLite 持久化；恢复会整体替换当前画布并自动保存，传播与各分析结果随之失效。
      </p>
      {status && <p className="sensitivity-status">{status}</p>}

      {snapshots.length === 0 ? (
        <p className="hint">还没有快照。调整画布后点击「保存快照」，即可随时回到这一版本。</p>
      ) : (
        <ol className="snapshot-list">
          {snapshots.map((snapshot) => {
            const active = preview?.id === snapshot.id;
            return (
              <li key={snapshot.id}>
                <button
                  type="button"
                  className={`snapshot-item ${active ? 'active' : ''}`}
                  disabled={busy}
                  onClick={() => onTogglePreview(snapshot.id)}
                  title={active ? '再次点击取消预览' : '点击预览该快照与当前画布的差异'}
                >
                  <span className="snapshot-item-head">
                    <strong className="snapshot-item-name">{snapshot.name}</strong>
                    <span className="snapshot-item-counts">
                      节点 {snapshot.nodeCount} · 连线 {snapshot.edgeCount}
                    </span>
                  </span>
                  <small className="snapshot-item-time">{formatSnapshotTime(snapshot.createdAt)}</small>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {preview && diff && (
        <div className="snapshot-preview">
          <dl className="decomp-summary">
            <dt>预览快照</dt>
            <dd>{preview.name}</dd>
            <dt>创建时间</dt>
            <dd>{formatSnapshotTime(preview.createdAt)}</dd>
            <dt>快照规模</dt>
            <dd>
              {preview.nodeCount} 节点 / {preview.edgeCount} 连线
            </dd>
          </dl>

          {diff.identical ? (
            <p className="snapshot-diff-identical">✓ 与当前画布完全一致，无需恢复。</p>
          ) : (
            <div className="snapshot-diff">
              <p className="snapshot-diff-summary">
                与当前画布的差异：节点
                {nodeDelta && ` +${nodeDelta.added} / −${nodeDelta.removed} / 改 ${nodeDelta.changed}`}，连线
                {edgeDelta && ` +${edgeDelta.added} / −${edgeDelta.removed} / 改 ${edgeDelta.changed}`}
              </p>
              <DiffGroup title="恢复后新增的节点" items={diff.addedNodes} className="added" />
              <DiffGroup title="恢复后移除的节点" items={diff.removedNodes} className="removed" />
              <DiffChangeGroup title="内容有变化的节点" items={diff.changedNodes} className="changed" />
              <DiffGroup title="恢复后新增的连线" items={diff.addedEdges} className="added" />
              <DiffGroup title="恢复后移除的连线" items={diff.removedEdges} className="removed" />
              <DiffChangeGroup title="内容有变化的连线" items={diff.changedEdges} className="changed" />
            </div>
          )}

          <div className="snapshot-preview-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || diff.identical || graphEditingDisabled}
              onClick={onRestore}
              title={diff.identical ? '快照与当前画布一致，无需恢复' : '用该快照整体替换当前画布并自动保存'}
            >
              确认恢复该快照
            </button>
            <button type="button" onClick={onCancelPreview}>
              取消预览
            </button>
          </div>
          <p className="hint">恢复后传播结果、回放与各分析卡片结果全部失效，需重新运行。</p>
        </div>
      )}
    </section>
  );
}
