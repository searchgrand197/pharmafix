import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import HRPageWrapper from '../components/HR/HRPageWrapper';
import { defaultOfferExpiryDate, todayISODate } from '../utils/offerLetterVariables';
import api from '../api';
import toast from 'react-hot-toast';
import { User, ArrowLeft, Briefcase, CheckCircle, XCircle, ChevronLeft, ChevronRight, Mail, Phone, Calendar, Clock, Video, MapPin, DollarSign, CalendarCheck, RotateCcw } from 'lucide-react';
import { USE_NEW_OFFER_BUILDER } from '../api';
import {
  applyOfflineInterviewDefaults,
  buildSingleScheduleInterviewPayload,
  defaultScheduleInterviewForm,
  offlineInterviewDefaultsFromOrganization,
  scheduleInterviewFormFromCandidate,
  validateScheduleInterviewForm,
} from '../components/HR/scheduleInterviewFormUtils';
import ScheduleInterviewFormFields from '../components/HR/ScheduleInterviewFormFields';
import { formatInterviewDateTime } from '../utils/interviewDateTime';

const EMPTY_OFFLINE_INTERVIEW_DEFAULTS = {
  officeAddress: '',
  locationNotes: '',
};

export default function CandidateDetail() {
  const { candidateId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.returnTo;
  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [jobCandidates, setJobCandidates] = useState([]);
  const [navigating, setNavigating] = useState(false);
  
  // Interview scheduling modal state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleModalMode, setScheduleModalMode] = useState('schedule');
  const [scheduleForm, setScheduleForm] = useState(() => defaultScheduleInterviewForm());
  const [offlineInterviewDefaults, setOfflineInterviewDefaults] = useState(
    EMPTY_OFFLINE_INTERVIEW_DEFAULTS,
  );
  
  // Offer creation modal state
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [createdOfferId, setCreatedOfferId] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState('');
  const [offerForm, setOfferForm] = useState({
    component_template_id: '',
    ctc: '',
    basic_salary: '',
    hra: '',
    allowances: '',
    bonus: '',
    joining_date: '',
    work_shift: '',
    working_hours: '',
    probation_period: '',
    notice_period: '',
    offer_expiry_date: defaultOfferExpiryDate(),
  });

  useEffect(() => {
    fetchCandidate();
    fetchTemplates();
    fetchDrafts();
    setNavigating(false);
  }, [candidateId]);

  useEffect(() => {
    if (!showScheduleModal) {
      setOfflineInterviewDefaults(EMPTY_OFFLINE_INTERVIEW_DEFAULTS);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.get('/hr/organization-settings/current/');
        if (cancelled) return;
        const defaults = offlineInterviewDefaultsFromOrganization(data);
        setOfflineInterviewDefaults(defaults);
        setScheduleForm((current) => applyOfflineInterviewDefaults(current, defaults));
      } catch (error) {
        if (cancelled) return;
        setOfflineInterviewDefaults(EMPTY_OFFLINE_INTERVIEW_DEFAULTS);
        console.error('Failed to load interview offline defaults', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showScheduleModal]);

  async function fetchDrafts() {
    setLoadingDrafts(true);
    try {
      const { data } = await api.get('/hr/offer-builder-v2/');
      setDrafts(data.results || data);
    } catch (error) {
      console.error('Error fetching drafts:', error);
    } finally {
      setLoadingDrafts(false);
    }
  }

  async function fetchTemplates() {
    setLoadingTemplates(true);
    try {
      const { data } = await api.get('/hr/component-templates/');
      const dataArray = data.results || data;
      
      const filteredTemplates = dataArray.filter(t => {
        const name = (t?.name || '').toLowerCase().trim();
        return (
          !name.includes('tcs professional sample letter') &&
          !name.includes('tcs style professional offer letter')
        );
      });
      
      setTemplates(filteredTemplates);
      console.log('[Templates] Fetched templates:', filteredTemplates);
    } catch (error) {
      console.error('[Templates] Error fetching templates:', error);
      toast.error('Failed to load builder templates');
    } finally {
      setLoadingTemplates(false);
    }
  }

  const handleTemplateChange = (templateId) => {
    setSelectedTemplate(templateId);
    if (!templateId) {
      setOfferForm({
        component_template_id: '',
        ctc: '',
        basic_salary: '',
        hra: '',
        allowances: '',
        bonus: '',
        joining_date: '',
        work_shift: '',
        working_hours: '',
        probation_period: '',
        notice_period: '',
        offer_expiry_date: defaultOfferExpiryDate()
      });
      return;
    }

    setOfferForm(prev => ({
      ...prev,
      component_template_id: templateId,
    }));
  };

  async function fetchCandidate() {
    setLoading(true);
    try {
      const { data } = await api.get(`/hr/candidates/${candidateId}/`);
      setCandidate(data);
      if (data.job_opening) {
        fetchJobCandidates(data.job_opening);
      }
    } catch (error) {
      toast.error('Failed to load candidate details');
    } finally {
      setLoading(false);
    }
  }

  async function fetchJobCandidates(jobId) {
    try {
      const { data } = await api.get(`/hr/candidates/?job_id=${jobId}`);
      const candidates = data.results || data;
      setJobCandidates(candidates);
    } catch (error) {
      console.error('Failed to fetch job candidates');
    }
  }

  const handlePreviousCandidate = () => {
    if (jobCandidates.length === 0) return;
    
    const currentIndex = jobCandidates.findIndex(c => c.id == candidateId);
    if (currentIndex > 0) {
      const prevCandidate = jobCandidates[currentIndex - 1];
      setNavigating(true);
      navigate(`/hr/candidates/${prevCandidate.id}`, { state: location.state });
    }
  };

  const handleNextCandidate = () => {
    if (jobCandidates.length === 0) return;
    
    const currentIndex = jobCandidates.findIndex(c => c.id == candidateId);
    if (currentIndex < jobCandidates.length - 1) {
      const nextCandidate = jobCandidates[currentIndex + 1];
      setNavigating(true);
      navigate(`/hr/candidates/${nextCandidate.id}`, { state: location.state });
    }
  };

  const handleBack = () => {
    if (returnTo) {
      navigate(returnTo);
      return;
    }
    if (candidate?.job_opening) {
      navigate(`/hr/recruitment/job/${candidate.job_opening}/candidates`);
      return;
    }
    navigate('/hr/recruitment/candidates');
  };

  const handleDownloadResume = async () => {
    const url = getResumeUrl();
    if (url) {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `${candidate.name.replace(/\s+/g, '_')}_Resume.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      } catch (error) {
        console.error('Download failed:', error);
        toast.error('Failed to download resume');
      }
    }
  };

  const handleStatusUpdate = async (newStatus) => {
    setUpdating(true);
    try {
      await api.patch(`/hr/candidates/${candidateId}/`, { status: newStatus });
      setCandidate({ ...candidate, status: newStatus });
      toast.success(`Candidate ${newStatus} successfully`);
    } catch (error) {
      toast.error('Failed to update status');
    } finally {
      setUpdating(false);
    }
  };

  // Recruitment Pipeline Actions
  const handleMoveToInterview = async () => {
    setUpdating(true);
    try {
      const { data } = await api.post(`/hr/candidates/${candidateId}/move_to_interview/`);
      setCandidate({ ...candidate, status: data.status, interview_status: 'pending' });
      toast.success(data.message);
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to move to interview';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const openScheduleModal = () => {
    setScheduleModalMode('schedule');
    setScheduleForm(defaultScheduleInterviewForm());
    setOfflineInterviewDefaults(EMPTY_OFFLINE_INTERVIEW_DEFAULTS);
    setShowScheduleModal(true);
  };

  const openRescheduleModal = () => {
    if (!candidate) return;
    setScheduleModalMode('reschedule');
    setScheduleForm(scheduleInterviewFormFromCandidate(candidate));
    setOfflineInterviewDefaults(EMPTY_OFFLINE_INTERVIEW_DEFAULTS);
    setShowScheduleModal(true);
  };

  const handleScheduleInterview = async () => {
    const validationError = validateScheduleInterviewForm(scheduleForm);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setUpdating(true);
    try {
      const payload = buildSingleScheduleInterviewPayload(scheduleForm);
      const { data } = await api.post(`/hr/candidates/${candidateId}/schedule_interview/`, payload);
      toast.success(data.message || (data.rescheduled ? 'Interview rescheduled' : 'Interview scheduled'));
      setShowScheduleModal(false);
      try {
        const { data: refreshed } = await api.get(`/hr/candidates/${candidateId}/`);
        setCandidate(refreshed);
      } catch {
        setCandidate({
          ...candidate,
          status: 'interview',
          interview_status: 'pending',
          interview_date: data.interview_date,
          interview_type: data.interview_type,
          interview_meeting_link: data.interview_meeting_link ?? '',
          interview_venue_address: data.interview_venue_address ?? '',
        });
      }
    } catch (error) {
      const message = error.response?.data?.error || (
        scheduleModalMode === 'reschedule' ? 'Failed to reschedule interview' : 'Failed to schedule interview'
      );
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleMarkInterviewCompleted = async () => {
    setUpdating(true);
    try {
      console.log("[Mark Interview Completed] API call starting");
      console.log("[Mark Interview Completed] Current candidate:", candidate);
      const { data } = await api.post(`/hr/candidates/${candidateId}/mark_interview_completed/`);
      console.log("[Mark Interview Completed] API response:", data);
      console.log("[Mark Interview Completed] API response candidate:", data.candidate);
      
      if (data.success && data.candidate) {
        console.log("[Mark Interview Completed] Setting candidate state");
        console.log("[Mark Interview Completed] Candidate has id:", data.candidate.id);
        console.log("[Mark Interview Completed] Candidate has name:", data.candidate.name);
        setCandidate(data.candidate);
        toast.success(data.message);
      } else {
        console.error("[Mark Interview Completed] Invalid response:", data);
        toast.error(data.error || 'Failed to mark interview completed');
      }
    } catch (error) {
      console.error("[Mark Interview Completed] Error:", error);
      console.error("[Mark Interview Completed] Error response:", error.response?.data);
      const message = error.response?.data?.error || 'Failed to mark interview completed';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleSelect = async () => {
    setUpdating(true);
    try {
      console.log("[Select] API call starting");
      const { data } = await api.post(`/hr/candidates/${candidateId}/select/`);
      console.log("[Select] API response:", data);
      
      if (data.success && data.candidate) {
        setCandidate(data.candidate);
        toast.success(data.message);
      } else {
        toast.error(data.error || 'Failed to select candidate');
      }
    } catch (error) {
      console.error("[Select] Error:", error);
      const message = error.response?.data?.error || 'Failed to select candidate';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm('Are you sure you want to reject this candidate?')) {
      return;
    }
    setUpdating(true);
    try {
      console.log("[Reject] API call starting");
      const { data } = await api.post(`/hr/candidates/${candidateId}/reject/`);
      console.log("[Reject] API response:", data);
      
      if (data.success && data.candidate) {
        setCandidate(data.candidate);
        toast.success(data.message);
      } else {
        toast.error(data.error || 'Failed to reject candidate');
      }
    } catch (error) {
      console.error("[Reject] Error:", error);
      const message = error.response?.data?.error || 'Failed to reject candidate';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleCreateOffer = async () => {
    // If a draft is selected, redirect to builder with clone option
    if (selectedDraft) {
      navigate(`/hr/builder?candidate_id=${candidateId}&clone_draft_id=${selectedDraft}`);
      toast.success('Cloning selected draft for this candidate...');
      return;
    }

    // Validation
    if (!offerForm.component_template_id) {
      toast.error('Please select an offer builder template or a draft');
      return;
    }

    setUpdating(true);
    try {
      const today = new Date();
      const defaultJoining = today.toISOString().split('T')[0];
      const defaultExpiry = defaultOfferExpiryDate();

      console.log('[Create Offer] Sending offer data:', offerForm);
      const { data } = await api.post('/hr/offers/create_offer/', {
        candidate_id: candidateId,
        component_template_id: offerForm.component_template_id,
        ctc: offerForm.ctc ? parseFloat(offerForm.ctc) : 0,
        basic_salary: offerForm.basic_salary ? parseFloat(offerForm.basic_salary) : null,
        hra: offerForm.hra ? parseFloat(offerForm.hra) : null,
        allowances: offerForm.allowances ? parseFloat(offerForm.allowances) : null,
        bonus: offerForm.bonus ? parseFloat(offerForm.bonus) : null,
        joining_date: offerForm.joining_date || defaultJoining,
        work_shift: offerForm.work_shift,
        working_hours: offerForm.working_hours,
        probation_period: offerForm.probation_period,
        notice_period: offerForm.notice_period,
        offer_expiry_date: offerForm.offer_expiry_date || defaultExpiry
      });
      console.log('[Create Offer] Response:', data);
      
      if (data.success) {
        setCreatedOfferId(data.offer_id);
        setShowOfferModal(false);
        // Instead of showing preview modal, redirect to builder
        navigate(`/hr/builder?offer_id=${data.offer_id}`);
        toast.success('Opening Offer Letter Designer...');
      } else {
        toast.error(data.error || 'Failed to create offer');
      }
    } catch (error) {
      console.error('[Create Offer] Error:', error);
      console.error('[Create Offer] Error response:', error.response?.data);
      console.error('[Create Offer] Error status:', error.response?.status);
      const message = error.response?.data?.error || error.response?.data?.detail || 'Failed to create offer';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleDeclineOffer = async () => {
    if (!window.confirm('Are you sure you want to decline this offer?')) {
      return;
    }
    setUpdating(true);
    try {
      const { data } = await api.post(`/hr/candidates/${candidateId}/decline_offer/`);
      setCandidate({ 
        ...candidate, 
        status: data.status,
        offer_status: data.offer_status
      });
      toast.success(data.message);
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to decline offer';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const handleRevokeOffer = async () => {
    if (!window.confirm('Are you sure you want to revoke this sent offer?')) {
      return;
    }
    setUpdating(true);
    try {
      const { data } = await api.post(`/hr/candidates/${candidateId}/revoke_offer/`);
      if (data.success && data.candidate) {
        setCandidate(data.candidate);
        toast.success(data.message);
      } else {
        toast.error(data.error || 'Failed to revoke offer');
      }
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to revoke offer';
      toast.error(message);
    } finally {
      setUpdating(false);
    }
  };

  const getResumeUrl = () => {
    if (!candidate?.resume) return null;
    
    // If resume already starts with http(s), extract just the path
    if (candidate.resume.startsWith('http')) {
      const url = new URL(candidate.resume);
      return url.pathname; // Return just the path like /media/resumes/file.pdf
    }
    
    // Otherwise, ensure it starts with / for proxy
    return candidate.resume.startsWith('/') ? candidate.resume : `/${candidate.resume}`;
  };

  const getPassportPhotoUrl = () => {
    if (!candidate?.passport_photo) return null;
    if (candidate.passport_photo.startsWith('http')) {
      const url = new URL(candidate.passport_photo);
      return url.pathname;
    }
    return candidate.passport_photo.startsWith('/') ? candidate.passport_photo : `/${candidate.passport_photo}`;
  };

  if (loading) {
    return (
      <HRPageWrapper color="purple" layoutSidebar={true}>
        <div className="max-w-6xl mx-auto p-12 text-center text-gray-500">Loading...</div>
      </HRPageWrapper>
    );
  }

  if (!candidate || !candidate.id) {
    return (
      <HRPageWrapper color="purple" layoutSidebar={true}>
        <div className="max-w-6xl mx-auto p-12 text-center text-gray-500">Candidate not found</div>
      </HRPageWrapper>
    );
  }

  return (
    <HRPageWrapper color="purple" layoutSidebar={true}>
      <div className="max-w-full mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="mb-4">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        </div>

        {/* ATS-Style Split Layout */}
        <div className="flex flex-col lg:flex-row gap-0 h-[calc(100vh-140px)]">
          {/* Left Sidebar - Candidate Details (25%) */}
          <div className="lg:w-1/4 bg-gray-50 border-r border-gray-200 p-5 overflow-y-auto">
            {/* Candidate Header */}
            <div className="mb-6">
              {candidate.passport_photo ? (
                <img
                  src={getPassportPhotoUrl()}
                  alt={`${candidate.name} passport photo`}
                  className="w-16 h-20 object-cover rounded-lg border border-gray-200 mb-3 shadow-sm"
                />
              ) : (
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mb-3">
                  <User size={24} className="text-purple-600" />
                </div>
              )}
              <h1 className="text-lg font-bold text-gray-800 mb-1">{candidate.name}</h1>
              <div className="text-[11px] font-mono text-gray-500 mb-2 space-y-0.5">
                <p>Candidate ID: {candidate.candidate_id || '—'}</p>
                <p>Application ID: {candidate.application_id || '—'}</p>
              </div>
              <span className={`inline-block px-2 py-1 text-xs font-semibold rounded-full ${
                candidate.status === 'applied' ? 'bg-blue-100 text-blue-700' :
                candidate.status === 'shortlisted' ? 'bg-green-100 text-green-700' :
                candidate.status === 'interview' ? 'bg-purple-100 text-purple-700' :
                candidate.status === 'selected' ? 'bg-emerald-100 text-emerald-700' :
                candidate.status === 'hired' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>
                {candidate.status_display || candidate.status}
              </span>
            </div>

            {/* Contact Information */}
            <div className="space-y-3 mb-6">
              <div className="flex items-start gap-2">
                <Mail size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-xs text-gray-500">Email</p>
                  <p className="text-gray-800 break-all">{candidate.email || 'N/A'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Phone size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-xs text-gray-500">Phone</p>
                  <p className="text-gray-800">{candidate.phone || 'N/A'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <User size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-xs text-gray-500">Gender</p>
                  <p className="text-gray-800">
                    {candidate.gender === 'male'
                      ? 'Male'
                      : candidate.gender === 'female'
                        ? 'Female'
                        : candidate.gender === 'other'
                          ? 'Other'
                          : 'N/A'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar size={14} className="text-gray-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="text-xs text-gray-500">Applied On</p>
                  <p className="text-gray-800">{candidate.created_at ? new Date(candidate.created_at).toLocaleDateString() : 'N/A'}</p>
                </div>
              </div>
            </div>

            {/* Professional Details */}
            <div className="space-y-3 mb-6">
              <div>
                <p className="text-xs text-gray-500 mb-1">Experience</p>
                <p className="text-sm text-gray-800">{candidate.experience || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Current Company</p>
                <p className="text-sm text-gray-800">{candidate.current_company || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Expected Salary</p>
                <p className="text-sm text-gray-800">{candidate.expected_salary || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Notice Period</p>
                <p className="text-sm text-gray-800">{candidate.notice_period || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Address</p>
                <p className="text-sm text-gray-800">{candidate.address || 'N/A'}</p>
              </div>
            </div>

            {/* Interview Details */}
            {candidate.status === 'interview' && (
              <div className="mb-6 p-3 bg-purple-50 rounded-lg border border-purple-200">
                <p className="text-xs font-semibold text-purple-700 mb-2 flex items-center gap-1">
                  <Video size={12} />
                  Interview Details
                </p>
                <div className="space-y-2">
                  {candidate.interview_date && (
                    <div className="flex items-start gap-2">
                      <Clock size={12} className="text-purple-500 mt-0.5 flex-shrink-0" />
                      <div className="text-xs">
                        <p className="text-purple-600">Scheduled</p>
                        <p className="text-purple-800">
                          {formatInterviewDateTime(
                            candidate.active_scheduled_interview?.scheduled_start
                              || candidate.interview_date,
                            candidate.active_scheduled_interview?.timezone,
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                  {candidate.interview_type && (
                    <div className="flex items-start gap-2">
                      <MapPin size={12} className="text-purple-500 mt-0.5 flex-shrink-0" />
                      <div className="text-xs">
                        <p className="text-purple-600">Type</p>
                        <p className="text-purple-800 capitalize">{candidate.interview_type}</p>
                      </div>
                    </div>
                  )}
                  {candidate.interview_type === 'online' && candidate.interview_meeting_link && (
                    <div className="flex items-start gap-2">
                      <Video size={12} className="text-purple-500 mt-0.5 flex-shrink-0" />
                      <div className="text-xs min-w-0">
                        <p className="text-purple-600">Meeting link</p>
                        <a
                          href={candidate.interview_meeting_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-800 break-all underline hover:text-purple-950"
                        >
                          {candidate.interview_meeting_link}
                        </a>
                      </div>
                    </div>
                  )}
                  {candidate.interview_type === 'offline' && candidate.interview_venue_address && (
                    <div className="flex items-start gap-2">
                      <MapPin size={12} className="text-purple-500 mt-0.5 flex-shrink-0" />
                      <div className="text-xs">
                        <p className="text-purple-600">Venue</p>
                        <p className="text-purple-800 whitespace-pre-wrap">{candidate.interview_venue_address}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <CheckCircle size={12} className={`mt-0.5 flex-shrink-0 ${candidate.interview_status === 'completed' ? 'text-green-500' : 'text-amber-500'}`} />
                    <div className="text-xs">
                      <p className="text-purple-600">Status</p>
                      <p className="text-purple-800 capitalize">{candidate.interview_status}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Offer Details */}
            {(candidate.status === 'selected' || candidate.offer_status !== 'pending') && candidate.offered_salary && (
              <div className="mb-6 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                <p className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1">
                  <DollarSign size={12} />
                  Offer Details
                </p>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <DollarSign size={12} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                    <div className="text-xs">
                      <p className="text-emerald-600">Offered Salary</p>
                      <p className="text-emerald-800">₹{candidate.offered_salary}</p>
                    </div>
                  </div>
                  {candidate.joining_date && (
                    <div className="flex items-start gap-2">
                      <CalendarCheck size={12} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                      <div className="text-xs">
                        <p className="text-emerald-600">Joining Date</p>
                        <p className="text-emerald-800">{new Date(candidate.joining_date).toLocaleDateString()}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <CheckCircle size={12} className={`mt-0.5 flex-shrink-0 ${candidate.offer_status === 'accepted' ? 'text-green-500' : candidate.offer_status === 'declined' ? 'text-red-500' : 'text-amber-500'}`} />
                    <div className="text-xs">
                      <p className="text-emerald-600">Offer Status</p>
                      <p className="text-emerald-800 capitalize">{candidate.offer_status}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Cover Letter */}
            {candidate.cover_letter && (
              <div className="mb-6">
                <p className="text-xs text-gray-500 mb-2">Cover Letter</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap bg-white p-3 rounded-lg border border-gray-200">
                  {candidate.cover_letter}
                </p>
              </div>
            )}
          </div>

          {/* Right Panel - Resume Viewer (75%) */}
          <div className="lg:w-3/4 bg-white flex flex-col">
            {/* Action Bar */}
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-800">Resume</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePreviousCandidate()}
                  disabled={navigating || jobCandidates.length === 0 || jobCandidates.findIndex(c => c.id == candidateId) === 0}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-gray-600 hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  <ChevronLeft size={16} />
                  Previous
                </button>
                <button
                  onClick={() => handleNextCandidate()}
                  disabled={navigating || jobCandidates.length === 0 || jobCandidates.findIndex(c => c.id == candidateId) === jobCandidates.length - 1}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  Next
                  <ChevronRight size={16} />
                </button>
                <div className="w-px h-8 bg-gray-300 mx-2"></div>
                
                {/* Status-based Action Buttons */}
                
                {/* Applied Status - Shortlist or Reject */}
                {candidate.status === 'applied' && (
                  <>
                    <button
                      onClick={() => handleStatusUpdate('shortlisted')}
                      disabled={updating}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                    >
                      <CheckCircle size={16} />
                      Shortlist
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={updating}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                    >
                      <XCircle size={16} />
                      Reject
                    </button>
                  </>
                )}

                {/* Shortlisted Status - Move to Interview */}
                {candidate.status === 'shortlisted' && (
                  <>
                    <button
                      onClick={handleMoveToInterview}
                      disabled={updating}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                    >
                      <Video size={16} />
                      Move to Interview
                    </button>
                    <button
                      onClick={openScheduleModal}
                      disabled={updating}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                    >
                      <Clock size={16} />
                      Schedule Interview
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={updating}
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                    >
                      <XCircle size={16} />
                      Reject
                    </button>
                  </>
                )}

                {/* Interview Status - Schedule, Complete, Select, Reject */}
                {candidate.status === 'interview' && (
                  <>
                    {!candidate.interview_date ? (
                      <button
                        onClick={openScheduleModal}
                        disabled={updating}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                      >
                        <Clock size={16} />
                        Schedule Interview
                      </button>
                    ) : candidate.interview_status !== 'completed' ? (
                      <>
                        <button
                          onClick={openRescheduleModal}
                          disabled={updating}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          <Clock size={16} />
                          Reschedule Interview
                        </button>
                        <button
                          onClick={handleMarkInterviewCompleted}
                          disabled={updating}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          <CheckCircle size={16} />
                          Mark Completed
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={handleSelect}
                          disabled={updating}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          <CheckCircle size={16} />
                          Select
                        </button>
                        <button
                          onClick={handleReject}
                          disabled={updating}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          <XCircle size={16} />
                          Reject
                        </button>
                      </>
                    )}
                  </>
                )}

                {/* Selected Status - Offer Logic */}
                {candidate.status === 'selected' && (
                  <>
                    {/* CASE 1: No offer sent yet (Pending) */}
                    {candidate.offer_status === 'pending' && (
                      <>
                        <button
                          onClick={() => {
                            if (USE_NEW_OFFER_BUILDER) {
                              navigate(`/hr/builder?candidate_id=${candidateId}`);
                            } else {
                              setShowOfferModal(true);
                            }
                          }}
                          disabled={updating}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          <DollarSign size={16} />
                          {USE_NEW_OFFER_BUILDER ? 'Offer Builder' : 'Create Offer'}
                        </button>
                        <button
                          onClick={handleReject}
                          disabled={updating}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          <XCircle size={16} />
                          Reject
                        </button>
                      </>
                    )}

                    {/* CASE 2: Offer Sent (Waiting for candidate) */}
                    {candidate.offer_status === 'sent' && (
                      <button
                        onClick={handleRevokeOffer}
                        disabled={updating}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                      >
                        <RotateCcw size={16} />
                        Revoke Offer
                      </button>
                    )}

                    {/* CASE 3: Manual overrides (if salary exists but still pending, show accept/decline) */}
                    {/* This covers the local testing where candidate is in WiFi */}
                    {candidate.offer_status === 'pending' && candidate.offered_salary && (
                      <>
                        <button
                          onClick={handleAcceptOffer}
                          disabled={updating}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          <CheckCircle size={16} />
                          Accept Offer
                        </button>
                        <button
                          onClick={handleDeclineOffer}
                          disabled={updating}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                          <XCircle size={16} />
                          Decline Offer
                        </button>
                      </>
                    )}
                  </>
                )}

                {/* Hired Status - Show hired badge */}
                {candidate.status === 'hired' && (
                  <span className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-amber-700 bg-amber-100 rounded-lg">
                    <CheckCircle size={16} />
                    Hired
                  </span>
                )}

                {/* Rejected Status - Show rejected badge */}
                {candidate.status === 'rejected' && (
                  <span className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-red-700 bg-red-100 rounded-lg">
                    <XCircle size={16} />
                    Rejected
                  </span>
                )}
              </div>
            </div>

            {/* Resume Viewer */}
            <div className="flex-1 overflow-hidden relative">
              {candidate.resume ? (
                <div className="h-full flex flex-col">
                  <iframe
                    src={getResumeUrl()}
                    className="w-full h-full border-0"
                    title="Resume"
                    style={{ display: 'block' }}
                  />
                  <div className="absolute bottom-4 right-4 flex gap-2">
                    <button
                      onClick={handleDownloadResume}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors shadow-lg"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => window.open(getResumeUrl(), '_blank')}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-lg"
                    >
                      Open in New Tab
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <Briefcase size={48} className="mx-auto mb-4 text-gray-300" />
                    <p>No resume uploaded</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Interview Scheduling Modal */}
        {showScheduleModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                {scheduleModalMode === 'reschedule' ? 'Reschedule Interview' : 'Schedule Interview'}
              </h3>
              {candidate?.name ? (
                <p className="text-sm text-gray-600 mb-4">{candidate.name}</p>
              ) : null}
              <ScheduleInterviewFormFields
                form={scheduleForm}
                onChange={setScheduleForm}
                offlineDefaults={offlineInterviewDefaults}
              />
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowScheduleModal(false)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleScheduleInterview}
                  disabled={updating || !scheduleForm.date || !scheduleForm.time}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 rounded-lg transition-colors"
                >
                  {updating
                    ? (scheduleModalMode === 'reschedule' ? 'Rescheduling...' : 'Scheduling...')
                    : (scheduleModalMode === 'reschedule' ? 'Reschedule' : 'Schedule')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Offer Creation Modal */}
        {showOfferModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
              <h3 className="text-xl font-semibold text-gray-800 mb-6">Create Offer</h3>
              
              <div className="space-y-6">
                {/* Draft Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Use an existing Draft (Optional)
                  </label>
                  <select
                    value={selectedDraft}
                    onChange={(e) => {
                      setSelectedDraft(e.target.value);
                      if (e.target.value) {
                        setSelectedTemplate('');
                        setOfferForm(prev => ({ ...prev, component_template_id: '' }));
                      }
                    }}
                    disabled={loadingDrafts}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100 mb-1"
                  >
                    <option value="">-- Select a draft to copy from --</option>
                    {drafts.map((draft) => (
                      <option key={draft.id} value={draft.id}>
                        {draft.candidate_name || 'Unnamed'} - {draft.job_title || 'No Title'} ({new Date(draft.updated_at).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-gray-400 uppercase font-bold">Recommended if you want to reuse a previously saved layout</p>
                </div>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-gray-400 font-bold">OR</span></div>
                </div>

                {/* Template Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Offer Builder Template <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => {
                      handleTemplateChange(e.target.value);
                      if (e.target.value) setSelectedDraft('');
                    }}
                    disabled={loadingTemplates}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-gray-100"
                  >
                    <option value="">Select a template...</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  {loadingTemplates && (
                    <p className="text-sm text-gray-500 mt-1">Loading builder templates...</p>
                  )}
                </div>

                {(selectedTemplate || selectedDraft) && (
                  <p className="text-sm text-gray-600 border-t pt-4">
                    {selectedDraft ? 'Selected draft will be used as a starting point for this candidate.' : 'Selected template will open directly in editor for full content editing.'}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-4 border-t pt-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Joining date
                    </label>
                    <input
                      type="date"
                      value={offerForm.joining_date || ''}
                      onChange={(e) => setOfferForm((prev) => ({ ...prev, joining_date: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Last date to accept offer
                    </label>
                    <input
                      type="date"
                      min={todayISODate()}
                      value={offerForm.offer_expiry_date || defaultOfferExpiryDate()}
                      onChange={(e) => setOfferForm((prev) => ({ ...prev, offer_expiry_date: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <p className="mt-1 text-[10px] text-gray-400">Candidate must accept on or before this date</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6 pt-4 border-t">
                <button
                  onClick={() => {
                    setShowOfferModal(false);
                    setOfferForm({
                      component_template_id: '',
                      ctc: '',
                      basic_salary: '',
                      hra: '',
                      allowances: '',
                      bonus: '',
                      joining_date: '',
                      work_shift: '',
                      working_hours: '',
                      probation_period: '',
                      notice_period: '',
                      offer_expiry_date: defaultOfferExpiryDate()
                    });
                    setSelectedTemplate('');
                    setSelectedDraft('');
                  }}
                  className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateOffer}
                  disabled={updating || (!selectedTemplate && !selectedDraft)}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                >
                  {updating ? 'Opening...' : 'Open Template Editor'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </HRPageWrapper>
  );
}
