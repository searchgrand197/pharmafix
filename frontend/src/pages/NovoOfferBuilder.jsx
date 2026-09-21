import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../api';
import toast from 'react-hot-toast';
import { Save, FileText, Send, ArrowLeft, Download } from 'lucide-react';

const INITIAL_STATE = {
  candidate_name: '',
  candidate_email: '',
  candidate_phone: '',
  candidate_address: '',
  job_title: '',
  department: '',
  reporting_manager: '',
  job_location: '',
  work_mode: 'In-office',
  joining_date: new Date().toISOString().split('T')[0],
  basic_salary: '',
  hra: '',
  special_allowance: '',
  bonus: '',
  ctc: '',
  working_hours: '9 AM - 6 PM',
  shift: 'Day Shift',
  weekly_off: 'Saturday, Sunday',
  probation_period: '6 Months',
  notice_period: '30 Days',
  hr_name: '',
  hr_designation: 'HR Manager'
};

export default function NovoOfferBuilder() {
  const { builderId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (builderId) {
      fetchBuilderData();
    } else {
      // Pre-fill from candidate if candidate_id is in query
      const candidateId = searchParams.get('candidate_id');
      if (candidateId) {
        fetchCandidateData(candidateId);
      }
    }
  }, [builderId]);

  async function fetchBuilderData() {
    setLoading(true);
    try {
      const { data } = await api.get(`/hr/offer-builder/${builderId}/`);
      setFormData(data);
    } catch (error) {
      toast.error('Failed to load builder data');
    } finally {
      setLoading(false);
    }
  }

  async function fetchCandidateData(candidateId) {
    try {
      const { data } = await api.get(`/hr/candidates/${candidateId}/`);
      setFormData(prev => ({
        ...prev,
        candidate_name: data.name,
        candidate_email: data.email,
        candidate_phone: data.phone,
        candidate_address: data.address,
        job_title: data.job_opening_title || '',
        candidate: data.id
      }));
    } catch (error) {
      console.error('Failed to fetch candidate data');
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      if (builderId) {
        await api.put(`/hr/offer-builder/${builderId}/`, formData);
        toast.success('Draft updated successfully');
      } else {
        const { data } = await api.post('/hr/offer-builder/', formData);
        toast.success('Draft saved successfully');
        navigate(`/hr/novo-builder/${data.id}`);
      }
    } catch (error) {
      toast.error('Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateOffer = async () => {
    if (!builderId && !formData.candidate) {
      toast.error('Save draft first or ensure a candidate is selected');
      return;
    }

    setSaving(true);
    try {
      // 1. Save current state first
      let currentId = builderId;
      if (builderId) {
        await api.put(`/hr/offer-builder/${builderId}/`, formData);
      } else {
        const { data } = await api.post('/hr/offer-builder/', formData);
        currentId = data.id;
        navigate(`/hr/novo-builder/${data.id}`, { replace: true });
      }

      // 2. Generate offer
      const { data: genData } = await api.post(`/hr/offer-builder/${currentId}/generate_offer/`);
      toast.success(genData.message || 'Offer generated and sent!');
      
      // 3. Navigate back to candidate or offer list
      if (formData.candidate) {
        navigate(`/hr/candidates/${formData.candidate}`);
      } else {
        navigate('/hr?tab=recruitment');
      }
    } catch (error) {
      const msg = error.response?.data?.error || 'Failed to generate offer';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const PreviewTemplate = () => (
    <div className="bg-white shadow-2xl mx-auto p-12 min-h-[1123px] w-[794px] text-gray-800 font-serif leading-relaxed" id="offer-letter-preview">
      {/* Header */}
      <div className="flex justify-between items-start mb-12">
        <div className="w-32 h-16 bg-gray-200 flex items-center justify-center text-gray-400 italic">
          Company Logo
        </div>
        <div className="text-right text-sm text-gray-500">
          <p className="font-bold text-gray-800">Curevice Healthcare</p>
          <p>123 Medical Plaza, New Delhi</p>
          <p>Contact: +91 9876543210</p>
        </div>
      </div>

      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold uppercase tracking-widest border-b-2 border-gray-800 inline-block pb-2">Offer Letter</h1>
      </div>

      <div className="mb-8">
        <p className="font-bold">Date: {new Date().toLocaleDateString()}</p>
      </div>

      <div className="mb-8">
        <p className="font-bold">To,</p>
        <p className="text-xl font-bold text-blue-900">{formData.candidate_name || '[Candidate Name]'}</p>
        <p className="whitespace-pre-wrap">{formData.candidate_address || '[Candidate Address]'}</p>
        <p>{formData.candidate_email}</p>
      </div>

      <div className="mb-6">
        <p>Dear <span className="font-bold">{formData.candidate_name || 'Candidate'}</span>,</p>
        <p className="mt-4">
          We are pleased to offer you the position of <span className="font-bold text-blue-900">{formData.job_title || '[Job Title]'}</span> at 
          <span className="font-bold"> Curevice Healthcare</span>. We were impressed with your skills and experience and believe you will be a 
          valuable addition to our <span className="font-bold">{formData.department || '[Department]'}</span> team.
        </p>
      </div>

      {/* Details Table */}
      <div className="mb-8 border border-gray-200">
        <div className="grid grid-cols-2 border-b border-gray-200">
          <div className="p-2 bg-gray-50 font-bold border-r border-gray-200">Joining Date</div>
          <div className="p-2">{formData.joining_date || '[Date]'}</div>
        </div>
        <div className="grid grid-cols-2 border-b border-gray-200">
          <div className="p-2 bg-gray-50 font-bold border-r border-gray-200">Reporting Manager</div>
          <div className="p-2">{formData.reporting_manager || '[Manager Name]'}</div>
        </div>
        <div className="grid grid-cols-2 border-b border-gray-200">
          <div className="p-2 bg-gray-50 font-bold border-r border-gray-200">Work Mode</div>
          <div className="p-2">{formData.work_mode}</div>
        </div>
        <div className="grid grid-cols-2 border-b border-gray-200">
          <div className="p-2 bg-gray-50 font-bold border-r border-gray-200">Job Location</div>
          <div className="p-2">{formData.job_location || '[Location]'}</div>
        </div>
      </div>

      <h2 className="text-lg font-bold mb-4 border-b border-gray-800">Compensation & Benefits</h2>
      <div className="mb-8 border border-gray-200">
        <div className="grid grid-cols-2 border-b border-gray-200">
          <div className="p-2 bg-gray-50 border-r border-gray-200">Basic Salary</div>
          <div className="p-2 font-mono">₹{formData.basic_salary || '0'}</div>
        </div>
        <div className="grid grid-cols-2 border-b border-gray-200">
          <div className="p-2 bg-gray-50 border-r border-gray-200">HRA</div>
          <div className="p-2 font-mono">₹{formData.hra || '0'}</div>
        </div>
        <div className="grid grid-cols-2 border-b border-gray-200">
          <div className="p-2 bg-gray-50 border-r border-gray-200">Special Allowance</div>
          <div className="p-2 font-mono">₹{formData.special_allowance || '0'}</div>
        </div>
        <div className="grid grid-cols-2 bg-blue-50 font-bold">
          <div className="p-2 border-r border-gray-200">Total CTC (Annual)</div>
          <div className="p-2 font-mono text-blue-900">₹{formData.ctc || '0'}</div>
        </div>
      </div>

      <h2 className="text-lg font-bold mb-4 border-b border-gray-800">Work Schedule</h2>
      <p className="mb-8">
        Your working hours will be <span className="font-bold">{formData.working_hours}</span> in the 
        <span className="font-bold"> {formData.shift}</span>. Weekly off days will be 
        <span className="font-bold"> {formData.weekly_off}</span>.
      </p>

      <div className="mt-20 flex justify-between">
        <div>
          <div className="w-48 border-b border-gray-800 mb-2"></div>
          <p className="font-bold text-gray-800">{formData.hr_name || '[HR Name]'}</p>
          <p className="text-sm text-gray-600">{formData.hr_designation}</p>
          <p className="text-xs text-gray-500">Curevice Healthcare</p>
        </div>
        <div className="text-right">
          <div className="w-48 border-b border-gray-800 mb-2 ml-auto"></div>
          <p className="font-bold text-gray-800">Candidate Signature</p>
          <p className="text-sm text-gray-600">Date:</p>
        </div>
      </div>
    </div>
  );

  return (
    <Layout title="Novo Offer Builder" subtitle="Create professional offer letters instantly" color="purple">
      <div className="flex flex-col lg:flex-row h-[calc(100vh-140px)] overflow-hidden">
        
        {/* Left Side: Form */}
        <div className="lg:w-1/3 bg-gray-50 border-r border-gray-200 overflow-y-auto p-6 space-y-8">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => navigate(-1)} className="text-gray-600 hover:text-gray-900 flex items-center gap-1 text-sm font-medium">
              <ArrowLeft size={16} /> Back
            </button>
            <div className="flex gap-2">
              <button 
                onClick={handleSaveDraft} 
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Save size={16} /> {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button 
                onClick={handleGenerateOffer}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 rounded-lg text-sm font-semibold text-white hover:bg-purple-700 transition-colors"
              >
                <Send size={16} /> Generate
              </button>
            </div>
          </div>

          {/* Candidate Info */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-gray-300"></span> Candidate Details
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Full Name</label>
                <input name="candidate_name" value={formData.candidate_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="John Doe" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Email</label>
                  <input name="candidate_email" value={formData.candidate_email} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="john@example.com" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Phone</label>
                  <input name="candidate_phone" value={formData.candidate_phone} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="+91 0000000000" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Address</label>
                <textarea name="candidate_address" value={formData.candidate_address} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm min-h-[80px]" placeholder="Full residential address" />
              </div>
            </div>
          </section>

          {/* Job Info */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-gray-300"></span> Job Position
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Job Title</label>
                <input name="job_title" value={formData.job_title} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="Software Engineer" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Department</label>
                  <input name="department" value={formData.department} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="Engineering" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Joining Date</label>
                  <input type="date" name="joining_date" value={formData.joining_date} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Reporting Manager</label>
                  <input name="reporting_manager" value={formData.reporting_manager} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="Jane Smith" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Work Mode</label>
                  <select name="work_mode" value={formData.work_mode} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm">
                    <option>In-office</option>
                    <option>Remote</option>
                    <option>Hybrid</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Salary Info */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-gray-300"></span> Salary Structure
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Basic Salary</label>
                  <input type="number" name="basic_salary" value={formData.basic_salary} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">HRA</label>
                  <input type="number" name="hra" value={formData.hra} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Special Allowance</label>
                  <input type="number" name="special_allowance" value={formData.special_allowance} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Bonus/Variable</label>
                  <input type="number" name="bonus" value={formData.bonus} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="0" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Total Annual CTC</label>
                <input type="number" name="ctc" value={formData.ctc} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-purple-50 border-purple-200 focus:ring-2 focus:ring-purple-500 outline-none text-sm font-bold text-purple-900" placeholder="0" />
              </div>
            </div>
          </section>

          {/* Work Schedule & Terms */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-gray-300"></span> Work & Terms
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Working Hours</label>
                  <input name="working_hours" value={formData.working_hours} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="9 AM - 6 PM" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Shift</label>
                  <input name="shift" value={formData.shift} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="Day Shift" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Weekly Off</label>
                <input name="weekly_off" value={formData.weekly_off} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="Saturday, Sunday" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Probation Period</label>
                  <input name="probation_period" value={formData.probation_period} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="6 Months" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Notice Period</label>
                  <input name="notice_period" value={formData.notice_period} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="30 Days" />
                </div>
              </div>
            </div>
          </section>

          {/* HR Signature */}
          <section>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-6 h-px bg-gray-300"></span> HR Details
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">HR Name</label>
                <input name="hr_name" value={formData.hr_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" placeholder="HR Manager Name" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">HR Designation</label>
                <input name="hr_designation" value={formData.hr_designation} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-sm" />
              </div>
            </div>
          </section>
        </div>

        {/* Right Side: Live Preview */}
        <div className="lg:w-2/3 bg-gray-200 overflow-y-auto p-12 flex justify-center">
          <div className="transform scale-[0.85] origin-top">
            <PreviewTemplate />
          </div>
        </div>

      </div>
    </Layout>
  );
}
