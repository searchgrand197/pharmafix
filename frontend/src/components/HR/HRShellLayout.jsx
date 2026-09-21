import React, { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { journeyCenterPath } from '../../pages/hr/journeyCenterUtils';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Briefcase,
  Building2,
  Calendar,
  ChevronDown,
  ClipboardList,
  Clock,
  DollarSign,
  FileCheck,
  FlaskConical,
  Hospital,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Star,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import {
  HR_MOBILE_NAV_LINKS,
  HR_SIDEBAR_JOURNEY_SUB_LINKS,
  HR_SIDEBAR_ORG_SETTINGS_LINK,
  HR_SIDEBAR_REPORTS_LINK,
  HR_SIDEBAR_SECTIONS,
  HR_SIDEBAR_TOP_LINKS,
  isSectionPathActive,
} from '../../pages/hr/hrSidebarConfig';

const COLORS = {
  purple: 'from-purple-600 to-indigo-600',
  lightpink: 'from-pink-400 to-rose-400',
};

const ICONS = {
  star: Star,
  sparkles: Sparkles,
  layoutDashboard: LayoutDashboard,
  briefcase: Briefcase,
  userPlus: UserPlus,
  fileCheck: FileCheck,
  clipboardList: ClipboardList,
  alertTriangle: AlertTriangle,
  users: Users,
  clock: Clock,
  calendar: Calendar,
  flask: FlaskConical,
  building: Building2,
  dollar: DollarSign,
  wallet: Wallet,
  barChart: BarChart3,
  settings: Settings,
};

const ICON_COLORS = {
  star: 'fill-amber-400 text-amber-500',
  sparkles: 'text-violet-500',
  layoutDashboard: 'text-purple-500',
  briefcase: 'text-purple-500',
  userPlus: 'text-purple-500',
  fileCheck: 'text-purple-500',
  clipboardList: 'text-purple-500',
  alertTriangle: 'text-rose-500',
  users: 'text-purple-500',
  clock: 'text-gray-500',
  calendar: 'text-gray-500',
  flask: 'text-gray-500',
  building: 'text-gray-500',
  dollar: 'text-emerald-600',
  wallet: 'text-emerald-600',
  barChart: 'text-indigo-500',
  settings: 'text-purple-500',
};

function navLinkClass(isActive) {
  return [
    'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-purple-50 text-purple-800' : 'text-gray-700 hover:bg-gray-50',
  ].join(' ');
}

function NavIcon({ name, size = 16 }) {
  const Icon = ICONS[name];
  if (!Icon) return null;
  return <Icon size={size} className={ICON_COLORS[name] || 'text-gray-500'} />;
}

function SubNavLink({ to, end, children }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => navLinkClass(isActive)}>
      {children}
    </NavLink>
  );
}

function CollapseHeader({ open, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-gray-500 hover:bg-gray-50"
    >
      {label}
      <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );
}

function SidebarNavItem({ item }) {
  return (
    <SubNavLink to={item.to}>
      <span className="flex items-center gap-2">
        <NavIcon name={item.icon} />
        {item.label}
      </span>
    </SubNavLink>
  );
}

function SidebarSection({ section, open, onToggle, pathname }) {
  const pathActive = isSectionPathActive(pathname, section);
  const expanded = open || pathActive;

  return (
    <div className="mt-2 border-t border-gray-100 px-3 pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <CollapseHeader label={section.label} open={expanded} onClick={onToggle} />
      {expanded && (
        <nav className="mt-1 space-y-0.5 border-l-2 border-gray-100 pl-2">
          {section.items.map((item) => (
            <SidebarNavItem key={`${section.id}-${item.label}`} item={item} />
          ))}
        </nav>
      )}
    </div>
  );
}

export default function HRShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathname = location.pathname;
  const [searchParams] = useSearchParams();
  const fromSource = searchParams.get('from');
  const onOrgSettingsHub = pathname === '/hr/settings/organization'
    || pathname === '/hr/settings/organization/';
  const showSetupWizardBack = fromSource === 'setup-wizard' && !onOrgSettingsHub;
  const showHrDashboardBack = fromSource === 'hr-dashboard'
    && !pathname.startsWith('/hr/journey-center/dashboard');
  const showJourneyCenterBack = fromSource === 'journey-center'
    && !pathname.startsWith('/hr/journey-center');

  const [theme, setTheme] = useState('purple');
  const [open, setOpen] = useState({
    recruitment: true,
    onboarding: false,
    workforce: true,
    attendance: false,
    leave: false,
    payroll: false,
  });

  function toggleSection(id) {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function logout() {
    localStorage.clear();
    navigate('/login');
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50">
      <header className={`bg-gradient-to-r ${COLORS[theme] || COLORS.purple} z-10 flex shrink-0 items-center justify-between px-4 py-2 text-white shadow sm:px-6`}>
        <div className="flex items-center gap-2">
          <Hospital size={18} />
          <div>
            <h1 className="text-sm font-extrabold leading-tight">HR</h1>
            <p className="text-[10px] opacity-90">Recruitment & workforce</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'purple' ? 'lightpink' : 'purple'))}
            className="rounded bg-white/15 px-2 py-1 text-[11px] font-bold hover:bg-white/25"
          >
            Theme
          </button>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1 rounded bg-white/15 px-2 py-1 text-[11px] font-bold hover:bg-white/25"
          >
            <LogOut size={12} /> Logout
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white py-4 md:flex">
          <div className="px-3 pb-3 space-y-0.5">
            {HR_SIDEBAR_TOP_LINKS.map((link) => (
              <SubNavLink key={link.id} to={link.to} end={link.end}>
                <span className="flex items-center gap-2">
                  <NavIcon name={link.icon} />
                  {link.label}
                </span>
              </SubNavLink>
            ))}
            <nav className="space-y-0.5">
              {HR_SIDEBAR_JOURNEY_SUB_LINKS.map((item) => (
                <SidebarNavItem key={item.to} item={item} />
              ))}
            </nav>
          </div>

          {HR_SIDEBAR_SECTIONS.map((section) => (
            <SidebarSection
              key={section.id}
              section={section}
              pathname={pathname}
              open={open[section.id]}
              onToggle={() => toggleSection(section.id)}
            />
          ))}

          <div className="mt-2 space-y-0.5 border-t border-gray-100 px-3 pt-3">
            <SubNavLink to={HR_SIDEBAR_REPORTS_LINK.to}>
              <span className="flex items-center gap-2">
                <NavIcon name={HR_SIDEBAR_REPORTS_LINK.icon} />
                {HR_SIDEBAR_REPORTS_LINK.label}
              </span>
            </SubNavLink>
            <SubNavLink to={HR_SIDEBAR_ORG_SETTINGS_LINK.to}>
              <span className="flex items-center gap-2">
                <NavIcon name={HR_SIDEBAR_ORG_SETTINGS_LINK.icon} />
                {HR_SIDEBAR_ORG_SETTINGS_LINK.label}
              </span>
            </SubNavLink>
          </div>

          <div className="mt-auto px-3 pt-6 text-[10px] text-gray-400">
            HR home:{' '}
            <Link to="/hr/journey-center/dashboard" className="text-purple-600 underline">
              HR Dashboard
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-gray-200 bg-white px-3 py-2 md:hidden">
            <p className="text-xs font-semibold text-gray-600">HR menu — use a larger screen for full sidebar.</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {HR_MOBILE_NAV_LINKS.map((link) => (
                <Link
                  key={link.to}
                  className={`rounded border px-2 py-1 ${
                    pathname.startsWith(link.to.split('?')[0])
                      ? 'border-purple-300 bg-purple-50 text-purple-800'
                      : 'border-gray-200'
                  }`}
                  to={link.to}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            {showSetupWizardBack && (
              <Link
                to="/hr/settings/organization"
                className="mb-4 inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100"
              >
                <ArrowLeft size={16} />
                Back to Organization Settings
              </Link>
            )}
            {showHrDashboardBack && (
              <Link
                to="/hr/journey-center/dashboard"
                className="mb-4 inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100"
              >
                <ArrowLeft size={16} />
                Back to HR Dashboard
              </Link>
            )}
            {showJourneyCenterBack && (
              <Link
                to={journeyCenterPath(searchParams.get('job_opening'))}
                className="mb-4 inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100"
              >
                <ArrowLeft size={16} />
                Back to Hire Staff
              </Link>
            )}
            <Outlet context={{ theme, hrShell: true }} />
          </main>
        </div>
      </div>
    </div>
  );
}
