import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import HRPageWrapper from '../components/HR/HRPageWrapper';
import api from '../api';
import toast from 'react-hot-toast';
import { 
  FileText, ArrowLeft, Edit, Trash2, User, Briefcase, 
  Calendar, Clock, Search, Filter, FileStack, Send, CheckCircle2
} from 'lucide-react';
import ReusableTable from '../components/HR/ReusableTable';
import ReusableCard from '../components/HR/ReusableCard';

export default function OfferDrafts() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const [sendingId, setSendingId] = useState(null);

  useEffect(() => {
    fetchDrafts();
  }, []);

  async function fetchDrafts() {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/offer-builder-v2/');
      // Robustly handle both paginated and non-paginated responses
      if (data && data.results && Array.isArray(data.results)) {
        setDrafts(data.results);
      } else if (Array.isArray(data)) {
        setDrafts(data);
      } else {
        setDrafts([]);
      }
    } catch (error) {
      toast.error('Failed to load offer drafts');
      console.error('Error fetching drafts:', error);
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }

  const handleSendOffer = async (id, name) => {
    if (!window.confirm(`Generate PDF and send offer letter to ${name || 'the candidate'}?`)) {
      return;
    }

    setSendingId(id);
    const toastId = toast.loading('Generating PDF and sending email...');
    
    try {
      await api.post(`/hr/offer-builder-v2/${id}/generate_offer/`);
      toast.success('Offer letter sent successfully!', { id: toastId });
      // Refresh list as the draft might now be considered "sent" or we might want to see updated status
      fetchDrafts();
    } catch (error) {
      console.error('Error sending offer:', error);
      toast.error(error.response?.data?.error || 'Failed to send offer letter', { id: toastId });
    } finally {
      setSendingId(null);
    }
  };

  const handleDeleteDraft = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete the draft for "${name || 'Unnamed Candidate'}"?`)) {
      return;
    }

    try {
      await api.delete(`/hr/offer-builder-v2/${id}/`);
      toast.success('Draft deleted successfully');
      fetchDrafts();
    } catch (error) {
      toast.error('Failed to delete draft');
    }
  };

  const filteredDrafts = drafts.filter(draft => {
    const searchLower = searchTerm.toLowerCase();
    return (
      (draft.candidate_name || '').toLowerCase().includes(searchLower) ||
      (draft.job_title || '').toLowerCase().includes(searchLower) ||
      (draft.candidate_email || '').toLowerCase().includes(searchLower)
    );
  });

  const columns = [
    { 
      header: 'Candidate', 
      render: (row) => (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
            <User size={14} />
          </div>
          <div>
            <p className="font-bold text-gray-800">{row.candidate_name || 'Unnamed'}</p>
            <p className="text-xs text-gray-500">{row.candidate_email || 'No email'}</p>
          </div>
        </div>
      )
    },
    { 
      header: 'Position', 
      render: (row) => (
        <div>
          <p className="font-medium text-gray-700">{row.job_title || 'No title'}</p>
          <p className="text-xs text-gray-500">{row.department || 'No department'}</p>
        </div>
      )
    },
    { 
      header: 'Last Updated', 
      render: (row) => (
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Clock size={12} />
          {new Date(row.updated_at).toLocaleDateString()} {new Date(row.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )
    },
    { 
      header: 'Theme', 
      render: (row) => (
        <span className="px-2 py-1 text-[10px] font-black uppercase tracking-wider bg-gray-100 text-gray-600 rounded">
          {row.theme || 'corporate'}
        </span>
      )
    },
    {
      header: 'Status',
      render: (row) => (
        row.is_sent ? (
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full w-fit">
            <CheckCircle2 size={12} />
            Sent
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full w-fit">
            <Clock size={12} />
            Draft
          </div>
        )
      )
    },
    { 
      header: 'Actions', 
      render: (row) => (
        <div className="flex gap-2">
          <button
            onClick={() => handleSendOffer(row.id, row.candidate_name)}
            disabled={sendingId === row.id || row.is_sent}
            className={`p-2 rounded-lg transition-colors ${
              sendingId === row.id || row.is_sent ? 'text-gray-300 bg-gray-50 cursor-not-allowed' : 'text-emerald-600 hover:bg-emerald-50'
            }`}
            title={row.is_sent ? "Offer already sent" : "Send Offer Letter"}
          >
            <Send size={16} className={sendingId === row.id ? 'animate-pulse' : ''} />
          </button>
          <button
            onClick={() => navigate(`/hr/builder/${row.id}`)}
            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            title="Edit Draft"
          >
            <Edit size={16} />
          </button>
          <button
            onClick={() => handleDeleteDraft(row.id, row.candidate_name)}
            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete Draft"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )
    }
  ];

  return (
    <HRPageWrapper color="purple" layoutSidebar={true}>
      <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <button
            onClick={() => navigate('/hr/recruitment/jobs')}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors w-fit"
          >
            <ArrowLeft size={16} />
            Back to Recruitment
          </button>

          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input 
              type="text"
              placeholder="Search by candidate or job..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none transition-all shadow-sm"
            />
          </div>
        </div>

        <ReusableCard 
          title="Saved Drafts" 
          icon={FileStack} 
          theme="purple"
          subtitle={`Showing ${filteredDrafts.length} draft(s)`}
        >
          {loading ? (
            <div className="p-12 text-center text-gray-500">Loading drafts...</div>
          ) : filteredDrafts.length === 0 ? (
            <div className="p-12 text-center">
              <FileText size={48} className="mx-auto mb-4 text-gray-300" />
              <p className="font-medium text-gray-700 mb-2">No drafts found</p>
              <p className="text-sm text-gray-500">
                {searchTerm ? 'Try adjusting your search' : 'Drafts you save in the Offer Builder will appear here'}
              </p>
            </div>
          ) : (
            <ReusableTable columns={columns} data={filteredDrafts} />
          )}
        </ReusableCard>
      </div>
    </HRPageWrapper>
  );
}
