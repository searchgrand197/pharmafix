import { useCallback, useRef, useState } from 'react'
import {
  COL_SPAN_OPTIONS,
  MAX_HEIGHT_PX,
  MIN_HEIGHT_PX,
  colSpanClass,
  snapColSpanFromWidthPx,
} from '../../utils/ipdProcessFieldConfig'

export default function ProcessFieldLayoutWrapper({
  field,
  resizeMode = 'form',
  selected = false,
  onLayoutChange,
  onFieldClick,
  stopSelectionPropagation = false,
  builderSelectable = false,
  children,
  className = '',
}) {
  const layout = field?.layout || { col_span: 12, min_height_px: 40 }
  const colSpan = layout.col_span || 12
  const minHeight = layout.min_height_px || 40
  const wrapperRef = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [tooltip, setTooltip] = useState('')

  const startResize = useCallback((edge, e) => {
    if (resizeMode !== 'builder' || !onLayoutChange) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startSpan = colSpan
    const startHeight = minHeight
    const container = wrapperRef.current?.parentElement
    const containerWidth = container?.getBoundingClientRect().width || 0
    const startWidth = wrapperRef.current?.getBoundingClientRect().width || 0
    let lastSpan = startSpan
    let lastHeight = startHeight

    setDragging(edge)

    function onUp() {
      setDragging(null)
      setTooltip('')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }

    function onMove(ev) {
      if (ev.buttons === 0) {
        onUp()
        return
      }
      if (edge === 'right') {
        const newWidth = Math.max(80, startWidth + (ev.clientX - startX))
        const newSpan = snapColSpanFromWidthPx(containerWidth, newWidth)
        if (newSpan === lastSpan && lastHeight === startHeight) return
        lastSpan = newSpan
        const pct = Math.round((newSpan / 12) * 100)
        setTooltip(`${pct}% width · ${lastHeight}px height`)
        onLayoutChange({ col_span: newSpan, min_height_px: lastHeight })
      } else {
        const newHeight = Math.max(MIN_HEIGHT_PX, Math.min(MAX_HEIGHT_PX, startHeight + (ev.clientY - startY)))
        const snapped = Math.round(newHeight / 8) * 8
        if (snapped === lastHeight && lastSpan === startSpan) return
        lastHeight = snapped
        const pct = Math.round((lastSpan / 12) * 100)
        setTooltip(`${pct}% width · ${snapped}px height`)
        onLayoutChange({ col_span: lastSpan, min_height_px: snapped })
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
  }, [colSpan, minHeight, onLayoutChange, resizeMode])

  const builderRing = resizeMode === 'builder' && selected
    ? 'ring-2 ring-violet-400 ring-offset-1'
    : resizeMode === 'builder'
      ? 'hover:ring-1 hover:ring-violet-200'
      : ''

  function handleWrapperClick(e) {
    if (!builderSelectable || !onFieldClick) return
    if (e.target.closest('[data-resize-handle]')) return
    if (stopSelectionPropagation) e.stopPropagation()
    onFieldClick(e)
  }

  return (
    <div
      ref={wrapperRef}
      role={builderSelectable ? 'button' : undefined}
      tabIndex={builderSelectable ? 0 : undefined}
      onClick={handleWrapperClick}
      onKeyDown={builderSelectable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onFieldClick?.(e)
        }
      } : undefined}
      className={`relative ${colSpanClass(colSpan)} ${builderRing} ${builderSelectable ? 'cursor-pointer' : ''} ${className}`}
      style={{ minHeight: `${minHeight}px` }}
    >
      {children}
      {resizeMode === 'builder' && selected && onLayoutChange && (
        <>
          <div
            role="presentation"
            data-resize-handle
            onMouseDown={(e) => startResize('right', e)}
            className={`absolute top-2 right-0 w-2 h-[calc(100%-16px)] cursor-ew-resize rounded-full ${
              dragging === 'right' ? 'bg-violet-500' : 'bg-violet-300/80 hover:bg-violet-500'
            }`}
            title="Drag to resize width"
          />
          <div
            role="presentation"
            data-resize-handle
            onMouseDown={(e) => startResize('bottom', e)}
            className={`absolute left-2 bottom-0 w-[calc(100%-16px)] h-2 cursor-ns-resize rounded-full ${
              dragging === 'bottom' ? 'bg-violet-500' : 'bg-violet-300/80 hover:bg-violet-500'
            }`}
            title="Drag to resize height"
          />
          {tooltip ? (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 z-10 text-[10px] font-bold bg-violet-700 text-white px-2 py-0.5 rounded-md whitespace-nowrap pointer-events-none">
              {tooltip}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

export function ProcessFieldGrid({ children, className = '' }) {
  return (
    <div className={`grid grid-cols-12 gap-3 ${className}`}>
      {children}
    </div>
  )
}

export { COL_SPAN_OPTIONS }
