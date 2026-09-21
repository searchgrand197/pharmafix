import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { KeyRound, LogOut } from 'lucide-react';

function errorText(error, fallback = 'Unable to change password') {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (data.message) return data.message;
  const errors = data.errors || data;
  const firstKey = Object.keys(errors || {})[0];
  const value = errors?.[firstKey];
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'string') return value;
  return fallback;
}

export default function EmployeeChangePasswordPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ old_password: '', new_password: '', confirm_password: '' });
  const [loading, setLoading] = useState(false);

  function logout() {
    localStorage.clear();
    navigate('/login');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/password-change/', form);
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      user.must_change_password = false;
      localStorage.setItem('user', JSON.stringify(user));
      toast.success('Password updated. Welcome to the employee portal.');
      navigate('/employee/dashboard');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-teal-700 to-emerald-800 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-teal-700">
            <KeyRound size={24} />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Change your password</h1>
          <p className="mt-2 text-sm text-gray-500">
            For security, you must set a new password before using the employee portal.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Current / temporary password</label>
            <input
              type="password"
              required
              value={form.old_password}
              onChange={(e) => setForm((f) => ({ ...f, old_password: e.target.value }))}
              className="min-h-[44px] w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">New password</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.new_password}
              onChange={(e) => setForm((f) => ({ ...f, new_password: e.target.value }))}
              className="min-h-[44px] w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Confirm new password</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.confirm_password}
              onChange={(e) => setForm((f) => ({ ...f, confirm_password: e.target.value }))}
              className="min-h-[44px] w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-teal-600 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {loading ? 'Saving…' : 'Update password'}
          </button>
        </form>

        <button
          type="button"
          onClick={logout}
          className="mt-4 flex w-full items-center justify-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}
