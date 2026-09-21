import React, { useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { Clock, Mail, Phone, User } from 'lucide-react';

export default function EmployeeProfilePage() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Profile | Employee Portal';
    api.get('/employee-portal/profile/')
      .then((res) => setProfile(res.data))
      .catch(() => toast.error('Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-sm text-gray-500">Loading profile…</div>;
  if (!profile) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-100 text-teal-700">
            <User size={28} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">{profile.name}</h2>
            <p className="text-sm text-gray-500">{profile.employee_id}</p>
          </div>
        </div>

        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase text-gray-500">Department</dt>
            <dd className="mt-1 text-sm text-gray-900">{profile.department || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-gray-500">Designation</dt>
            <dd className="mt-1 text-sm text-gray-900">{profile.designation || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-gray-500">Status</dt>
            <dd className="mt-1 text-sm capitalize text-gray-900">{profile.status?.replace(/_/g, ' ') || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase text-gray-500">Joining date</dt>
            <dd className="mt-1 text-sm text-gray-900">{profile.joining_date || '—'}</dd>
          </div>
          <div className="flex items-start gap-2 sm:col-span-2">
            <Mail size={16} className="mt-0.5 text-gray-400" />
            <div>
              <dt className="text-xs font-semibold uppercase text-gray-500">Email</dt>
              <dd className="mt-1 text-sm text-gray-900">{profile.email || '—'}</dd>
            </div>
          </div>
          <div className="flex items-start gap-2 sm:col-span-2">
            <Phone size={16} className="mt-0.5 text-gray-400" />
            <div>
              <dt className="text-xs font-semibold uppercase text-gray-500">Phone</dt>
              <dd className="mt-1 text-sm text-gray-900">{profile.phone || '—'}</dd>
            </div>
          </div>
          {profile.shift && (
            <div className="flex items-start gap-2 sm:col-span-2">
              <Clock size={16} className="mt-0.5 text-gray-400" />
              <div>
                <dt className="text-xs font-semibold uppercase text-gray-500">Assigned shift</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {profile.shift.name}
                  {profile.shift.start_time && profile.shift.end_time && (
                    <> ({profile.shift.start_time} – {profile.shift.end_time})</>
                  )}
                </dd>
              </div>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
