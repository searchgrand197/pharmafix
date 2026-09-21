import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../api';
import toast from 'react-hot-toast';
import {
  UserPlus, Clock, Calendar, DollarSign, Briefcase, LineChart,
  Users, CheckCircle, XCircle, Share2, ExternalLink, FileText, Download, Edit,
  Archive, Power, Trash2, RotateCcw
} from 'lucide-react';
import ReusableTable from '../components/HR/ReusableTable';
import HRForm from '../components/HR/HRForm';
import ReusableCard from '../components/HR/ReusableCard';
import { getJobApplyUrl } from '../utils/publicUrls';
import { shareJobApplyLink } from '../utils/shareJobApplyLink';

const TABS = [
  { id: 'onboarding', label: 'Onboarding', icon: UserPlus },
  { id: 'attendance', label: 'Attendance', icon: Clock },
  { id: 'leave', label: 'Leave Management', icon: Calendar },
  { id: 'salary', label: 'Salary Management', icon: DollarSign },
  { id: 'recruitment', label: 'Recruitment', icon: Briefcase },
  { id: 'performance', label: 'Performance', icon: LineChart },
];

function OnboardingTab({ theme }) {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deptLoading, setDeptLoading] = useState(false);

  useEffect(() => {
    fetchEmployees();
    fetchDepartments();
  }, []);

  async function fetchEmployees() {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/employees/');
      setEmployees(data.results || data);
    } catch {
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  }

  async function fetchDepartments() {
    setDeptLoading(true);
    try {
      const { data } = await api.get('/hr/departments/');
      setDepartments(data.results || data);
    } catch {
      toast.error('Failed to load departments');
    } finally {
      setDeptLoading(false);
    }
  }


  const empColumns = [
    { header: 'Name', accessor: 'name' },
    { header: 'Role', accessor: 'role_name' },
    { header: 'Department', accessor: 'department_name' },
    { header: 'Status', render: (row) => (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
        row.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
      }`}>
        {row.status}
      </span>
    )}
  ];

  const deptColumns = [
    { header: 'Department Name', accessor: 'name' },
    { header: 'Created', render: (row) => new Date(row.created_at).toLocaleDateString() }
  ];

  return (
    <div className="space-y-6">
      {/* Departments Card */}
      <ReusableCard
        title="Departments"
        icon={Briefcase}
        subtitle={`${departments.length} department(s) created`}
        theme={theme}
        headerAction={
          <button
            onClick={() => navigate('/hr/departments/new')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Briefcase size={16} />
            Add Department
          </button>
        }
      >
        {deptLoading ? (
          <div className="p-8 text-center text-gray-500">Loading departments...</div>
        ) : departments.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No departments created yet</p>
            <p className="text-sm mt-1">Click "Add Department" to get started</p>
          </div>
        ) : (
          <ReusableTable columns={deptColumns} data={departments} />
        )}
      </ReusableCard>

      <ReusableCard title="Employee Roster" icon={Users} subtitle="Manage hospital staff onboarding and status" theme={theme}>
        <ReusableTable columns={empColumns} data={employees} />
      </ReusableCard>
    </div>
  );
}

function AttendanceTab({ theme }) {
  const [attendance, setAttendance] = useState([]);

  useEffect(() => {
    async function fetchAttendance() {
      try {
        const { data } = await api.get('/hr/attendance/');
        setAttendance(data.results || data);
      } catch {
        toast.error('Failed to load attendance records');
      }
    }
    fetchAttendance();
  }, []);

  const columns = [
    { header: 'Employee', accessor: 'employee_name' },
    { header: 'Date', accessor: 'date' },
    { header: 'Clock In', accessor: 'check_in' },
    { header: 'Clock Out', accessor: 'check_out' },
  ];

  return (
    <div className="space-y-6">
      <ReusableCard title="Daily Attendance" icon={Clock} subtitle="Monitor staff attendance logs" theme={theme}>
        <ReusableTable columns={columns} data={attendance} />
      </ReusableCard>
    </div>
  );
}

function LeaveTab({ theme }) {
  const [leaves, setLeaves] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [leavesRes, typesRes, empRes] = await Promise.all([
        api.get('/hr/leaves/'),
        api.get('/hr/leave-types/'),
        api.get('/hr/employees/')
      ]);
      setLeaves(leavesRes.data.results || leavesRes.data);
      setLeaveTypes(typesRes.data.results || typesRes.data);
      setEmployees(empRes.data.results || empRes.data);
    } catch {
      toast.error('Failed to load leave data');
    }
  }

  const fields = [
    { name: 'employee', label: 'Employee', type: 'select', required: true, options: employees.map(e => ({ label: e.name, value: e.id })) },
    { name: 'leave_type', label: 'Leave Type', type: 'select', required: true, options: leaveTypes.map(lt => ({ label: lt.name, value: lt.id })) },
    { name: 'start_date', label: 'Start Date', type: 'date', required: true },
    { name: 'end_date', label: 'End Date', type: 'date', required: true },
    { name: 'reason', label: 'Reason', type: 'textarea', fullWidth: true }
  ];

  const handleLeaveSubmit = async (data) => {
    try {
      await api.post('/hr/leaves/', data);
      toast.success('Leave request submitted');
      fetchData(); // refresh list
    } catch {
      toast.error('Failed to submit leave request');
    }
  };

  const columns = [
    { header: 'Employee', accessor: 'employee_name' },
    { header: 'Type', accessor: 'leave_type_name' },
    { header: 'Start Date', accessor: 'start_date' },
    { header: 'End Date', accessor: 'end_date' },
    { header: 'Status', render: (row) => (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
        row.status === 'approved' ? 'bg-green-100 text-green-700' : 
        row.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
      }`}>
        {row.status}
      </span>
    )}
  ];

  return (
    <div className="space-y-6">
      <ReusableCard title="Leave Management" icon={Calendar} theme={theme}>
        <HRForm fields={fields} onSubmit={handleLeaveSubmit} submitLabel="Submit Request" theme={theme} />
      </ReusableCard>
      
      <ReusableCard title="Leave History" icon={Calendar} theme={theme}>
        <ReusableTable columns={columns} data={leaves} />
      </ReusableCard>
    </div>
  );
}

function SalaryTab({ theme }) {
  const [salaries, setSalaries] = useState([]);

  useEffect(() => {
    async function fetchSalaries() {
      try {
        const { data } = await api.get('/hr/salary/');
        setSalaries(data.results || data);
      } catch {
        toast.error('Failed to load salary data');
      }
    }
    fetchSalaries();
  }, []);

  const columns = [
    { header: 'Employee', accessor: 'employee_name' },
    { header: 'Basic Pay', accessor: 'basic_pay' },
    { header: 'Allowance', accessor: 'allowance' },
    { header: 'Deductions', accessor: 'deductions' },
    { header: 'Overtime', accessor: 'overtime' },
    { header: 'Month', accessor: 'month' },
  ];

  return (
    <div className="space-y-6">
      <ReusableCard title="Salary Management" icon={DollarSign} subtitle="Manage staff payroll and allowances" theme={theme}>
        <ReusableTable columns={columns} data={salaries} />
      </ReusableCard>
    </div>
  );
}

function RecruitmentTab({ theme }) {
  const navigate = useNavigate();
  const [jobOpenings, setJobOpenings] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('active');

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  async function fetchData() {
    setLoading(true);
    try {
      const [jobsRes, deptRes] = await Promise.all([
        api.get(`/hr/job-openings/?status=${statusFilter}`),
        api.get('/hr/departments/')
      ]);
      setJobOpenings(jobsRes.data.results || jobsRes.data);
      setDepartments(deptRes.data.results || deptRes.data);
    } catch (error) {
      toast.error('Failed to load recruitment data');
      console.error('Error fetching recruitment data:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleAddJob = () => {
    navigate('/hr/jobs/new');
  };

  const handleEditJob = (job) => {
    navigate(`/hr/jobs/${job.id}/edit`);
  };

  const handleDeleteJob = async (job) => {
    const candidateCount = job.candidate_count || 0;
    const message = candidateCount > 0
      ? `This job has ${candidateCount} candidate(s). It will be archived instead of deleted to preserve candidate data. Continue?`
      : 'Are you sure you want to permanently delete this job opening?';

    if (!window.confirm(message)) {
      return;
    }

    try {
      const response = await api.delete(`/hr/job-openings/${job.id}/`);
      if (response.data.action === 'archived') {
        toast.success(response.data.message || 'Job archived successfully');
      } else {
        toast.success(response.data.message || 'Job deleted successfully');
      }
      fetchData();
    } catch (error) {
      const errorMessage = error.response?.data?.detail || error.response?.data?.error || 'Failed to process job';
      toast.error(errorMessage);
      console.error('Error processing job:', error.response?.data || error);
    }
  };

  const handleCloseJob = async (job) => {
    if (!window.confirm(`Are you sure you want to close "${job.title}"?`)) {
      return;
    }

    try {
      await api.post(`/hr/job-openings/${job.id}/close/`);
      toast.success('Job closed successfully');
      fetchData();
    } catch (error) {
      const errorMessage = error.response?.data?.detail || error.response?.data?.error || 'Failed to close job';
      toast.error(errorMessage);
      console.error('Error closing job:', error.response?.data || error);
    }
  };

  const handleArchiveJob = async (job) => {
    if (!window.confirm(`Are you sure you want to archive "${job.title}"?`)) {
      return;
    }

    try {
      await api.post(`/hr/job-openings/${job.id}/archive/`);
      toast.success('Job archived successfully');
      fetchData();
    } catch (error) {
      const errorMessage = error.response?.data?.detail || error.response?.data?.error || 'Failed to archive job';
      toast.error(errorMessage);
      console.error('Error archiving job:', error.response?.data || error);
    }
  };

  const handleReactivateJob = async (job) => {
    if (!window.confirm(`Are you sure you want to reactivate "${job.title}"?`)) {
      return;
    }

    try {
      await api.post(`/hr/job-openings/${job.id}/reactivate/`);
      toast.success('Job reactivated successfully');
      fetchData();
    } catch (error) {
      const errorMessage = error.response?.data?.detail || error.response?.data?.error || 'Failed to reactivate job';
      toast.error(errorMessage);
      console.error('Error reactivating job:', error.response?.data || error);
    }
  };

  const handleShareJob = async (jobCode) => {
    await shareJobApplyLink(jobCode);
  };

  const jobColumns = [
    { header: 'Job Code', accessor: 'job_code' },
    { header: 'Title', accessor: 'title' },
    { header: 'Department', accessor: 'department_name' },
    { header: 'Type', accessor: 'employment_type_display' },
    { header: 'Vacancies', accessor: 'vacancies' },
    { header: 'Status', render: (row) => (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
        row.status === 'open' ? 'bg-green-100 text-green-700' :
        row.status === 'closed' ? 'bg-red-100 text-red-700' :
        row.status === 'draft' ? 'bg-gray-100 text-gray-700' :
        row.status === 'archived' ? 'bg-purple-100 text-purple-700' :
        'bg-amber-100 text-amber-700'
      }`}>
        {row.status_display || row.status}
      </span>
    )},
    { header: 'Share', render: (row) => (
      <button
        onClick={() => handleShareJob(row.job_code)}
        className="px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors flex items-center gap-1"
      >
        <Share2 size={14} />
        Share Link
      </button>
    )},
    { header: 'Actions', render: (row) => (
      <div className="flex gap-2">
        <button
          onClick={() => handleEditJob(row)}
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
          title="Edit Job"
        >
          <Edit size={16} />
        </button>
        {row.status === 'open' && (
          <button
            onClick={() => handleCloseJob(row)}
            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
            title="Close Job"
          >
            <Power size={16} />
          </button>
        )}
        {row.status !== 'archived' && (
          <button
            onClick={() => handleArchiveJob(row)}
            className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
            title="Archive Job"
          >
            <Archive size={16} />
          </button>
        )}
        {(row.status === 'closed' || row.status === 'archived') && (
          <button
            onClick={() => handleReactivateJob(row)}
            className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
            title="Reactivate Job"
          >
            <RotateCcw size={16} />
          </button>
        )}
        <button
          onClick={() => handleDeleteJob(row)}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title={row.candidate_count > 0 ? 'Archive (has candidates)' : 'Delete Job'}
        >
          <Trash2 size={16} />
        </button>
      </div>
    )}
  ];

  return (
    <div className="space-y-6">
      {/* Job Openings Section */}
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Job Openings</h2>
            <p className="text-sm text-gray-600 mt-1">Manage and share your job openings. Candidates can apply using the share link.</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate('/hr/builder')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
            >
              <Briefcase size={16} />
              Offer Builder
            </button>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active Jobs</option>
              <option value="closed">Closed Jobs</option>
              <option value="archived">Archived Jobs</option>
              <option value="all">All Jobs</option>
            </select>
            <button
              onClick={() => navigate('/hr/jobs/new')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <Briefcase size={16} />
              Add New Job
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500">Loading jobs...</div>
        ) : jobOpenings.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
            <Briefcase size={48} className="mx-auto mb-4 text-gray-300" />
            <p className="font-medium text-gray-700 mb-2">No job openings available</p>
            <p className="text-sm text-gray-500 mb-4">Click "Add New Job" to create your first job opening</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {jobOpenings.map((job) => {
              const applyLink = getJobApplyUrl(job);
              return (
                <div
                  key={job.id}
                  className="bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow overflow-hidden"
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <p className="text-xs font-mono text-gray-500">{job.job_code || 'N/A'}</p>
                      <div className="flex items-center gap-2">
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                          job.status === 'open' ? 'bg-green-100 text-green-700' :
                          job.status === 'closed' ? 'bg-red-100 text-red-700' :
                          job.status === 'draft' ? 'bg-gray-100 text-gray-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {job.status_display || job.status}
                        </span>
                        <button
                          onClick={() => handleEditJob(job)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit Job"
                        >
                          <Edit size={16} />
                        </button>
                      </div>
                    </div>

                    <h3 className="font-bold text-gray-800 text-xl mb-3">{job.title}</h3>

                    <div className="flex items-center gap-4 mb-3 text-sm text-gray-600">
                      {job.department_name && (
                        <div className="flex items-center gap-1">
                          <Briefcase size={14} />
                          <span>{job.department_name}</span>
                        </div>
                      )}
                      {job.location && <span>• {job.location}</span>}
                    </div>

                    <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                      {job.description || 'No description provided'}
                    </p>

                    <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <Users size={14} />
                          <span>{job.candidate_count || 0} Candidates</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Briefcase size={14} />
                          <span>{job.vacancies || 1} Vacancies</span>
                        </div>
                      </div>
                      <button
                        onClick={() => window.location.href = `/hr/recruitment/job/${job.id}/candidates`}
                        className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                      >
                        View Candidates
                      </button>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                      <span>Posted: {job.created_at ? new Date(job.created_at).toLocaleDateString() : 'N/A'}</span>
                      {job.expiry_date && <span>• Last: {new Date(job.expiry_date).toLocaleDateString()}</span>}
                    </div>
                  </div>

                  <div className="bg-gray-50 border-t border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 mr-4">
                        <p className="text-xs font-medium text-gray-600 mb-2">Apply Link</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={applyLink}
                            className="flex-1 px-3 py-2 text-xs text-gray-700 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            type="button"
                            onClick={() => shareJobApplyLink(job, { openTab: false })}
                            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                          >
                            Copy
                          </button>
                          <button
                            onClick={() => handleShareJob(job.job_code)}
                            className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Share Link"
                          >
                            <Share2 size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditJob(job)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit Job"
                        >
                          <Edit size={16} />
                        </button>
                        {job.status === 'open' && (
                          <button
                            onClick={() => handleCloseJob(job)}
                            className="p-2 text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                            title="Close Job"
                          >
                            <Power size={16} />
                          </button>
                        )}
                        {job.status !== 'archived' && (
                          <button
                            onClick={() => handleArchiveJob(job)}
                            className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Archive Job"
                          >
                            <Archive size={16} />
                          </button>
                        )}
                        {(job.status === 'closed' || job.status === 'archived') && (
                          <button
                            onClick={() => handleReactivateJob(job)}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Reactivate Job"
                          >
                            <RotateCcw size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteJob(job)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title={job.candidate_count > 0 ? 'Archive (has candidates)' : 'Delete Job'}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PerformanceTab({ theme }) {
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    async function fetchReviews() {
      try {
        const { data } = await api.get('/hr/performance/');
        setReviews(data.results || data);
      } catch {
        toast.error('Failed to load performance reviews');
      }
    }
    fetchReviews();
  }, []);

  const columns = [
    { header: 'Employee', accessor: 'employee_name' },
    { header: 'Remarks', accessor: 'remarks' },
  ];

  return (
    <div className="space-y-6">
      <ReusableCard title="Performance Reviews" icon={LineChart} theme={theme}>
        <ReusableTable columns={columns} data={reviews} />
      </ReusableCard>
    </div>
  );
}

export default function HRPortal() {
  const [activeTab, setActiveTab] = useState('onboarding');
  const [theme, setTheme] = useState('purple');

  // Parse query parameters to set active tab on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && TABS.find(t => t.id === tab)) {
      setActiveTab(tab);
    }
  }, []);

  const ThemeToggle = (
    <button
      onClick={() => setTheme(prev => prev === 'purple' ? 'lightpink' : 'purple')}
      className="flex items-center gap-1 text-[11px] font-bold bg-white/20 hover:bg-white/30 px-2 py-1 rounded transition-all mr-2"
    >
      Toggle Theme
    </button>
  );

  return (
    <Layout
      title="HR Dashboard"
      subtitle="Human Resources & Staff Management"
      color={theme}
      tabs={TABS}
      activeTab={activeTab}
      onTab={setActiveTab}
      sidebar={true}
      headerExtra={ThemeToggle}
    >
      <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
        {activeTab === 'onboarding' && <OnboardingTab theme={theme} />}
        {activeTab === 'attendance' && <AttendanceTab theme={theme} />}
        {activeTab === 'leave' && <LeaveTab theme={theme} />}
        {activeTab === 'salary' && <SalaryTab theme={theme} />}
        {activeTab === 'recruitment' && <RecruitmentTab theme={theme} />}
        {activeTab === 'performance' && <PerformanceTab theme={theme} />}
      </div>
    </Layout>
  );
}
