import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api'
import toast from 'react-hot-toast'
import {
  Login as LoginIcon,
  CorporateFare as CorporateFareIcon,
  Science as ScienceIcon,
  MedicalServices as MedicalServicesIcon,
  ManageAccounts as ManageAccountsIcon,
  Checklist as ChecklistIcon,
  Store as StoreIcon,
  CheckCircle as CheckCircleIcon,
  Autorenew as AutorenewIcon,
  Shield as ShieldIcon,
  Groups as GroupsIcon,
  Badge as BadgeIcon,
} from '@mui/icons-material'
import { useAuthStore } from '../stores/authStore'
import { AccountRestrictedError } from '../utils/authErrors'
import { getApiErrorMessage } from '../utils/apiError'
import {
  defaultPathForRole,
  employeePortalPath,
  getStoredUser,
  hasAccessToken,
  isEmployeeOnlyAccount,
} from '../utils/auth'

function asMuiIcon(IconComponent) {
  return function IconBridge({ size, className, sx, ...rest }) {
    return <IconComponent className={className} sx={{ ...(size ? { fontSize: size } : {}), ...sx }} {...rest} />
  }
}

const LogIn = asMuiIcon(LoginIcon)
const Building2 = asMuiIcon(CorporateFareIcon)
const FlaskConical = asMuiIcon(ScienceIcon)
const Stethoscope = asMuiIcon(MedicalServicesIcon)
const UserCog = asMuiIcon(ManageAccountsIcon)
const ClipboardList = asMuiIcon(ChecklistIcon)
const Store = asMuiIcon(StoreIcon)
const CheckCircle2 = asMuiIcon(CheckCircleIcon)
const Loader2 = asMuiIcon(AutorenewIcon)
const Shield = asMuiIcon(ShieldIcon)
const Groups = asMuiIcon(GroupsIcon)
const Badge = asMuiIcon(BadgeIcon)

const ROLES = [
  { label: 'Staff',        value: 'staff',        path: '/staff',        icon: UserCog,       color: '#6366f1' },
  { label: 'Doctor',       value: 'doctor',       path: '/doctor',       icon: Stethoscope,   color: '#0ea5e9' },
  { label: 'Receptionist', value: 'receptionist', path: '/receptionist', icon: ClipboardList, color: '#8b5cf6' },
  { label: 'Lab',          value: 'lab',          path: '/lab',          icon: FlaskConical,  color: '#06b6d4' },
  { label: 'Pharmacy',     value: 'pharmacy',     path: '/pharmacy',     icon: Store,         color: '#10b981' },
  { label: 'Admin',        value: 'admin',        path: '/admin',        icon: Shield,        color: '#dc2626' },
  { label: 'HR',           value: 'hr',           path: '/hr/journey-center/dashboard', icon: Groups, color: '#ea580c' },
  { label: 'Employee',     value: 'employee',     path: '/employee/dashboard', icon: Badge, color: '#0891b2' },
]

const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  .lr * { font-family:'Inter',sans-serif; box-sizing:border-box; }

  .lr-bg {
    min-height:100vh;
    background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 50%,#312e81 100%);
    display:flex; align-items:center; justify-content:center; padding:0.5rem;
    position:relative; overflow:hidden;
  }
  .blob { position:absolute; border-radius:50%; filter:blur(80px); opacity:0.15; animation:bf 8s ease-in-out infinite; }
  .b1 { width:380px;height:380px;background:#3b82f6;top:-80px;left:-100px;animation-delay:0s; }
  .b2 { width:280px;height:280px;background:#8b5cf6;bottom:-60px;right:-60px;animation-delay:-3s; }
  @keyframes bf { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-20px) scale(1.04)} }

  .lr-card {
    background:rgba(255,255,255,0.97);
    border-radius:20px;
    box-shadow:0 24px 64px rgba(0,0,0,0.4);
    width:100%; max-width:420px;
    overflow:hidden; position:relative; z-index:1;
    animation:ci 0.45s cubic-bezier(0.22,1,0.36,1);
  }
  @keyframes ci { from{opacity:0;transform:translateY(20px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }

  /* ── Header: horizontal, compact ── */
  .lr-header {
    background:linear-gradient(135deg,#1d4ed8 0%,#4f46e5 55%,#7c3aed 100%);
    padding:14px 20px;
    display:flex; align-items:center; gap:12px;
    position:relative; overflow:hidden;
  }
  .lr-header::after {
    content:''; position:absolute; inset:0;
    background:radial-gradient(ellipse at 70% 0%,rgba(255,255,255,0.14) 0%,transparent 65%);
  }
  .lr-logo {
    width:40px; height:40px; border-radius:50%; flex-shrink:0;
    background:rgba(255,255,255,0.18); border:2px solid rgba(255,255,255,0.28);
    display:flex; align-items:center; justify-content:center;
    box-shadow:0 4px 10px rgba(0,0,0,0.18); position:relative; z-index:1;
  }
  .lr-title { color:#fff; font-size:1.05rem; font-weight:800; margin:0; letter-spacing:-0.3px; position:relative; z-index:1; }
  .lr-sub   { color:rgba(196,213,255,0.85); font-size:0.68rem; margin:1px 0 0; font-weight:500; position:relative; z-index:1; }

  /* ── Body ── */
  .lr-body { padding:14px 20px 10px; }

  /* ── Label ── */
  .fl { display:block; font-size:0.62rem; font-weight:700; color:#94a3b8;
        text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px; }

  /* ── Role pills ── */
  .rg { display:grid; grid-template-columns:repeat(4,1fr); gap:5px; margin-bottom:12px; }
  .rp {
    display:flex; flex-direction:column; align-items:center; gap:3px;
    padding:7px 2px 6px; border-radius:10px; border:2px solid transparent;
    background:#f1f5f9; color:#64748b;
    font-size:0.6rem; font-weight:600; cursor:pointer;
    transition:all 0.16s ease;
  }
  .rp:hover { background:#e2e8f0; color:#334155; transform:translateY(-1px); }
  .rp.on { color:#fff; box-shadow:0 3px 8px rgba(0,0,0,0.16); transform:translateY(-2px); }
  .ri { width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center; background:rgba(255,255,255,0.22); }
  .rp:not(.on) .ri { background:rgba(100,116,139,0.11); }

  /* ── Branch cards — side by side ── */
  .bs { margin-bottom:12px; animation:bi 0.24s cubic-bezier(0.22,1,0.36,1); }
  @keyframes bi { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
  .bc-row { display:flex; gap:7px; }
  .bc {
    flex:1; display:flex; flex-direction:column; align-items:center; gap:5px;
    padding:10px 8px; border-radius:11px;
    border:2px solid #e2e8f0; background:#f8fafc;
    cursor:pointer; transition:all 0.15s ease; text-align:center; position:relative;
  }
  .bc:hover { border-color:#10b981; transform:translateY(-2px); box-shadow:0 4px 12px rgba(16,185,129,0.14); }
  .bc.sel {
    border-color:#10b981;
    background:linear-gradient(135deg,#f0fdf4,#ecfdf5);
    box-shadow:0 4px 14px rgba(16,185,129,0.18);
  }
  .bc-icon {
    width:32px;height:32px;border-radius:9px;
    background:linear-gradient(135deg,#059669,#10b981);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 2px 7px rgba(16,185,129,0.25);
  }
  .bc-icon svg { color:#fff; }
  .bc-name { font-size:0.77rem; font-weight:700; color:#1e293b; line-height:1.2; }
  .bc-chk { position:absolute; top:6px; right:6px; color:#10b981; }

  /* skeleton */
  .bsk { flex:1; height:78px; border-radius:11px; background:#f1f5f9; overflow:hidden; position:relative; }
  .bsk::after { content:''; position:absolute; inset:0;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent);
    animation:sh 1.4s infinite; }
  @keyframes sh { from{transform:translateX(-100%)} to{transform:translateX(100%)} }

  /* empty */
  .be { padding:10px; border-radius:10px; background:#fffbeb; border:2px dashed #fbbf24;
        color:#92400e; font-size:0.74rem; font-weight:500; text-align:center; }

  /* ── Inputs ── */
  .fw { margin-bottom:9px; }
  .fi {
    width:100%; border:2px solid #e2e8f0; border-radius:10px;
    padding:9px 13px; font-size:0.85rem; color:#1e293b;
    outline:none; transition:border-color 0.16s,box-shadow 0.16s;
    background:#f8fafc; font-family:'Inter',sans-serif;
  }
  .fi:focus { border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,0.1); background:#fff; }
  .fi::placeholder { color:#94a3b8; }

  /* ── Submit ── */
  .sb {
    width:100%; padding:10px; border-radius:10px; border:none; margin-top:12px;
    background:linear-gradient(135deg,#2563eb 0%,#4f46e5 100%);
    color:#fff; font-size:0.88rem; font-weight:700;
    display:flex; align-items:center; justify-content:center; gap:7px;
    cursor:pointer; transition:all 0.18s ease;
    box-shadow:0 5px 14px rgba(37,99,235,0.3);
    font-family:'Inter',sans-serif;
  }
  .sb:hover:not(:disabled) { transform:translateY(-2px); box-shadow:0 8px 20px rgba(37,99,235,0.4); }
  .sb:active:not(:disabled) { transform:translateY(0); }
  .sb:disabled { opacity:0.6; cursor:not-allowed; }

  .spin { animation:s360 0.8s linear infinite; }
  @keyframes s360 { to{transform:rotate(360deg)} }

  /* ── Footer ── */
  .lr-foot { padding:6px 20px 12px; text-align:center; }
  .lr-foot a { color:#3b82f6; text-decoration:none; font-weight:600; font-size:0.7rem; }
  .lr-foot p { color:#94a3b8; font-size:0.7rem; margin:0; }
`

export default function Login() {
  const nav = useNavigate()
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole]       = useState('staff')
  const [loading, setLoading] = useState(false)

  const [branches, setBranches]         = useState([])
  const [branchId, setBranchId]         = useState('')
  const [branchesLoading, setBranchesLoading] = useState(false)

  useEffect(() => {
    const savedRole = useAuthStore.getState().role
    if (savedRole && ROLES.some((r) => r.value === savedRole)) {
      setRole(savedRole)
    }
  }, [])

  useEffect(() => {
    if (!hasAccessToken()) return
    const user = getStoredUser()
    if (isEmployeeOnlyAccount(user)) {
      nav(employeePortalPath(user), { replace: true })
    }
  }, [nav])

  const handleRoleSelect = (nextRole) => {
    setRole(nextRole)
  }

  useEffect(() => {
    if (role !== 'pharmacy') { setBranches([]); setBranchId(''); return }
    setBranchesLoading(true)
    api.get('/auth/pharmacies/')
      .then(({ data }) => {
        let list = data?.data || []
        const allowed = useAuthStore.getState().allowedPharmacyIds || []
        if (allowed.length > 0) {
          const allowedSet = new Set(allowed.map(String))
          list = list.filter((b) => allowedSet.has(String(b.id)))
        }
        setBranches(list)
        setBranchId(list.length === 1 ? String(list[0].id) : '')
      })
      .catch(() => toast.error('Could not load pharmacy branches'))
      .finally(() => setBranchesLoading(false))
  }, [role])

  async function handleLogin(e) {
    e.preventDefault()
    if (role === 'pharmacy' && !branchId) { toast.error('Please select a pharmacy branch'); return }
    setLoading(true)
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!normalizedEmail) {
      toast.error('Please enter email')
      setLoading(false)
      return
    }
    // Fire fullscreen as non-blocking — awaiting it delays the login flow and
    // causes a blank-screen flash during the browser's fullscreen animation.
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {})
    }
    try {
      const pharmacyBranch = role === 'pharmacy' && branchId
        ? { id: branchId, label: branches.find(b => String(b.id) === String(branchId))?.label || '' }
        : null
      const { user } = await useAuthStore.getState().login(normalizedEmail, password, role, pharmacyBranch)
      const loginRole = isEmployeeOnlyAccount(user) ? 'employee' : role
      if (loginRole !== role) {
        useAuthStore.setState({ role: loginRole })
        localStorage.setItem('role', loginRole)
      }
      nav(defaultPathForRole(loginRole, user) || ROLES.find(r => r.value === loginRole)?.path || '/staff')
      toast.success('Welcome back!')
    } catch (err) {
      const backendErrors = err?.response?.data?.errors
      const status = err?.response?.status
      const msg = getApiErrorMessage(err)
      if (status === 403) {
        const allowedPharmacies = backendErrors?.allowed_pharmacy_ids
        if (role === 'pharmacy' && Array.isArray(allowedPharmacies) && allowedPharmacies.length > 0) {
          setBranchId('')
          toast.error(msg || 'You are not allowed to use this pharmacy branch.')
        } else {
          toast.error(msg || new AccountRestrictedError().message)
        }
      } else {
        toast.error('Wrong email or password')
      }
    } finally {
      setLoading(false)
    }
  }

  const activeRole = ROLES.find(r => r.value === role)

  return (
    <div className="lr">
      <style>{STYLE}</style>
      <div className="lr-bg">
        <div className="blob b1" /><div className="blob b2" />

        <div className="lr-card">

          {/* Header */}
          <div className="lr-header">
            <div className="lr-logo"><Building2 size={22} color="#fff" /></div>
            <div>
              <div className="lr-title">HMS Portal</div>
              <div className="lr-sub">Hospital Management System</div>
            </div>
          </div>

          {/* Body */}
          <div className="lr-body">
            <form onSubmit={handleLogin}>

              {/* Role pills */}
              <label className="fl">Login As</label>
              <div className="rg">
                {ROLES.map(r => {
                  const Icon = r.icon
                  const on = role === r.value
                  return (
                    <button
                      key={r.value} type="button"
                      onClick={() => handleRoleSelect(r.value)}
                      className={`rp${on ? ' on' : ''}`}
                      style={on ? { background:`linear-gradient(135deg,${r.color}dd,${r.color})` } : {}}
                    >
                      <div className="ri"><Icon size={13} color={on ? '#fff' : r.color} /></div>
                      {r.label}
                    </button>
                  )
                })}
              </div>

              {/* Branch picker — side-by-side cards */}
              {role === 'pharmacy' && (
                <div className="bs">
                  <label className="fl" style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <Store size={10} /> Select Pharmacy Branch
                  </label>

                  {branchesLoading ? (
                    <div className="bc-row">
                      <div className="bsk" /><div className="bsk" style={{ opacity:0.55 }} />
                    </div>
                  ) : branches.length === 0 ? (
                    <div className="be">⚠️ No active pharmacy branches found.</div>
                  ) : (
                    <div className="bc-row">
                      {branches.map((b) => {
                        const isSel = String(branchId) === String(b.id)
                        return (
                          <div key={b.id} className={`bc${isSel ? ' sel' : ''}`} onClick={() => setBranchId(String(b.id))}>
                            {isSel && <CheckCircle2 size={15} className="bc-chk" />}
                            <div className="bc-icon"><Store size={16} /></div>
                            <div className="bc-name">{b.label}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Email */}
              <div className="fw">
                <label className="fl">Email Address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@hospital.com" className="fi" required autoComplete="username" />
              </div>

              {/* Password */}
              <div className="fw">
                <label className="fl">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" className="fi" required autoComplete="current-password" />
              </div>

              {/* Submit */}
              <button type="submit" disabled={loading || (role === 'pharmacy' && branchesLoading)} className="sb">
                {loading
                  ? <><Loader2 size={16} className="spin" /> Signing in…</>
                  : <><LogIn size={16} /> Sign In to {activeRole?.label || 'Portal'}</>
                }
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="lr-foot">
            <p>
              <Link to="/change-password">Change password</Link>
            </p>
            <p>TV Display: <a href="/tv/room1">/tv/room1</a></p>
          </div>

        </div>
      </div>
    </div>
  )
}
