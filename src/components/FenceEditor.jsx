import { useState } from 'react'
import {
  FENCE_SHAPE,
  FENCE_RADIUS_OPTIONS,
  FENCE_MIN_RADIUS,
  FENCE_MAX_RADIUS,
  FENCE_MIN_VERTICES,
  FENCE_MAX_VERTICES,
  formatRadius,
  fenceSummary,
} from '../lib/fence'

/**
 * 围栏编辑器
 *
 * 创建聊天室 = 创建地理围栏。这个面板负责名称与围栏形状，
 * 实际的绘制交互发生在地图上（HomePage 持有 draft 状态）。
 *
 * 两种围栏：
 *   circle  —— 档位选择半径，也可拖动地图上的手柄自由调整
 *   polygon —— 在地图上逐点点击，至少 3 个顶点
 */
export default function FenceEditor({ draft, onChange, onSubmit, onClose, loading }) {
  const [name, setName] = useState('')

  const vertexCount = (draft?.polygon || []).filter(
    (p, i, arr) => i === 0 || p[0] !== arr[0][0] || p[1] !== arr[0][1]
  ).length
  const isPolygon = draft?.shape === FENCE_SHAPE.POLYGON

  // 多边形至少需要 3 个顶点才能构成闭合区域
  const canSubmit =
    name.trim().length > 0 &&
    !loading &&
    (isPolygon ? vertexCount >= FENCE_MIN_VERTICES : true)

  const handleShapeChange = (shape) => {
    if (shape === draft?.shape) return
    onChange({ ...draft, shape, polygon: shape === FENCE_SHAPE.POLYGON ? [] : null })
  }

  const handleRadiusPick = (value) => {
    onChange({ ...draft, radius: value })
  }

  const undoVertex = () => {
    const next = (draft?.polygon || []).slice(0, -1)
    onChange({ ...draft, polygon: next })
  }

  const clearVertices = () => {
    onChange({ ...draft, polygon: [] })
  }

  const hint = isPolygon
    ? vertexCount === 0
      ? '在地图上点击添加第一个顶点'
      : vertexCount < FENCE_MIN_VERTICES
        ? `已选 ${vertexCount} 点，还需 ${FENCE_MIN_VERTICES - vertexCount} 点才能闭合`
        : `已选 ${vertexCount} 点，可继续添加（上限 ${FENCE_MAX_VERTICES}）`
    : '选一个半径档位，或拖动地图上的圆点自由调整'

  return (
    <div className="fence-editor">
      <div className="fence-editor-head">
        <h3>🎯 创建聊天室</h3>
        <button className="fence-editor-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>

      <input
        className="fence-editor-input"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="聊天室名称"
        maxLength={30}
        autoFocus
      />

      <div className="fence-section">
        <span className="fence-label">围栏形状</span>
        <div className="fence-shape-toggle">
          <button
            className={`fence-shape-btn${!isPolygon ? ' active' : ''}`}
            onClick={() => handleShapeChange(FENCE_SHAPE.CIRCLE)}
          >
            圆形
          </button>
          <button
            className={`fence-shape-btn${isPolygon ? ' active' : ''}`}
            onClick={() => handleShapeChange(FENCE_SHAPE.POLYGON)}
          >
            手绘区域
          </button>
        </div>
      </div>

      {!isPolygon ? (
        <div className="fence-section">
          <span className="fence-label">
            半径
            <em className="fence-value">{formatRadius(draft?.radius)}</em>
          </span>
          <div className="fence-radius-chips">
            {FENCE_RADIUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`fence-chip${draft?.radius === opt.value ? ' active' : ''}`}
                onClick={() => handleRadiusPick(opt.value)}
                title={opt.desc}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            className="fence-slider"
            type="range"
            min={FENCE_MIN_RADIUS}
            max={FENCE_MAX_RADIUS}
            step={50}
            value={draft?.radius ?? 300}
            onChange={(e) => handleRadiusPick(Number(e.target.value))}
            aria-label="围栏半径"
          />
        </div>
      ) : (
        <div className="fence-section">
          <span className="fence-label">
            顶点
            <em className="fence-value">{vertexCount} / {FENCE_MAX_VERTICES}</em>
          </span>
          <div className="fence-vertex-actions">
            <button onClick={undoVertex} disabled={vertexCount === 0}>
              撤销上一点
            </button>
            <button onClick={clearVertices} disabled={vertexCount === 0}>
              清空
            </button>
          </div>
        </div>
      )}

      <p className="fence-hint">{hint}</p>

      <div className="fence-editor-foot">
        <span className="fence-summary">{fenceSummary(draft)}</span>
        <div className="fence-editor-actions">
          <button className="fence-btn ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="fence-btn primary"
            disabled={!canSubmit}
            onClick={() => onSubmit({ name: name.trim(), fence: draft })}
          >
            {loading ? '创建中...' : '创建并加入'}
          </button>
        </div>
      </div>
    </div>
  )
}
