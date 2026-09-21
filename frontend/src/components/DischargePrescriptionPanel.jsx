import React, { useEffect, useRef, useState } from 'react'
import { Search, Pill, Plus, CheckCircle, Trash2, Loader2 } from 'lucide-react'
import api from '../api'
import { useDebouncedValue } from '../pharmacy/useDebouncedValue'
import {
  DEFAULT_RX_DAYS,
  DEFAULT_DOSAGE_PATTERNS,
  DEFAULT_TIMING_OPTIONS,
  calculateRxQty,
  pickDefaultPharmacyBranchId,
} from '../pharmacy/rxConstants'

function newKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `rx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Same UX as Doctor Portal InlineRxPanel: pharmacy branch search + dosage pattern × days = qty + food timing.
 * Adds "medicine not in pharmacy" manual rows (doctor can prescribe outside formulary).
 */
export default function DischargePrescriptionPanel({
  items = [],
  onChange,
  dosagePatternOptions = DEFAULT_DOSAGE_PATTERNS,
  timingOptions = DEFAULT_TIMING_OPTIONS,
  defaultDayOptions = DEFAULT_RX_DAYS,
}) {
  const [open, setOpen] = useState(true)
  const [branches, setBranches] = useState([])
  const [branchId, setBranchId] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [globalDays, setGlobalDays] = useState(7)
  const searchRef = useRef(null)
  const debouncedQ = useDebouncedValue(search, 320)

  useEffect(() => {
    if (!open || branches.length) return
    api.get('/auth/pharmacies/')
      .then(r => {
        const list = r.data?.data || r.data?.results || []
        setBranches(list)
        if (list.length) setBranchId(pickDefaultPharmacyBranchId(list))
      })
      .catch(() => {})
  }, [open, branches.length])

  useEffect(() => {
    if (!branchId || debouncedQ.length < 1) {
      setResults([])
      return
    }
    setSearching(true)
    api.get('/pharmacy/doctor-stock-search/', { params: { pharmacy_id: branchId, q: debouncedQ } })
      .then(r => {
        const list = Array.isArray(r.data?.data || r.data) ? (r.data?.data || r.data) : []
        const q = String(debouncedQ || '').trim().toLowerCase()
        const ranked = [...list].sort((a, b) => {
          const rank = (row) => {
            const n = String(row?.medicine?.name || '').trim().toLowerCase()
            const s = String(row?.medicine?.sku || '').trim().toLowerCase()
            if (n === q || s === q) return 0
            if (n.startsWith(q)) return 1
            if (s.startsWith(q)) return 2
            if (n.includes(q)) return 3
            return 4
          }
          return rank(a) - rank(b)
        })
        setResults(ranked)
      })
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }, [debouncedQ, branchId])

  const calcQty = (pattern, days) => calculateRxQty(pattern, days, dosagePatternOptions)

  const handleGlobalDaysChange = (d) => {
    setGlobalDays(d)
    const next = (items || []).map((it) => ({
      ...it,
      days: d,
      qty: calcQty(it.pattern || dosagePatternOptions[0]?.v || '1-0-1', d),
    }))
    onChange(next)
  }

  const addStock = (pick) => {
    if ((items || []).some((i) => i.source === 'stock' && String(i.batch?.id) === String(pick.batch?.id))) {
      return
    }
    const defaultPattern = dosagePatternOptions[0]?.v || '1-0-1'
    const defaultTiming = timingOptions[0]?.v || 'AF'
    const row = {
      key: newKey(),
      source: 'stock',
      branchId,
      medicine: pick.medicine,
      batch: pick.batch,
      pattern: defaultPattern,
      days: globalDays,
      qty: calcQty(defaultPattern, globalDays),
      timing: defaultTiming,
    }
    onChange([...(items || []), row])
    setSearch('')
    setResults([])
    searchRef.current?.focus()
  }

  const addManual = () => {
    const defaultPattern = dosagePatternOptions[0]?.v || '1-0-1'
    const defaultTiming = timingOptions[0]?.v || 'AF'
    onChange([...(items || []), {
      key: newKey(),
      source: 'manual',
      manualName: '',
      pattern: defaultPattern,
      days: globalDays,
      qty: calcQty(defaultPattern, globalDays),
      timing: defaultTiming,
    }])
  }

  const upd = (idx, field, val) => {
    onChange((items || []).map((it, i) => {
      if (i !== idx) return it
      const updated = { ...it, [field]: val }
      if (field === 'pattern' || field === 'days') {
        updated.qty = calcQty(updated.pattern || dosagePatternOptions[0]?.v || '1-0-1', updated.days ?? globalDays)
      }
      return updated
    }))
  }

  const rem = (idx) => {
    onChange((items || []).filter((_, i) => i !== idx))
  }

  return (
    <div className="border border-emerald-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
          open ? 'bg-emerald-600 text-white' : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
        }`}>
        <Pill size={14} />
        <span className="text-xs font-bold flex-1">Discharge medication (same as doctor prescription)</span>
        {(items || []).length > 0 && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            open ? 'bg-white/20 text-white' : 'bg-emerald-200 text-emerald-800'
          }`}>{(items || []).length} medicine(s)</span>
        )}
        <span className="text-[10px] opacity-70">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-white border-t border-emerald-100">
          {branches.length >= 1 && (
            <div className="px-3 py-1.5 border-b border-slate-100 flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Pharmacy branch:</span>
              <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setResults([]) }}
                className="text-[11px] border border-slate-200 rounded px-2 py-0.5 outline-none flex-1">
                {branches.map(b => <option key={b.id} value={b.id}>{b.label || b.name}</option>)}
              </select>
            </div>
          )}

          <div className="px-3 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Default days:</span>
              <div className="flex flex-wrap gap-1">
                {defaultDayOptions.map(d => (
                  <button key={d} type="button" onClick={() => handleGlobalDaysChange(d)}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all border ${globalDays === d ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-3 pt-2 pb-1 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search pharmacy stock..."
                className="w-full h-8 pl-8 pr-3 text-[12px] border border-slate-200 rounded-lg outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30" />
              {searching && <Loader2 size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-500 animate-spin" />}
            </div>
            <button type="button" onClick={addManual}
              className="shrink-0 px-3 h-8 rounded-lg text-[11px] font-black bg-amber-50 border border-amber-200 text-amber-900 hover:bg-amber-100 whitespace-nowrap">
              + Not in pharmacy (manual)
            </button>
          </div>

          {results.length > 0 && (
            <div className="mx-3 mb-2 border border-slate-200 rounded-lg overflow-hidden max-h-40 overflow-y-auto">
              {results.slice(0, 8).map((pick, i) => {
                const added = (items || []).some(it => it.source === 'stock' && String(it.batch?.id) === String(pick.batch?.id))
                return (
                  <button key={i} type="button" onClick={() => !added && addStock(pick)} disabled={added}
                    className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors border-b border-slate-100 last:border-0 ${
                      added ? 'opacity-40 cursor-default bg-slate-50' : 'hover:bg-emerald-50'
                    }`}>
                    <Pill size={11} className="text-emerald-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-bold text-slate-900 truncate">
                        {pick.medicine.name}
                        {pick.medicine.sku ? <span className="ml-1 text-[9px] font-semibold text-slate-500">({pick.medicine.sku})</span> : null}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {pick.batch.batch_no} · Stock: <span className="font-bold text-emerald-700">{pick.batch.stock}</span>
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-emerald-700 shrink-0">₹{Number(pick.batch.sale_rate).toFixed(0)}</span>
                    {added ? <CheckCircle size={11} className="text-emerald-400" /> : <Plus size={11} className="text-emerald-500" />}
                  </button>
                )
              })}
            </div>
          )}

          {!searching && search.trim().length >= 1 && results.length === 0 && branchId && (
            <p className="mx-3 mb-2 text-[10px] text-slate-500 bg-slate-50 border border-slate-100 rounded-md px-2 py-1.5">
              No stock found for “{search.trim()}” in this pharmacy. Try another spelling or add it manually.
            </p>
          )}

          {(items || []).length > 0 && (
            <div className="px-3 pb-3 space-y-1.5 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Medicines ({(items || []).length})</span>
                <button type="button" onClick={() => onChange([])} className="text-[9px] text-rose-500 font-bold hover:underline">Clear all</button>
              </div>
              <div className="max-h-72 overflow-y-auto pr-1 space-y-1.5">
                {(items || []).map((item, idx) => (
                  <div key={item.key || idx} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 shadow-sm flex flex-wrap items-center gap-1.5 min-w-0">
                    {item.source === 'stock' ? (
                      <>
                        <Pill size={12} className="text-emerald-500 shrink-0" />
                        <p className="w-36 sm:w-40 text-[10px] font-bold text-slate-900 truncate" title={item.medicine?.name}>{item.medicine?.name}</p>
                      </>
                    ) : (
                      <>
                        <span className="text-[9px] font-black text-amber-700 uppercase shrink-0">Manual</span>
                        <input value={item.manualName || ''} onChange={e => upd(idx, 'manualName', e.target.value)}
                          placeholder="Medicine name"
                          className="flex-1 min-w-[120px] h-6 text-[11px] font-bold border border-amber-200 rounded px-1.5 bg-amber-50/50 outline-none focus:border-amber-400" />
                      </>
                    )}
                    <select value={item.pattern} onChange={e => upd(idx, 'pattern', e.target.value)} title="Dosage pattern"
                      className="w-[58px] h-6 text-[9px] font-bold text-center border border-slate-200 rounded bg-white outline-none shrink-0">
                      {dosagePatternOptions.map(p => <option key={p.v} value={p.v}>{p.v}</option>)}
                    </select>
                    <span className="text-[9px] text-slate-400 shrink-0">×</span>
                    <input type="number" min="1" value={item.days} onChange={e => upd(idx, 'days', e.target.value)} title="Days"
                      className="w-8 h-6 text-[10px] font-bold text-center border border-slate-200 rounded outline-none shrink-0" />
                    <span className="text-[9px] text-slate-400 shrink-0">=</span>
                    <input type="number" min="1" value={item.qty} onChange={e => upd(idx, 'qty', e.target.value)} title="Total qty"
                      className="w-9 h-6 text-[10px] font-bold text-center border border-emerald-200 rounded bg-emerald-50 text-emerald-800 outline-none shrink-0" />
                    <span className="text-[9px] text-emerald-600 font-semibold whitespace-nowrap shrink-0 hidden sm:inline">
                      Eq:{calcQty(item.pattern || dosagePatternOptions[0]?.v || '1-0-1', item.days)}
                    </span>
                    <select value={item.timing} onChange={e => upd(idx, 'timing', e.target.value)} title="Timing"
                      className="w-24 sm:w-28 h-6 text-[9px] font-bold border border-slate-200 rounded bg-white outline-none shrink-0">
                      {timingOptions.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                    <button type="button" onClick={() => rem(idx)} className="text-slate-300 hover:text-rose-500 shrink-0 ml-auto">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 bg-slate-50 border border-slate-100 rounded-md px-2 py-1 mt-2">
                Stock lines link to pharmacy batches. Manual lines are allowed when medicine is not listed — same controls as doctor OPD prescription.
              </p>
            </div>
          )}

          {!(items || []).length && search.length < 1 && (
            <div className="py-4 text-center text-slate-400 text-[11px]">
              <Pill size={22} className="mx-auto mb-1 opacity-30" />
              Search pharmacy or add a manual medicine.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
