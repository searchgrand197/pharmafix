import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Edit2, Plus, User } from 'lucide-react';
import { payrollApi } from '../../../api';
import { formatCurrency, normalizePayrollList } from './payrollUtils';

function computeGross(row) {
  if (!row) return 0;
  const allowances = Object.values(row.allowances || {}).reduce((s, v) => s + (Number(v) || 0), 0);
  return (Number(row.basic_salary) || 0) + (Number(row.hra) || 0) + allowances;
}

export default function SalaryStructuresPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [structures, setStructures] = useState([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await payrollApi.get('/structures/', { params: { active: 'true' } });
      setStructures(normalizePayrollList(data));
    } catch {
      toast.error('Could not load custom salaries');
      setStructures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Custom Salaries | HR Payroll';
    load();
  }, [load]);

  const rows = useMemo(() => {
    const byEmployee = new Map();
    structures.forEach((s) => {
      const existing = byEmployee.get(s.employee);
      if (!existing || s.effective_from > existing.effective_from) {
        byEmployee.set(s.employee, s);
      }
    });
    return Array.from(byEmployee.values()).sort((a, b) =>
      (a.employee_name || '').localeCompare(b.employee_name || ''),
    );
  }, [structures]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        (row.employee_name || '').toLowerCase().includes(q)
        || (row.employee_code || '').toLowerCase().includes(q)
        || (row.employee_department || '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10 pt-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <User className="text-violet-600" size={24} />
            Custom Salaries
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Special pay for individual employees only.
          </p>
        </div>
        <Link
          to="/hr/payroll/assign?mode=custom"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700"
        >
          <Plus size={16} />
          Add custom
        </Link>
      </div>

      <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2.5 text-sm text-violet-950">
        <p className="font-medium">Do you need this page?</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-violet-900">
          <li>
            <strong>Most employees</strong> get pay from{' '}
            <Link to="/hr/payroll/compensation-levels" className="font-semibold underline">
              Compensation Levels
            </Link>
            . You usually don&apos;t need to add them here.
          </li>
          <li>
            Use <strong>custom salary</strong> only when one person needs different pay (e.g. senior hire, special HRA).
          </li>
          <li>Click <strong>Change</strong> to update someone&apos;s custom package.</li>
        </ul>
      </div>

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or employee ID"
        className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
      />

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading…</p>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          {rows.length === 0 ? (
            <>
              <p className="font-medium text-slate-800">No custom salaries yet — that&apos;s normal.</p>
              <p className="mt-2">
                Set up{' '}
                <Link to="/hr/payroll/compensation-levels" className="font-semibold text-violet-700 underline">
                  compensation levels
                </Link>{' '}
                first. Come back here only if someone needs different pay.
              </p>
              <Link
                to="/hr/payroll/assign?mode=custom"
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
              >
                <Plus size={16} />
                Add custom salary
              </Link>
            </>
          ) : (
            'No employee matches your search.'
          )}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {filteredRows.map((row) => {
            const gross = computeGross(row);
            return (
              <li
                key={row.employee}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{row.employee_name || '—'}</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {[row.employee_code, row.employee_department].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-slate-800">
                    {formatCurrency(gross)}/month
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(`/hr/payroll/assign/${row.employee}?mode=custom`)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Edit2 size={14} />
                  Change
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <p className="text-center text-xs text-slate-500">
          Everyone else uses their{' '}
          <Link to="/hr/payroll/compensation-levels" className="font-medium text-violet-700 underline">
            compensation level
          </Link>
          .
        </p>
      )}
    </div>
  );
}
