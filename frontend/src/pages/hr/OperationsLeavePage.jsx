import React, { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { Calendar } from 'lucide-react';
import ReusableTable from '../../components/HR/ReusableTable';
import ReusableCard from '../../components/HR/ReusableCard';
import HRForm from '../../components/HR/HRForm';

function errorText(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (data.error || data.detail) return data.error || data.detail;
  const firstKey = Object.keys(data)[0];
  const value = data[firstKey];
  if (Array.isArray(value)) return `${firstKey}: ${value.join(', ')}`;
  if (typeof value === 'string') return `${firstKey}: ${value}`;
  return fallback;
}

export default function OperationsLeavePage() {
  const { theme = 'purple' } = useOutletContext() || {};
  const [leaves, setLeaves] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [employees, setEmployees] = useState([]);

  async function fetchData() {
    const results = await Promise.allSettled([
      api.get('/hr/leave-requests/'),
      api.get('/hr/leave-types/'),
      api.get('/hr/employees/', { params: { limit: 500 } }),
    ]);
    if (results[0].status === 'fulfilled') {
      const d = results[0].value.data;
      setLeaves(d.results || d);
    }
    if (results[1].status === 'fulfilled') {
      const d = results[1].value.data;
      setLeaveTypes(d.results || d);
    }
    if (results[2].status === 'fulfilled') {
      const d = results[2].value.data;
      setEmployees(d.results || d);
    }
    if (results.some((r) => r.status === 'rejected')) {
      toast.error('Some leave data could not be loaded');
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const fields = [
    { name: 'employee', label: 'Employee', type: 'select', required: true, options: employees.map((e) => ({ label: e.name, value: e.id })) },
    { name: 'leave_type', label: 'Leave Type', type: 'select', required: true, options: leaveTypes.map((lt) => ({ label: lt.name, value: lt.id })) },
    { name: 'start_date', label: 'Start Date', type: 'date', required: true },
    { name: 'end_date', label: 'End Date', type: 'date', required: true },
    { name: 'reason', label: 'Reason', type: 'textarea', fullWidth: true },
  ];

  async function handleLeaveSubmit(data) {
    try {
      await api.post('/hr/leave-requests/', data);
      toast.success('Leave request submitted');
      fetchData();
    } catch (error) {
      toast.error(errorText(error, 'Failed to submit leave request'));
    }
  }

  async function reviewLeave(row, action) {
    try {
      await api.post(`/hr/leave-requests/${row.id}/${action}/`, { remarks: '' });
      toast.success(`Leave ${action}d`);
      fetchData();
    } catch (error) {
      toast.error(errorText(error, `Failed to ${action} leave`));
    }
  }

  const columns = [
    { header: 'Employee', accessor: 'employee_name' },
    { header: 'Type', accessor: 'leave_type_name' },
    { header: 'Start Date', accessor: 'start_date' },
    { header: 'End Date', accessor: 'end_date' },
    { header: 'Days', accessor: 'number_of_days' },
    { header: 'Balance', accessor: 'remaining_balance' },
    { header: 'Status', render: (row) => (
      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
        row.status === 'APPROVED' ? 'bg-green-100 text-green-700'
          : row.status === 'REJECTED' ? 'bg-red-100 text-red-700'
            : row.status === 'CANCELLED' ? 'bg-slate-100 text-slate-700'
              : 'bg-amber-100 text-amber-700'
      }`}
      >
        {row.status_display || row.status}
      </span>
    ) },
    { header: 'Actions', render: (row) => (
      row.status === 'PENDING' ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => reviewLeave(row, 'approve')} className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700">Approve</button>
          <button type="button" onClick={() => reviewLeave(row, 'reject')} className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700">Reject</button>
        </div>
      ) : <span className="text-xs text-slate-500">Reviewed</span>
    ) },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <ReusableCard title="Leave Management" icon={Calendar} theme={theme}>
        <HRForm fields={fields} onSubmit={handleLeaveSubmit} submitLabel="Submit Request" theme={theme} />
      </ReusableCard>
      <ReusableCard title="Leave History" icon={Calendar} theme={theme}>
        <ReusableTable columns={columns} data={leaves} />
      </ReusableCard>
    </div>
  );
}
