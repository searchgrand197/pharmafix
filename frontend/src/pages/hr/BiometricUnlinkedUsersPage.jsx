import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { Fingerprint, RefreshCw, UserPlus, UserX } from 'lucide-react';
import { normalizeApiList } from '../../hr/recruitmentLifecycle';
import ReusableTable from '../../components/HR/ReusableTable';
import { TableSkeleton } from '../../components/HR/HRSkeleton';
import { BackToEmployeeLink } from './employeeDetail/EmployeeDetailUi';
import {
  CreateEmployeeFromConflictModal,
  RejectConflictModal,
} from '../../components/HR/BiometricConflictModals';
import { buildManualEmployeePayload } from '../../utils/employeeFormValidation';
import { parseApiError } from '../../utils/apiErrors';

const STATUS_TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'linked', label: 'Linked' },
];

const VALID_STATUSES = new Set(STATUS_TABS.map((tab) => tab.id));

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function BiometricUnlinkedUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatus = searchParams.get('status') || 'pending';
  const status = VALID_STATUSES.has(rawStatus) ? rawStatus : 'pending';
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [activeConflict, setActiveConflict] = useState(null);
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [createServerErrors, setCreateServerErrors] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/biometric-unlinked-users/', {
        params: { status, limit: 500 },
      });
      setRows(normalizeApiList(data));
    } catch {
      toast.error('Failed to load device user conflicts');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (rawStatus !== status) {
      setSearchParams(status === 'pending' ? {} : { status });
    }
  }, [rawStatus, status, setSearchParams]);

  useEffect(() => {
    document.title = 'Device conflicts | HR';
    load();
  }, [load]);

  useEffect(() => {
    if (status !== 'pending') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const [deptRes, desRes] = await Promise.all([
          api.get('/hr/departments/', { params: { limit: 200 } }),
          api.get('/hr/designations/', { params: { limit: 500, active: 'true' } }),
        ]);
        if (!cancelled) {
          setDepartments(normalizeApiList(deptRes.data));
          setDesignations(normalizeApiList(desRes.data));
        }
      } catch {
        if (!cancelled) {
          setDepartments([]);
          setDesignations([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [status]);

  function setStatus(nextStatus) {
    setSearchParams(nextStatus === 'pending' ? {} : { status: nextStatus });
  }

  function openCreateModal(conflict) {
    setCreateServerErrors({});
    setActiveConflict(conflict);
    setModal('create');
  }

  async function handleCreateAndLink(form) {
    if (!activeConflict) return;
    setSaving(true);
    setCreateServerErrors({});
    try {
      const payload = buildManualEmployeePayload(form, { departments, designations });
      const { data } = await api.post(
        `/hr/biometric-unlinked-users/${activeConflict.id}/create-and-link/`,
        payload,
      );
      toast.success(
        (t) => (
          <span>
            Created
            {' '}
            {data.employee_code || 'employee'}
            {' '}
            and linked PIN
            {' '}
            {data.biometric_pin}
            .
            {' '}
            <Link to={`/hr/employees/${data.employee_id}`} className="underline font-semibold">
              View employee
            </Link>
          </span>
        ),
        { duration: 6000 },
      );
      setModal(null);
      setActiveConflict(null);
      setCreateServerErrors({});
      await load();
    } catch (error) {
      const { message, fieldErrors } = parseApiError(error, 'Failed to create employee');
      if (Object.keys(fieldErrors).length > 0) {
        setCreateServerErrors(fieldErrors);
      }
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!activeConflict) return;
    setSaving(true);
    try {
      await api.post(`/hr/biometric-unlinked-users/${activeConflict.id}/reject/`);
      toast.success(`Rejected PIN ${activeConflict.pin} — removal queued on device`);
      setModal(null);
      setActiveConflict(null);
      await load();
    } catch (error) {
      toast.error(parseApiError(error, 'Failed to reject device user').message);
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo(() => {
    const base = [
      { header: 'PIN', accessor: 'pin' },
      { header: 'Name on device', accessor: 'name' },
      { header: 'Device', render: (row) => row.device_serial || '—' },
      { header: 'First seen', render: (row) => formatDateTime(row.first_seen_at) },
      { header: 'Last seen', render: (row) => formatDateTime(row.last_seen_at) },
    ];

    if (status === 'linked') {
      base.push({
        header: 'Linked employee',
        render: (row) => (
          row.linked_employee ? (
            <Link to={`/hr/employees/${row.linked_employee}`} className="font-medium text-violet-700 hover:underline">
              {row.linked_employee_name || row.linked_employee_code || 'Employee'}
            </Link>
          ) : '—'
        ),
      });
      base.push({
        header: 'Resolved',
        render: (row) => formatDateTime(row.resolved_at),
      });
    }

    if (status === 'pending') {
      base.push({
        header: 'Actions',
        render: (row) => (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openCreateModal(row)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
            >
              <UserPlus size={14} />
              Create employee
            </button>
            <button
              type="button"
              onClick={() => { setActiveConflict(row); setModal('reject'); }}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700"
            >
              <UserX size={14} />
              Reject employee
            </button>
          </div>
        ),
      });
    }

    return base;
  }, [status]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <BackToEmployeeLink />
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Fingerprint className="text-violet-600" size={24} />
            Device user conflicts
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Users created on the biometric machine that are not yet in HR. Create a new employee
            or reject and remove from the device.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {status === 'pending' && rows.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{rows.length}</strong>
          {' '}
          machine user(s) need HR review. Until resolved, their punches will not count in attendance.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatus(tab.id)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              status === tab.id
                ? 'bg-violet-600 text-white'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : (
        <ReusableTable columns={columns} data={rows} />
      )}

      <CreateEmployeeFromConflictModal
        open={modal === 'create'}
        conflict={activeConflict}
        departments={departments}
        designations={designations}
        saving={saving}
        serverErrors={createServerErrors}
        onClose={() => {
          if (!saving) {
            setModal(null);
            setActiveConflict(null);
            setCreateServerErrors({});
          }
        }}
        onConfirm={handleCreateAndLink}
      />

      <RejectConflictModal
        open={modal === 'reject'}
        conflict={activeConflict}
        saving={saving}
        onClose={() => { if (!saving) { setModal(null); setActiveConflict(null); } }}
        onConfirm={handleReject}
      />
    </div>
  );
}
