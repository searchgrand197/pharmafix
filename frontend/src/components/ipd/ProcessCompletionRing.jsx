function ringColors(percent) {
  if (percent <= 25) {
    return { stroke: '#ef4444', track: '#fecaca', text: '#dc2626' }
  }
  if (percent < 50) {
    return { stroke: '#f97316', track: '#fed7aa', text: '#ea580c' }
  }
  return { stroke: '#10b981', track: '#a7f3d0', text: '#059669' }
}

export default function ProcessCompletionRing({ percent = 0, size = 44, strokeWidth = 4, className = '' }) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const colors = ringColors(clamped)
  const radius = (size - strokeWidth) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (clamped / 100) * circumference

  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
      title={`${clamped}% complete`}
      aria-label={`Process ${clamped}% complete`}
    >
      <svg width={size} height={size} className="block -rotate-90" aria-hidden>
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={colors.track}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-300 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span
          className="font-black leading-none tabular-nums"
          style={{ color: colors.text, fontSize: clamped >= 100 ? '9px' : '10px' }}
        >
          {clamped}
          <span className="text-[7px] align-top">%</span>
        </span>
      </div>
    </div>
  )
}
