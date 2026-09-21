import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Layout from '../components/Layout'
import api from '../api'
import toast from 'react-hot-toast'
import { formatDateTime, useTimeDisplayMode } from '../utils/dateTimeFormat'
import { format } from 'date-fns'
import {
  CheckCircle,
  CalendarMonth,
  Medication,
  Assignment,
  Add,
  Person,
  ExpandMore,
  ExpandLess,
  SkipNext,
} from '@mui/icons-material'
import { useAuthStore } from '../stores/authStore'

const TABS = [
  { id: 'tasks', label: 'My Tasks', icon: Medication },
  { id: 'leaves', label: 'Apply Leave', icon: CalendarMonth },
  { id: 'tp', label: 'Treatment Plan', icon: Assignment },
]


// ΓöÇΓöÇΓöÇ Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
const CAT_ICON = { medication:'≡ƒÆè', nursing:'≡ƒ⌐║', physiotherapy:'≡ƒÅâ', investigation:'≡ƒö¼', diet:'≡ƒÑù', other:'≡ƒôï' }
const STATUS_CLS = {
  pending:     'bg-amber-100 text-amber-700 border-amber-200',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
  done:        'bg-emerald-100 text-emerald-700 border-emerald-200',
  skipped:     'bg-slate-100 text-slate-500 border-slate-200',
}
function taskSortKey(t) {
  return `${t.date || '9999-99-99'}T${t.time_of_day || '23:59:59'}`
}

function taskDateTimeSortKey(task, fallbackTime = '00:00:00') {
  return `${task?.date || '0000-00-00'}T${task?.time_of_day || fallbackTime}`
}

function getTaskPatientName(task) {
  return (
    task?.patient_name ||
    task?.patient_full_name ||
    [task?.patient?.first_name, task?.patient?.last_name].filter(Boolean).join(' ') ||
    task?.patient?.name ||
    task?.patient?.full_name ||
    task?.visit_patient_name ||
    task?.ipd_patient_name ||
    'Unknown Patient'
  )
}

// ΓöÇΓöÇΓöÇ Single expandable task card ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function TaskCard({ task, onDone, onSkip }) {
  const [open, setOpen] = useState(false)
  const isPending = task.status === 'pending'
  const isDone    = task.status === 'done'
  const isSkipped = task.status === 'skipped'
  const rowBg = isDone ? 'bg-emerald-50/40 border-emerald-200' : isSkipped ? 'bg-slate-50/40 border-slate-200' : 'bg-white border-gray-100'
  const patientName = getTaskPatientName(task)

  return (
    <div className={`rounded-2xl border shadow-sm overflow-hidden transition-all ${rowBg}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full text-left px-4 py-3 flex items-center gap-3">
        <span className="text-2xl shrink-0">{CAT_ICON[task.item_category] || '≡ƒôï'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
              {task.date} {task.time_of_day ? task.time_of_day.slice(0,5) : ''}
            </span>
            <p className="font-semibold text-gray-800 text-sm truncate">{task.item_title}</p>
            {task.priority === 'stat' && (
              <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold border border-red-200">STAT</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <Person sx={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }} />
            <span className="text-xs text-gray-500 truncate">{patientName} ┬╖ Bed {task.bed_code || 'N/A'}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ml-auto shrink-0 ${STATUS_CLS[task.status] || ''}`}>
              {task.status}
            </span>
          </div>
        </div>
        {isPending && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDone(task)
            }}
            className="shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Mark Done
          </button>
        )}
        {open ? (
          <ExpandLess sx={{ fontSize: 16, color: '#9ca3af', flexShrink: 0 }} />
        ) : (
          <ExpandMore sx={{ fontSize: 16, color: '#9ca3af', flexShrink: 0 }} />
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-white">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600">
            <div><span className="font-semibold">Category:</span> {task.item_category}</div>
            <div><span className="font-semibold">Priority:</span> {task.priority}</div>
            <div><span className="font-semibold">Date:</span> {task.date}</div>
            <div><span className="font-semibold">Time:</span> {task.time_of_day || 'Any'}</div>
            <div><span className="font-semibold">Patient:</span> {patientName}</div>
            <div><span className="font-semibold">Bed:</span> {task.bed_code || 'N/A'}</div>
          </div>
          {task.notes_from_doctor && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-800">
              <span className="font-bold">Doctor note: </span>{task.notes_from_doctor}
            </div>
          )}
          {task.notes_from_staff && (
            <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-xs text-gray-700">
              <span className="font-bold">Staff note: </span>{task.notes_from_staff}
            </div>
          )}
          {isPending && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => { onDone(task); setOpen(false) }}
                className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 text-white text-xs py-2 rounded-xl font-bold hover:bg-emerald-700">
                <CheckCircle sx={{ fontSize: 14 }} /> Mark Done
              </button>
              <button onClick={() => { onSkip(task); setOpen(false) }}
                className="flex-1 flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 text-xs py-2 rounded-xl font-bold hover:bg-slate-200 border border-slate-200">
                <SkipNext sx={{ fontSize: 14 }} /> Skip
              </button>
            </div>
          )}
          {isDone && (
            <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
              <CheckCircle sx={{ fontSize: 14 }} /> Completed
              {task.completed_at && <span className="text-gray-400 font-normal ml-1">{formatDateTime(task.completed_at)}</span>}
            </div>
          )}
          {isSkipped && (
            <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold">
              <SkipNext sx={{ fontSize: 14 }} /> Skipped
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ΓöÇΓöÇΓöÇ My Tasks Tab ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function TasksTab() {
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState('pending')
  const [selectedCompletedPatient, setSelectedCompletedPatient] = useState('')
  const [pushState, setPushState] = useState('checking')
  const knownPendingTaskIdsRef = React.useRef(new Set())
  const notificationPermissionAskedRef = React.useRef(false)
  const initialLoadDoneRef = React.useRef(false)
  const alertCooldownRef = React.useRef(0)

  const requestNotificationPermissionOnce = useCallback(async () => {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'default') return
    if (notificationPermissionAskedRef.current) return
    notificationPermissionAskedRef.current = true
    try {
      await Notification.requestPermission()
    } catch {
      // Ignore permission request failures on unsupported browsers.
    }
  }, [])

  const refreshPushState = useCallback(async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setPushState('blocked')
      return
    }
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        setPushState('subscribed')
      } else if (Notification.permission === 'granted') {
        setPushState('ready')
      } else {
        setPushState('not_allowed')
      }
    } catch {
      setPushState('error')
    }
  }, [])

  const enablePushNow = useCallback(async () => {
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast.error('Push not supported on this browser')
        setPushState('unsupported')
        return
      }
      let permission = Notification.permission
      if (permission === 'default') permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushState('blocked')
        toast.error('Notification permission is required')
        return
      }
      const { data } = await api.get('/notifications/push/public-key/')
      const publicKey = data?.public_key
      if (!publicKey) {
        toast.error('Push key not configured on server')
        setPushState('error')
        return
      }
      const urlBase64ToUint8Array = (base64String) => {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
        const normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
        const rawData = atob(normalized)
        return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
      }
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }
      const payload = subscription.toJSON()
      await api.post('/notifications/push/subscribe/', {
        endpoint: payload.endpoint,
        p256dh_key: payload.keys?.p256dh,
        auth_key: payload.keys?.auth,
      })
      toast.success('Push alerts enabled on this device')
      setPushState('subscribed')
    } catch {
      toast.error('Could not enable push alerts')
      setPushState('error')
    }
  }, [])

  const playTaskRing = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const now = ctx.currentTime
      const sequence = [740, 988, 740, 988]
      sequence.forEach((freq, index) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, now)
        gain.gain.exponentialRampToValueAtTime(0.2, now + index * 0.22 + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.22 + 0.18)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(now + index * 0.22)
        osc.stop(now + index * 0.22 + 0.2)
      })
      window.setTimeout(() => {
        try { ctx.close() } catch {}
      }, 1600)
    } catch {
      // Audio playback may be blocked by browser policy.
    }
  }, [])

  const alertForNewTasks = useCallback((newPendingTasks) => {
    if (!newPendingTasks.length) return
    const now = Date.now()
    if (now - alertCooldownRef.current < 5000) return
    alertCooldownRef.current = now

    playTaskRing()
    toast.success(`${newPendingTasks.length} new task${newPendingTasks.length > 1 ? 's' : ''} assigned`)

    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    const firstTask = newPendingTasks[0]
    const patientName = getTaskPatientName(firstTask)
    const body = newPendingTasks.length === 1
      ? `${firstTask.item_title} - ${patientName}`
      : `${newPendingTasks.length} new tasks assigned. Latest: ${firstTask.item_title}`

    try {
      new Notification('New Staff Task', {
        body,
        icon: '/icons/icon-staff-192.png?v=4',
        badge: '/icons/icon-staff-192.png?v=4',
        tag: 'staff-task-alert',
        renotify: true,
      })
    } catch {
      // Ignore notification failures.
    }
  }, [playTaskRing])

  const fetchTasks = useCallback(async () => {
    if (!initialLoadDoneRef.current) setLoading(true)
    try {
      const { data } = await api.get('/treatment-tasks/?mine=true&ordering=date,time_of_day&limit=1000')
      const nextTasks = Array.isArray(data) ? data : (data.results || [])
      const nextPendingTasks = nextTasks.filter((task) => task.status === 'pending')
      const nextPendingIdSet = new Set(nextPendingTasks.map((task) => String(task.id)))

      if (initialLoadDoneRef.current) {
        const newPendingTasks = nextPendingTasks.filter(
          (task) => !knownPendingTaskIdsRef.current.has(String(task.id)),
        )
        alertForNewTasks(newPendingTasks)
      }

      knownPendingTaskIdsRef.current = nextPendingIdSet
      setTasks(nextTasks)
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true
        requestNotificationPermissionOnce()
      }
    } catch { toast.error('Failed to load tasks') }
    finally { setLoading(false) }
  }, [alertForNewTasks, requestNotificationPermissionOnce])

  useEffect(() => {
    fetchTasks()

    const pollId = window.setInterval(() => {
      fetchTasks()
    }, 10000)

    const onFocus = () => fetchTasks()
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchTasks()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    refreshPushState()
    return () => {
      window.clearInterval(pollId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchTasks, refreshPushState])

  async function markDone(task) {
    try {
      await api.post(`/treatment-tasks/${task.id}/complete/`, { notes: '' })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'done', completed_at: new Date().toISOString() } : t))
      toast.success('Task marked done!')
    } catch (e) { toast.error(e.response?.data?.detail || 'Error') }
  }

  async function skipTask(task) {
    try {
      await api.post(`/treatment-tasks/${task.id}/skip/`)
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: 'skipped' } : t))
      toast.success('Task skipped')
    } catch (e) { toast.error(e.response?.data?.detail || 'Error') }
  }

  const counts = useMemo(() => ({
    all:     tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    done:    tasks.filter(t => t.status === 'done').length,
    skipped: tasks.filter(t => t.status === 'skipped').length,
  }), [tasks])

  const visibleTasks = useMemo(() => {
    const filtered = section === 'all' ? tasks : tasks.filter(t => t.status === section)
    return [...filtered].sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)))
  }, [tasks, section])

  const completedPatients = useMemo(() => {
    const doneTasks = tasks.filter((t) => t.status === 'done')
    const bucket = new Map()
    doneTasks.forEach((task) => {
      const patientName = getTaskPatientName(task)
      const patientKey = `${task.ipd_admission || 'na'}::${patientName}`
      if (!bucket.has(patientKey)) {
        bucket.set(patientKey, {
          patientKey,
          patientName,
          ipdAdmission: task.ipd_admission || '',
          bedCode: task.bed_code || 'N/A',
          totalDone: 0,
          latestDoneAt: '',
        })
      }
      const rec = bucket.get(patientKey)
      rec.totalDone += 1
      rec.latestDoneAt = [rec.latestDoneAt, task.completed_at || taskDateTimeSortKey(task)].sort().pop()
    })
    return [...bucket.values()].sort((a, b) => String(b.latestDoneAt || '').localeCompare(String(a.latestDoneAt || '')))
  }, [tasks])

  useEffect(() => {
    if (section !== 'done') return
    if (!completedPatients.some((p) => p.patientKey === selectedCompletedPatient)) {
      setSelectedCompletedPatient('')
    }
  }, [section, completedPatients, selectedCompletedPatient])

  const selectedPatientMedicationHistory = useMemo(() => {
    if (!selectedCompletedPatient) return []
    return tasks
      .filter((task) => task.status === 'done')
      .filter((task) => {
        const patientName = getTaskPatientName(task)
        const key = `${task.ipd_admission || 'na'}::${patientName}`
        return key === selectedCompletedPatient
      })
      .sort((a, b) => taskDateTimeSortKey(b).localeCompare(taskDateTimeSortKey(a)))
  }, [tasks, selectedCompletedPatient])

  const selectedCompletedPatientMeta = useMemo(
    () => completedPatients.find((p) => p.patientKey === selectedCompletedPatient) || null,
    [completedPatients, selectedCompletedPatient],
  )

  const SECTIONS = [
    { id: 'pending', label: 'Pending',   activeCls: 'bg-amber-100 text-amber-700' },
    { id: 'done',    label: 'Completed', activeCls: 'bg-emerald-100 text-emerald-700' },
    { id: 'skipped', label: 'Skipped',   activeCls: 'bg-slate-100 text-slate-600' },
    { id: 'all',     label: 'All',       activeCls: 'bg-blue-100 text-blue-700' },
  ]

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="bg-white border border-gray-100 rounded-xl px-3 py-2 flex items-center justify-between">
        <p className="text-xs">
          <span className="font-semibold text-gray-700">Push Status:</span>{' '}
          <span className={`font-bold ${
            pushState === 'subscribed' ? 'text-emerald-600' : pushState === 'blocked' ? 'text-rose-600' : 'text-amber-600'
          }`}>
            {pushState === 'subscribed' ? 'Subscribed' :
             pushState === 'blocked' ? 'Blocked' :
             pushState === 'unsupported' ? 'Unsupported Browser' :
             pushState === 'ready' ? 'Ready (not subscribed)' :
             pushState === 'not_allowed' ? 'Permission needed' :
             pushState === 'checking' ? 'Checking...' : 'Error'}
          </span>
        </p>
        <button
          type="button"
          onClick={enablePushNow}
          className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
        >
          Enable Push
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1
              ${section === s.id ? `bg-white shadow ${s.activeCls}` : 'text-gray-500 hover:text-gray-700'}`}>
            {s.label}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${section === s.id ? s.activeCls : 'bg-gray-200 text-gray-500'}`}>
              {counts[s.id]}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading tasks...</div>
      ) : section === 'done' ? (
        completedPatients.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle sx={{ mx: 'auto', color: '#34d399', mb: 1, fontSize: 40 }} />
            <p className="text-gray-500 font-medium">No completed tasks yet</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl p-3 space-y-2 max-h-[70vh] overflow-y-auto">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Patients</p>
            {completedPatients.map((p) => {
              const selected = p.patientKey === selectedCompletedPatient
              return (
                <button
                  key={p.patientKey}
                  type="button"
                  onClick={() => setSelectedCompletedPatient(p.patientKey)}
                  className={`w-full text-left rounded-xl border px-3 py-2 transition-all ${
                    selected ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <p className="text-sm font-bold text-gray-800 truncate">{p.patientName}</p>
                  <p className="text-xs text-gray-500">Bed {p.bedCode}</p>
                  <p className="text-[11px] mt-1 text-emerald-700 font-semibold">{p.totalDone} completed</p>
                </button>
              )
            })}
          </div>
        )
      ) : visibleTasks.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle sx={{ mx: 'auto', color: '#34d399', mb: 1, fontSize: 40 }} />
          <p className="text-gray-500 font-medium">
            {section === 'pending' ? 'No pending tasks ΓÇö great work!' : `No ${section} tasks`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleTasks.map(task => (
            <TaskCard key={task.id} task={task} onDone={markDone} onSkip={skipTask} />
          ))}
        </div>
      )}

      {section === 'done' && selectedCompletedPatient && (
        <div className="fixed inset-0 z-[210] bg-black/40 backdrop-blur-[1px] p-4 flex items-center justify-center">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-gray-800">
                  {selectedCompletedPatientMeta?.patientName || 'Patient'} - Medication History
                </p>
                <p className="text-xs text-gray-500">
                  Bed {selectedCompletedPatientMeta?.bedCode || 'N/A'} ┬╖ {selectedCompletedPatientMeta?.totalDone || 0} completed
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCompletedPatient('')}
                className="text-xs font-bold px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="p-4 max-h-[65vh] overflow-y-auto">
              {selectedPatientMedicationHistory.length === 0 ? (
                <p className="text-sm text-gray-500">No medication history found.</p>
              ) : (
                <div className="space-y-2">
                  {selectedPatientMedicationHistory.map((task) => (
                    <div key={task.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{CAT_ICON[task.item_category] || '≡ƒôï'}</span>
                        <p className="text-sm font-semibold text-gray-800">{task.item_title}</p>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {task.date} {task.time_of_day ? task.time_of_day.slice(0, 5) : ''} ┬╖ Bed {task.bed_code || 'N/A'}
                      </p>
                      {task.completed_at && (
                        <p className="text-[11px] text-emerald-700 mt-1 font-medium">
                          Completed: {formatDateTime(task.completed_at)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ΓöÇΓöÇΓöÇ Leave Tab ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function LeaveTab() {
  const [form, setForm] = useState({
    leave_type: 'earned', start_date: format(new Date(), 'yyyy-MM-dd'),
    end_date: format(new Date(), 'yyyy-MM-dd'), reason: '', is_half_day: false
  })
  const [leaves, setLeaves] = useState([])
  const [loading, setLoading] = useState(false)
  const [balances, setBalances] = useState([])
  const [earnedThisMonth, setEarnedThisMonth] = useState(null)  // null = loading

  useEffect(() => { fetchLeaves() }, [])

  async function fetchLeaves() {
    try {
      const { data } = await api.get('/attendance/leaves/')
      // Backend uses success_response ΓåÆ { success, data: [...] }
      const payload = data?.data || data?.results || data
      setLeaves(Array.isArray(payload) ? payload : [])

      // Also fetch current leave balances
      const resBal = await api.get('/attendance/leave-balances/')
      const balPayload = resBal.data?.data || resBal.data?.results || resBal.data
      // Only keep non-earned types here; earned will be shown as current-month value.
      const list = (Array.isArray(balPayload) ? balPayload : []).filter(b => b.leave_type !== 'earned')
      setBalances(list)

      // Fetch earned leave entitlement for current month via dedicated endpoint
      const earnedRes = await api.get('/attendance/leave-balances/my-earned-this-month/')
      const earnedData = earnedRes.data?.data ?? earnedRes.data
      setEarnedThisMonth(Number(earnedData?.earned_days ?? 0))
    } catch (e) {
      setEarnedThisMonth(0)
      toast.error(e.response?.data?.detail || 'Failed to load leaves')
    }
  }

  const currentMonthName = new Date().toLocaleString('default', { month: 'long' })

  async function applyLeave(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/attendance/leaves/', { ...form, total_days: 1 })
      toast.success('Leave applied!')
      fetchLeaves()
      setForm(f => ({ ...f, reason: '' }))
    } catch (e) {
      let msg = 'Error submitting leave'
      if (e.response?.data) {
        const data = e.response.data
        // Look for the most specific error message
        const rawErr = data.detail || data.errors || data.non_field_errors || Object.values(data)[0]
        const err = (typeof rawErr === 'object' && rawErr !== null) ? (rawErr.detail || rawErr.errors || Object.values(rawErr)[0]) : rawErr
        
        if (Array.isArray(err)) msg = err[0]
        else if (typeof err === 'string') msg = err
      }
      toast.error(msg)
    }
    finally { setLoading(false) }
  }

  const statusColor = { pending: 'text-amber-600 bg-amber-50', approved: 'text-green-600 bg-green-50', rejected: 'text-red-600 bg-red-50' }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Other leave balances (non-earned) */}
      {balances.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {balances.map(b => (
            <div key={b.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 shadow-sm">
              <span className="text-sm font-bold text-gray-800">{b.balance_days}</span>
              <span className="text-xs text-gray-500 capitalize">{b.leave_type} days</span>
            </div>
          ))}
        </div>
      )}
      {/* Apply form */}
      <form onSubmit={applyLeave} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <CalendarMonth sx={{ fontSize: 18, color: '#3b82f6' }} /> Apply Leave
          </h3>
          {/* Earned leave this month tile */}
          <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5">
            <span className="text-emerald-600 text-lg font-bold leading-none">
              {earnedThisMonth === null ? 'ΓÇª' : earnedThisMonth}
            </span>
            <div className="leading-tight">
              <p className="text-xs font-semibold text-emerald-700">Earned Leave</p>
              <p className="text-xs text-emerald-500">{currentMonthName}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Leave Type</label>
            <select value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
              <option value="sick">Sick Leave</option>
              <option value="casual">Casual Leave</option>
              <option value="earned">Earned Leave</option>
              <option value="unpaid">Unpaid Leave</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={form.is_half_day} onChange={e => setForm(f => ({ ...f, is_half_day: e.target.checked }))} className="w-4 h-4" />
              Half Day
            </label>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">From</label>
            <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">To</label>
            <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Reason</label>
          <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} rows={2}
            placeholder="Brief reason for leave..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" />
        </div>
        <button type="submit" disabled={loading}
          className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-blue-700 disabled:opacity-60 transition-all">
          {loading ? 'Submitting...' : 'Submit Leave Request'}
        </button>
      </form>

      {/* Leave history */}
      <div className="space-y-2">
        <h3 className="font-semibold text-gray-700 text-sm">My Leave History</h3>
        {leaves.slice(0, 8).map(l => (
          <div key={l.id} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-800 capitalize">{l.leave_type} leave</p>
              <p className="text-xs text-gray-500">{l.start_date} ΓåÆ {l.end_date} ┬╖ {l.total_days} day(s)</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full capitalize ${statusColor[l.status]}`}>{l.status}</span>
              {l.status === 'pending' && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await api.post(`/attendance/leaves/${l.id}/cancel/`)
                      toast.success('Leave cancelled')
                      fetchLeaves()
                    } catch (e) {
                      const msg =
                        e.response?.data?.detail ||
                        e.response?.data?.errors ||
                        'Unable to cancel leave'
                      toast.error(typeof msg === 'string' ? msg : 'Unable to cancel leave')
                    }
                  }}
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ΓöÇΓöÇΓöÇ Treatment Plan Tab ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
function TreatmentPlanTab() {
  const [admissions, setAdmissions] = useState([])
  const [selectedAdm, setSelectedAdm] = useState('')
  const [plan, setPlan] = useState({ name: '', start_date: format(new Date(), 'yyyy-MM-dd'), end_date: '' })
  const [items, setItems] = useState([{ title: '', instructions: '', category: 'medication', day_offset: 0, time_of_day: '08:00' }])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.get('/ipd-admissions/?status=admitted').then(({ data }) => setAdmissions(data.results || data))
  }, [])

  function addItem() {
    setItems(p => [...p, { title: '', instructions: '', category: 'medication', day_offset: 0, time_of_day: '08:00' }])
  }

  function updateItem(i, field, val) {
    setItems(p => p.map((it, idx) => idx === i ? { ...it, [field]: val } : it))
  }

  function removeItem(i) {
    setItems(p => p.filter((_, idx) => idx !== i))
  }

  async function submit(e) {
    e.preventDefault()
    if (!selectedAdm) return toast.error('Select a patient')
    setLoading(true)
    try {
      const { data: pl } = await api.post('/treatment-plans/', {
        ipd_admission: selectedAdm,
        ...plan,
      })
      for (let i = 0; i < items.length; i++) {
        await api.post('/treatment-plan-items/', {
          plan: pl.id,
          sequence: i + 1,
          ...items[i],
        })
      }
      toast.success('Treatment plan created!')
      setItems([{ title: '', instructions: '', category: 'medication', day_offset: 0, time_of_day: '08:00' }])
    } catch (e) { toast.error(e.response?.data?.detail || 'Error') }
    finally { setLoading(false) }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <form onSubmit={submit} className="space-y-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Assignment sx={{ fontSize: 18 }} className="text-purple-500" /> New Treatment Plan</h3>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Select Patient (IPD)</label>
            <select value={selectedAdm} onChange={e => setSelectedAdm(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none">
              <option value="">-- Select admission --</option>
              {admissions.map(a => (
                <option key={a.id} value={a.id}>{a.patient_name || a.id} ΓÇö Bed {a.bed_code || 'N/A'}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3">
              <label className="text-xs text-gray-500 mb-1 block">Plan Name</label>
              <input value={plan.name} onChange={e => setPlan(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Post-op Day 0ΓÇô2"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Start Date</label>
              <input type="date" value={plan.start_date} onChange={e => setPlan(p => ({ ...p, start_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 mb-1 block">End Date (optional)</label>
              <input type="date" value={plan.end_date} onChange={e => setPlan(p => ({ ...p, end_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-800">Order Items</h3>
            <button type="button" onClick={addItem}
              className="flex items-center gap-1 bg-purple-100 text-purple-600 text-xs px-3 py-1.5 rounded-lg font-semibold hover:bg-purple-200 transition-all">
              <Add sx={{ fontSize: 13 }} /> Add Item
            </button>
          </div>
          <div className="space-y-3">
            {items.map((item, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-purple-100 text-purple-600 font-bold px-2 py-0.5 rounded-full">#{i + 1}</span>
                  <input value={item.title} onChange={e => updateItem(i, 'title', e.target.value)}
                    placeholder="e.g. Give glucose, Antibiotic..."
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none" />
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 text-xs">Γ£ò</button>
                  )}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <select value={item.category} onChange={e => updateItem(i, 'category', e.target.value)}
                    className="col-span-2 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none">
                    <option value="medication">≡ƒÆè Medication</option>
                    <option value="nursing">≡ƒ⌐║ Nursing</option>
                    <option value="physiotherapy">≡ƒÅâ Physiotherapy</option>
                    <option value="investigation">≡ƒö¼ Investigation</option>
                    <option value="diet">≡ƒÑù Diet</option>
                    <option value="other">≡ƒôï Other</option>
                  </select>
                  <div className="relative">
                    <input type="number" min={0} max={30} value={item.day_offset}
                      onChange={e => updateItem(i, 'day_offset', parseInt(e.target.value))}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none" />
                    <span className="absolute -top-2 left-1 text-xs text-gray-400">Day</span>
                  </div>
                  <input type="time" value={item.time_of_day} onChange={e => updateItem(i, 'time_of_day', e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
                </div>
                <input value={item.instructions} onChange={e => updateItem(i, 'instructions', e.target.value)}
                  placeholder="Dose, route, conditions (e.g. 500ml IV over 2h)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-purple-500 focus:outline-none" />
              </div>
            ))}
          </div>
        </div>

        <button type="submit" disabled={loading}
          className="w-full bg-purple-600 text-white py-3 rounded-2xl font-bold text-sm hover:bg-purple-700 disabled:opacity-60 transition-all">
          {loading ? 'Creating Plan...' : 'Create Treatment Plan'}
        </button>
      </form>
    </div>
  )
}

// ΓöÇΓöÇΓöÇ Main ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
export default function StaffPortal() {
  useTimeDisplayMode()
  const [tab, setTab] = useState('tasks')
  const user = useAuthStore((s) => s.user)

  return (
    <Layout title="Staff Portal" subtitle={user?.email || 'Staff'} color="blue" tabs={TABS} activeTab={tab} onTab={setTab}>
      {tab === 'tasks' && <TasksTab />}
      {tab === 'leaves' && <LeaveTab />}
      {tab === 'tp' && <TreatmentPlanTab />}
    </Layout>
  )
}
