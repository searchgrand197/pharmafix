import { format } from 'date-fns'

export const MODE_CHART_COLORS = {
  cash: '#10b981',
  upi: '#3b82f6',
  card: '#8b5cf6',
  other: '#9ca3af',
}

export function buildDailyAmountSeries(items, getDateKey, getAmount) {
  const map = new Map()
  for (const item of items) {
    const raw = getDateKey(item)
    if (!raw) continue
    const d = format(new Date(raw), 'yyyy-MM-dd')
    map.set(d, (map.get(d) || 0) + (Number(getAmount(item)) || 0))
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, amount]) => ({
      label: format(new Date(`${date}T12:00:00`), 'd MMM'),
      amount,
      date,
    }))
}

export function modeTotalsFromItems(items, getMode, getAmount) {
  const totals = { cash: 0, upi: 0, card: 0, other: 0 }
  for (const item of items) {
    const amt = Number(getAmount(item)) || 0
    const m = String(getMode(item) || 'other').toLowerCase()
    if (m === 'cash') totals.cash += amt
    else if (m === 'upi') totals.upi += amt
    else if (m === 'card') totals.card += amt
    else totals.other += amt
  }
  return totals
}

export function buildModeChartData(modeTotals) {
  return [
    { name: 'Cash', value: modeTotals.cash, color: MODE_CHART_COLORS.cash },
    { name: 'UPI', value: modeTotals.upi, color: MODE_CHART_COLORS.upi },
    { name: 'Card', value: modeTotals.card, color: MODE_CHART_COLORS.card },
    { name: 'Other', value: modeTotals.other, color: MODE_CHART_COLORS.other },
  ].filter((d) => d.value > 0)
}

export function buildAmountByField(items, getField, getAmount, limit = 8) {
  const map = new Map()
  for (const item of items) {
    const k = String(getField(item) || 'Other')
    map.set(k, (map.get(k) || 0) + (Number(getAmount(item)) || 0))
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, amount]) => ({
      name: name.length > 22 ? `${name.slice(0, 20)}…` : name,
      amount,
    }))
}

export function buildCountByField(items, getField, limit = 8) {
  const map = new Map()
  for (const item of items) {
    const k = String(getField(item) || 'Other')
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({
      name: name.length > 22 ? `${name.slice(0, 20)}…` : name,
      count,
    }))
}

export function printBarChartHtml(title, rows, { valueKey = 'amount', escapeHtml, fmtMoney }) {
  if (!rows.length) {
    return `<h3 class="chart-title">${escapeHtml(title)}</h3><p class="chart-empty">No data</p>`
  }
  const max = Math.max(...rows.map((r) => Number(r[valueKey] ?? r.amount ?? 0) || 0), 1)
  const bars = rows.map((r) => {
    const val = Number(r[valueKey] ?? r.amount ?? 0) || 0
    const pct = Math.round((val / max) * 100)
    const display = valueKey === 'count'
      ? String(r.count ?? 0)
      : `₹${fmtMoney(val)}`
    const label = escapeHtml(r.name || r.label || '—')
    return `<div class="pbar-row">
      <div class="pbar-lbl">${label}</div>
      <div class="pbar-track"><div class="pbar-fill" style="width:${pct}%"></div></div>
      <div class="pbar-val">${display}</div>
    </div>`
  }).join('')
  return `<h3 class="chart-title">${escapeHtml(title)}</h3><div class="pbar-chart">${bars}</div>`
}
