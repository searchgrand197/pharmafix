import React, { useCallback, useEffect, useState } from 'react';

import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { clearSession, resolveEmployeeAccessRedirect } from '../../utils/authSession';

import {

  Bell,

  Calendar,

  CalendarDays,

  FileText,

  LayoutDashboard,

  LogOut,

  Sparkles,

  User,

  Wallet,

} from 'lucide-react';

import api from '../../api';



function navLinkClass(isActive) {

  return [

    'flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',

    isActive ? 'bg-teal-50 text-teal-800' : 'text-gray-700 hover:bg-gray-50',

  ].join(' ');

}



function mobileNavClass(isActive) {

  return `flex min-h-[48px] min-w-[56px] flex-col items-center justify-center gap-0.5 text-[10px] ${

    isActive ? 'text-teal-700' : 'text-gray-500'

  }`;

}



export default function EmployeeShellLayout() {

  const navigate = useNavigate();

  const [unreadCount, setUnreadCount] = useState(0);



  const loadUnread = useCallback(async () => {

    try {

      const { data } = await api.get('/employee-portal/notifications/unread-count/');

      setUnreadCount(data.unread_count || 0);

    } catch {

      setUnreadCount(0);

    }

  }, []);



  useEffect(() => {

    loadUnread();

    const interval = setInterval(loadUnread, 60000);

    return () => clearInterval(interval);

  }, [loadUnread]);



  function logout() {

    localStorage.clear();

    navigate('/login');

  }



  const badge = unreadCount > 0 ? (

    <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">

      {unreadCount > 99 ? '99+' : unreadCount}

    </span>

  ) : null;



  return (

    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gray-50">

      <header className="z-10 flex shrink-0 items-center justify-between bg-gradient-to-r from-teal-600 to-emerald-600 px-4 py-3 text-white shadow sm:px-6">

        <div className="flex min-w-0 items-center gap-2">

          <User size={20} className="shrink-0" />

          <div className="min-w-0">

            <h1 className="truncate text-sm font-extrabold leading-tight">HRMS Control Center</h1>

            <p className="truncate text-xs opacity-90">Employee self-service portal</p>

          </div>

        </div>

        <button

          type="button"

          onClick={logout}

          className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-bold hover:bg-white/25"

        >

          <LogOut size={14} /> Logout

        </button>

      </header>



      <div className="flex min-h-0 flex-1 overflow-hidden">

        <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white py-4 md:flex">

          <nav className="space-y-0.5 px-3">

            <NavLink to="/employee/dashboard" className={({ isActive }) => navLinkClass(isActive)}>

              <LayoutDashboard size={16} /> Dashboard

            </NavLink>

            <NavLink to="/employee/notifications" className={({ isActive }) => navLinkClass(isActive)}>

              <Bell size={16} /> Notifications {badge}

            </NavLink>

            <NavLink to="/employee/attendance" className={({ isActive }) => navLinkClass(isActive)}>

              <CalendarDays size={16} /> Attendance

            </NavLink>

            <NavLink to="/employee/leaves" className={({ isActive }) => navLinkClass(isActive)}>

              <Calendar size={16} /> Leaves

            </NavLink>

            <NavLink to="/employee/holidays" className={({ isActive }) => navLinkClass(isActive)}>

              <Sparkles size={16} /> Holidays

            </NavLink>

            <NavLink to="/employee/payslips" className={({ isActive }) => navLinkClass(isActive)}>

              <Wallet size={16} /> My Payslips

            </NavLink>

            <NavLink to="/employee/documents" className={({ isActive }) => navLinkClass(isActive)}>

              <FileText size={16} /> Documents

            </NavLink>

            <NavLink to="/employee/profile" className={({ isActive }) => navLinkClass(isActive)}>

              <User size={16} /> Profile

            </NavLink>

          </nav>

        </aside>



        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6">

          <Outlet context={{ refreshNotificationCount: loadUnread }} />

        </main>

      </div>



      <nav className="flex shrink-0 justify-around border-t border-gray-200 bg-white py-1 md:hidden">

        <NavLink to="/employee/dashboard" className={({ isActive }) => mobileNavClass(isActive)}>

          <LayoutDashboard size={18} />

          Home

        </NavLink>

        <NavLink to="/employee/notifications" className={({ isActive }) => mobileNavClass(isActive)}>

          <span className="relative">

            <Bell size={18} />

            {unreadCount > 0 && (

              <span className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">

                {unreadCount > 9 ? '9+' : unreadCount}

              </span>

            )}

          </span>

          Alerts

        </NavLink>

        <NavLink to="/employee/attendance" className={({ isActive }) => mobileNavClass(isActive)}>

          <CalendarDays size={18} />

          Attendance

        </NavLink>

        <NavLink to="/employee/leaves" className={({ isActive }) => mobileNavClass(isActive)}>

          <Calendar size={18} />

          Leaves

        </NavLink>

        <NavLink to="/employee/payslips" className={({ isActive }) => mobileNavClass(isActive)}>

          <Wallet size={18} />

          Payslips

        </NavLink>

        <NavLink to="/employee/documents" className={({ isActive }) => mobileNavClass(isActive)}>

          <FileText size={18} />

          Docs

        </NavLink>

      </nav>

    </div>

  );

}


