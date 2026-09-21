import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Groups as GroupsIcon,
} from '@mui/icons-material'
import api from '../../api'
import toast from 'react-hot-toast'

// ─── helpers ──────────────────────────────────────────────────────────────────

function normalizeParties(res) {
  const payload = res?.data?.data ?? res?.data ?? {}
  const rows = Array.isArray(payload?.parties) ? payload.parties : []
  return rows.filter((p) => String(p?.name || '').trim())
}

function partyFromResponse(res) {
  return res?.data?.data ?? res?.data ?? {}
}

function getInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// A palette of soft background colours cycled by first char
const AVATAR_COLORS = [
  'bg-amber-100 text-amber-800',
  'bg-indigo-100 text-indigo-800',
  'bg-emerald-100 text-emerald-800',
  'bg-rose-100 text-rose-800',
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-teal-100 text-teal-800',
  'bg-orange-100 text-orange-800',
]

function avatarColor(name) {
  const code = String(name || 'A').charCodeAt(0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}

// ─── component ────────────────────────────────────────────────────────────────

export default function ExpensePartyField({ value, onChange, inputClassName = '' }) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dropdownResults, setDropdownResults] = useState([])
  const [dropdownLoading, setDropdownLoading] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [parties, setParties] = useState([])
  const [modalLoading, setModalLoading] = useState(false)
  const [modalSearch, setModalSearch] = useState('')

  // form states: null | 'add' | 'edit'
  const [formMode, setFormMode] = useState(null)
  const [formParty, setFormParty] = useState(null)
  const [formName, setFormName] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [saving, setSaving] = useState(false)

  // inline delete confirmation
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const wrapRef = useRef(null)
  const dropdownDebounceRef = useRef(null)
  const modalDebounceRef = useRef(null)
  const formNameRef = useRef(null)

  // ── load parties list ──────────────────────────────────────────────────────

  const loadParties = useCallback(async (searchTerm = '') => {
    setModalLoading(true)
    try {
      const params = new URLSearchParams({ limit: '200' })
      const term = String(searchTerm || '').trim()
      if (term) params.set('search', term)
      const { data } = await api.get(`/expenses/parties/?${params}`)
      setParties(normalizeParties(data))
    } catch {
      setParties([])
      toast.error('Failed to load parties')
    } finally {
      setModalLoading(false)
    }
  }, [])

  // ── click-outside closes dropdown ─────────────────────────────────────────

  useEffect(() => {
    function onMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // ── dropdown search ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!dropdownOpen) return undefined
    clearTimeout(dropdownDebounceRef.current)
    dropdownDebounceRef.current = setTimeout(async () => {
      setDropdownLoading(true)
      try {
        const term = String(value || '').trim()
        const params = new URLSearchParams({ limit: '20' })
        if (term.length >= 1) params.set('search', term)
        const { data } = await api.get(`/expenses/parties/?${params}`)
        setDropdownResults(normalizeParties(data))
      } catch {
        setDropdownResults([])
      } finally {
        setDropdownLoading(false)
      }
    }, 260)
    return () => clearTimeout(dropdownDebounceRef.current)
  }, [dropdownOpen, value])

  // ── modal search ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!showModal) return undefined
    clearTimeout(modalDebounceRef.current)
    modalDebounceRef.current = setTimeout(() => loadParties(modalSearch), 280)
    return () => clearTimeout(modalDebounceRef.current)
  }, [showModal, modalSearch, loadParties])

  // ── focus form name when opening ──────────────────────────────────────────

  useEffect(() => {
    if (formMode && formNameRef.current) {
      setTimeout(() => formNameRef.current?.focus(), 50)
    }
  }, [formMode])

  // ── modal controls ────────────────────────────────────────────────────────

  function openModal({ mode = null, party = null, prefillName = '' } = {}) {
    setModalSearch('')
    setFormMode(mode)
    setFormParty(party)
    setFormName(prefillName || party?.name || '')
    setFormPhone(party?.phone || '')
    setDeleteTarget(null)
    setShowModal(true)
    setDropdownOpen(false)
  }

  function closeModal() {
    if (saving || deleting) return
    setShowModal(false)
    setFormMode(null)
    setFormParty(null)
    setFormName('')
    setFormPhone('')
    setModalSearch('')
    setDeleteTarget(null)
  }

  function openAdd(prefillName = '') {
    setFormMode('add')
    setFormParty(null)
    setFormName(prefillName)
    setFormPhone('')
    setDeleteTarget(null)
  }

  function openEdit(party) {
    setFormMode('edit')
    setFormParty(party)
    setFormName(party.name)
    setFormPhone(party.phone || '')
    setDeleteTarget(null)
  }

  function cancelForm() {
    setFormMode(null)
    setFormParty(null)
    setFormName('')
    setFormPhone('')
  }

  // ── save party ────────────────────────────────────────────────────────────

  async function saveParty() {
    const name = String(formName || '').trim()
    if (!name) {
      toast.error('Party name is required')
      formNameRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      if (formMode === 'edit' && formParty?.id) {
        const oldName = formParty.name
        const { data } = await api.patch(`/expenses/parties/${formParty.id}/`, {
          name,
          phone: formPhone.trim(),
        })
        const row = partyFromResponse(data)
        toast.success('Party updated')
        if (String(value || '').trim() === String(oldName || '').trim()) {
          onChange(row.name || name)
        }
        cancelForm()
        await loadParties(modalSearch)
      } else {
        const { data } = await api.post('/expenses/parties/', {
          name,
          phone: formPhone.trim(),
        })
        const row = partyFromResponse(data)
        onChange(row.name || name)
        toast.success(row.created === false ? 'Party already exists — selected' : 'Party saved')
        closeModal()
      }
    } catch (err) {
      const errors = err?.response?.data?.errors
      toast.error(errors?.name?.[0] || err?.response?.data?.detail || 'Failed to save party')
    } finally {
      setSaving(false)
    }
  }

  // ── delete party ──────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!deleteTarget?.id) return
    setDeleting(true)
    try {
      await api.delete(`/expenses/parties/${deleteTarget.id}/`)
      toast.success('Party removed')
      if (String(value || '').trim() === String(deleteTarget.name || '').trim()) {
        onChange('')
      }
      if (formParty?.id === deleteTarget.id) cancelForm()
      setDeleteTarget(null)
      await loadParties(modalSearch)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to remove party')
    } finally {
      setDeleting(false)
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  const typedName = String(value || '').trim()

  return (
    <div ref={wrapRef} className="relative">
      {/* ── Paid-to input + Parties button ── */}
      <div className="flex items-stretch gap-2">
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setDropdownOpen(true) }}
          onFocus={() => setDropdownOpen(true)}
          placeholder="Vendor / party name (required)"
          className={`flex-1 min-w-0 ${inputClassName}`}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => openModal()}
          title="Manage parties"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-xs font-bold hover:bg-amber-100 active:scale-95 transition-all whitespace-nowrap"
        >
          <GroupsIcon sx={{ fontSize: 16 }} />
          Parties
        </button>
      </div>

      {/* ── Typeahead dropdown ── */}
      {dropdownOpen && !showModal && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {dropdownLoading && (
            <div className="px-4 py-3 text-xs text-gray-400 flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              Searching…
            </div>
          )}
          {!dropdownLoading && dropdownResults.length === 0 && !typedName && (
            <div className="px-4 py-3 text-xs text-gray-500">
              No saved parties yet. Type a name or click <span className="font-bold text-amber-700">Parties</span>.
            </div>
          )}
          {!dropdownLoading && dropdownResults.map((party) => (
            <button
              key={party.id}
              type="button"
              className="w-full text-left px-3 py-2.5 hover:bg-amber-50 flex items-center gap-3 border-b border-gray-50 last:border-0 transition-colors group"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(party.name); setDropdownOpen(false) }}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-black shrink-0 ${avatarColor(party.name)}`}>
                {getInitials(party.name)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate group-hover:text-amber-800">{party.name}</p>
                {party.phone ? <p className="text-[11px] text-gray-400">{party.phone}</p> : null}
              </div>
            </button>
          ))}
          {typedName && (
            <div className="border-t border-amber-100 bg-amber-50/60">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => openModal({ mode: 'add', prefillName: typedName })}
                className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-amber-100/60 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-600 text-white flex items-center justify-center text-lg font-black shrink-0">
                  +
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-amber-700 uppercase tracking-tight">Save as party</p>
                  <p className="text-[11px] text-amber-600/80 font-medium truncate">"{typedName}"</p>
                </div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Parties modal ── */}
      {showModal && createPortal(
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[500] flex items-center justify-center p-4"
          onClick={closeModal}
          role="presentation"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[88vh]"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Parties"
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-amber-600 to-amber-500 px-5 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                  <GroupsIcon sx={{ fontSize: 20, color: '#fff' }} />
                </div>
                <div>
                  <h3 className="font-black text-white text-base leading-tight">Parties</h3>
                  <p className="text-amber-100 text-[11px] font-medium">Vendors &amp; recurring payees</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-white/70 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search bar */}
            <div className="px-4 py-3 border-b border-gray-100 shrink-0 flex items-center gap-2">
              <div className="flex-1 relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 111 11a6 6 0 0116 0z" />
                </svg>
                <input
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.target.value)}
                  placeholder="Search parties…"
                  autoFocus={!formMode}
                  className="w-full border border-gray-200 rounded-xl pl-9 pr-3 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none bg-gray-50"
                />
              </div>
              {formMode !== 'add' && (
                <button
                  type="button"
                  onClick={() => openAdd()}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 active:scale-95 transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Party
                </button>
              )}
            </div>

            {/* Add / Edit form */}
            {(formMode === 'add' || formMode === 'edit') && (
              <div className="px-4 py-4 border-b border-amber-100 bg-amber-50/50 shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-black text-amber-800 uppercase tracking-widest">
                    {formMode === 'edit' ? '✏ Edit Party' : '＋ New Party'}
                  </p>
                  <button type="button" onClick={cancelForm} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
                </div>
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Party name *</label>
                    <input
                      ref={formNameRef}
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveParty() } }}
                      placeholder="e.g. Sharma Stationery"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Phone (optional)</label>
                    <input
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveParty() } }}
                      placeholder="Contact number"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 focus:ring-2 focus:ring-amber-100 outline-none"
                    />
                  </div>
                  <div className="flex gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={saveParty}
                      className="flex-1 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 disabled:opacity-60 flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                    >
                      {saving
                        ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
                        : formMode === 'edit' ? 'Save Changes' : 'Save Party'}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={cancelForm}
                      className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Delete confirmation */}
            {deleteTarget && (
              <div className="px-4 py-3 bg-red-50 border-b border-red-100 shrink-0">
                <p className="text-sm text-red-800 font-semibold mb-2">
                  Remove <span className="font-black">"{deleteTarget.name}"</span>? This can't be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={confirmDelete}
                    className="flex-1 py-1.5 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-60 flex items-center justify-center gap-1.5"
                  >
                    {deleting
                      ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Removing…</>
                      : 'Yes, Remove'}
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => setDeleteTarget(null)}
                    className="px-4 py-1.5 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-white disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Parties list */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {modalLoading && (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <span className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-gray-400">Loading parties…</p>
                </div>
              )}
              {!modalLoading && parties.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 gap-3 text-center px-6">
                  <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center">
                    <GroupsIcon sx={{ fontSize: 28, color: '#d97706' }} />
                  </div>
                  <p className="text-sm font-bold text-gray-700">No parties yet</p>
                  <p className="text-xs text-gray-400">Add vendors, pharmacies, or anyone you pay regularly.</p>
                  <button
                    type="button"
                    onClick={() => openAdd()}
                    className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold hover:bg-amber-700"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    Add First Party
                  </button>
                </div>
              )}
              {!modalLoading && parties.map((party) => {
                const isEditTarget = formParty?.id === party.id && formMode === 'edit'
                const isDeleteTarget = deleteTarget?.id === party.id
                return (
                  <div
                    key={party.id}
                    className={`flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0 transition-colors ${
                      isEditTarget ? 'bg-amber-50/60' : isDeleteTarget ? 'bg-red-50/60' : 'hover:bg-gray-50/70'
                    }`}
                  >
                    {/* Avatar */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black shrink-0 ${avatarColor(party.name)}`}>
                      {getInitials(party.name)}
                    </div>

                    {/* Name + phone — click to select */}
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left group"
                      onClick={() => { onChange(party.name); closeModal() }}
                    >
                      <p className="text-sm font-bold text-gray-900 truncate group-hover:text-amber-700 transition-colors">
                        {party.name}
                      </p>
                      {party.phone
                        ? <p className="text-[11px] text-gray-400 font-medium mt-0.5">{party.phone}</p>
                        : <p className="text-[11px] text-gray-300 italic mt-0.5">No phone</p>
                      }
                    </button>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => { setDeleteTarget(null); openEdit(party) }}
                        className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-colors ${
                          isEditTarget
                            ? 'border-amber-400 bg-amber-100 text-amber-700'
                            : 'border-gray-200 text-gray-400 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        title="Remove"
                        disabled={deleting}
                        onClick={() => { cancelForm(); setDeleteTarget(isDeleteTarget ? null : party) }}
                        className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-40 ${
                          isDeleteTarget
                            ? 'border-red-400 bg-red-100 text-red-600'
                            : 'border-gray-200 text-gray-400 hover:border-red-300 hover:bg-red-50 hover:text-red-500'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Footer */}
            {!modalLoading && parties.length > 0 && (
              <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50 shrink-0 flex items-center justify-between">
                <p className="text-[11px] text-gray-400 font-medium">
                  {parties.length} {parties.length === 1 ? 'party' : 'parties'} total · click a name to select
                </p>
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
