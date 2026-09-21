import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import HRPageWrapper from '../components/HR/HRPageWrapper';
import api from '../api';
import toast from 'react-hot-toast';
import { Briefcase, ArrowLeft, XCircle, Trash2, Share2, FileText, Plus } from 'lucide-react';
import DocumentTypeModal from '../components/HR/DocumentTypeModal';
import HRForm from '../components/HR/HRForm';
import ReusableCard from '../components/HR/ReusableCard';
import {
  jobAcceptsApplications,
  isJobExpired,
  localTodayString,
  validateHrExpiryDate,
  validateJobDraftFields,
} from '../hr/recruitmentLifecycle';
import { isFromSetupWizard, withPreservedReturn } from './hr/setupWizardUtils';
import { getJobApplyUrl, openJobApplyForm } from '../utils/publicUrls';
import { shareJobApplyLink } from '../utils/shareJobApplyLink';

export default function JobForm() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromSetupWizard = isFromSetupWizard(searchParams);
  const setupWizardRoute = withPreservedReturn('/hr/settings/organization', searchParams);
  const { jobId } = useParams();
  const isEditMode = !!jobId;
  const [departments, setDepartments] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [job, setJob] = useState(null);
  const [formStatus, setFormStatus] = useState(null);
  const [formExpiryDate, setFormExpiryDate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [latestFormData, setLatestFormData] = useState({});
  const [documentTypes, setDocumentTypes] = useState([]);
  const [docSelections, setDocSelections] = useState({});
  const [docModalOpen, setDocModalOpen] = useState(false);

  useEffect(() => {
    fetchDepartments();
    fetchDesignations();
    fetchDocumentTypes();
    if (isEditMode) {
      fetchJob();
    }
  }, [jobId]);

  async function fetchDocumentTypes() {
    try {
      const { data } = await api.get('/hr/document-types/', { params: { limit: 500 } });
      const list = data.results || data;
      setDocumentTypes(Array.isArray(list) ? list.filter((d) => d.is_active !== false) : []);
    } catch (error) {
      console.error('Failed to load document types', error);
    }
  }

  function applyJobDocumentRequirements(requirements) {
    const next = {};
    (requirements || []).forEach((req) => {
      const typeId = req.document_type;
      next[typeId] = {
        selected: true,
        is_required: req.is_required !== false,
        display_order: req.display_order ?? 0,
      };
    });
    setDocSelections(next);
  }

  async function fetchDepartments() {
    try {
      const { data } = await api.get('/hr/departments/');
      setDepartments(data.results || data);
    } catch (error) {
      toast.error('Failed to load departments');
    }
  }

  async function fetchDesignations() {
    try {
      const { data } = await api.get('/hr/designations/', { params: { active: 'true' } });
      setDesignations(data.results || data);
    } catch (error) {
      toast.error('Failed to load designations');
    }
  }

  async function fetchJob() {
    setLoading(true);
    try {
      const { data } = await api.get(`/hr/job-openings/${jobId}/`);
      setJob(data);
      setFormStatus(data.status);
      setFormExpiryDate(data.expiry_date ? data.expiry_date.split('T')[0] : '');
      applyJobDocumentRequirements(data.document_requirements);
      setIsDirty(false);
    } catch (error) {
      toast.error('Failed to load job details');
      navigate('/hr/recruitment/jobs');
    } finally {
      setLoading(false);
    }
  }

  const handleFormChange = useCallback((formData) => {
    setIsDirty(true);
    setLatestFormData(formData);
    if (formData.status !== undefined) {
      setFormStatus(formData.status);
    }
    if (formData.expiry_date !== undefined) {
      setFormExpiryDate(formData.expiry_date);
    }
  }, []);

  const minExpiryDate = localTodayString();

  const buildDocumentRequirements = useCallback(() => (
    documentTypes
      .map((docType, index) => {
        const sel = docSelections[docType.id];
        if (!sel?.selected) return null;
        return {
          document_type: docType.id,
          is_required: sel.is_required !== false,
          allow_multiple: false,
          display_order: index,
        };
      })
      .filter(Boolean)
  ), [documentTypes, docSelections]);

  const buildPayload = useCallback((data, status) => {
    const payload = {
      title: data.title,
      designation: data.designation || null,
      department: data.department,
      description: data.description || '',
      required_skills: data.required_skills || '',
      experience_required: data.experience_required || '',
      salary_range: data.salary_range || '',
      location: data.location || '',
      employment_type: data.employment_type || 'full_time',
      status,
      vacancies: data.vacancies || 1,
      expiry_date: data.expiry_date || null,
      document_requirements: buildDocumentRequirements(),
    };

    if (data.designation) {
      const selected = designations.find((item) => String(item.id) === String(data.designation));
      if (selected?.name) payload.title = selected.name;
    }

    return payload;
  }, [buildDocumentRequirements, designations]);

  const saveJob = useCallback(async (data, status, { successMessage }) => {
    if (status === 'draft') {
      const draftError = validateJobDraftFields(data, designations);
      if (draftError) {
        toast.error(draftError);
        return false;
      }
    } else {
      const expiryError = validateHrExpiryDate(data.expiry_date);
      if (expiryError) {
        toast.error(expiryError);
        return false;
      }
    }

    const payload = buildPayload(data, status);

    try {
      if (isEditMode) {
        const { data: updated } = await api.put(`/hr/job-openings/${jobId}/`, payload);
        setJob(updated);
        setFormStatus(updated.status);
      } else {
        await api.post('/hr/job-openings/', payload);
      }
      toast.success(successMessage);
      navigate('/hr/recruitment/jobs');
      return true;
    } catch (error) {
      console.error('Error saving job:', error);
      const message = error.response?.data?.detail ||
                      Object.values(error.response?.data || {})[0]?.[0] ||
                      'Failed to save job opening';
      toast.error(message);
      return false;
    }
  }, [buildPayload, designations, isEditMode, jobId, navigate]);

  const handlePublish = async (data) => {
    setFormLoading(true);
    const hasValidExpiry = !validateHrExpiryDate(data.expiry_date);
    let publishStatus = 'open';
    if (isEditMode && data.status === 'on_hold') {
      publishStatus = 'on_hold';
    } else if (isEditMode && data.status === 'closed' && !hasValidExpiry) {
      publishStatus = 'closed';
    }
    await saveJob(data, publishStatus, {
      successMessage: isEditMode ? 'Job opening updated successfully' : 'Job opening created successfully',
    });
    setFormLoading(false);
  };

  const handleSaveDraft = async (data) => {
    setDraftLoading(true);
    await saveJob(data, 'draft', { successMessage: 'Draft saved successfully' });
    setDraftLoading(false);
  };

  const leaveForm = useCallback(() => {
    navigate(fromSetupWizard ? setupWizardRoute : '/hr/recruitment/jobs');
  }, [fromSetupWizard, navigate, setupWizardRoute]);

  const handleCancel = useCallback(async (formData) => {
    const data = formData || latestFormData;
    if (!isDirty) {
      leaveForm();
      return;
    }

    const draftError = validateJobDraftFields(data, designations);
    if (draftError) {
      if (window.confirm('You have unsaved changes but not enough data to save a draft. Leave anyway?')) {
        leaveForm();
      }
      return;
    }

    if (window.confirm('Save as draft before leaving?')) {
      setDraftLoading(true);
      await saveJob(data, 'draft', { successMessage: 'Draft saved successfully' });
      setDraftLoading(false);
      return;
    }

    leaveForm();
  }, [designations, isDirty, latestFormData, leaveForm, saveJob]);

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this job opening? This action cannot be undone.')) {
      return;
    }

    try {
      await api.delete(`/hr/job-openings/${jobId}/`);
      toast.success('Job opening deleted successfully');
      navigate('/hr/recruitment/jobs');
    } catch (error) {
      console.error('Error deleting job:', error);
      toast.error('Failed to delete job opening');
    }
  };

  const formFields = useMemo(() => {
    const fields = [
      {
        name: 'designation',
        label: 'Designation',
        type: 'select',
        required: false,
        options: [{ label: 'Select designation (optional)', value: '' }, ...designations.map((d) => ({ label: d.name, value: d.id }))],
      },
      { name: 'title', label: 'Job Title', type: 'text', required: true, placeholder: 'Enter job title' },
      { name: 'department', label: 'Department', type: 'select', required: true, options: departments.map(d => ({ label: d.name, value: d.id })) },
      { name: 'employment_type', label: 'Employment Type', type: 'select', required: false, options: [
        { label: 'Full Time', value: 'full_time' },
        { label: 'Part Time', value: 'part_time' },
        { label: 'Contract', value: 'contract' },
        { label: 'Internship', value: 'internship' },
      ]},
      { name: 'vacancies', label: 'Number of Vacancies', type: 'number', required: false, min: 1, placeholder: 'e.g., 5' },
    ];

    if (isEditMode) {
      fields.push({
        name: 'status',
        label: 'Status',
        type: 'select',
        required: true,
        options: [
          { label: 'Open', value: 'open' },
          { label: 'Closed', value: 'closed' },
          { label: 'On Hold', value: 'on_hold' },
        ],
      });
    }

    fields.push(
      { name: 'location', label: 'Location', type: 'text', placeholder: 'e.g., New York, Remote' },
      {
        name: 'expiry_date',
        label: 'Last Date to Apply',
        type: 'date',
        required: false,
        min: minExpiryDate,
        hint: 'Required when publishing. Must be today or a future date.',
      },
      { name: 'experience_required', label: 'Experience Required', type: 'text', placeholder: 'e.g., 2-3 years' },
      { name: 'salary_range', label: 'Salary Range', type: 'text', placeholder: 'e.g., $50k - $70k' },
      {
        name: 'required_skills',
        label: 'Required Skills',
        type: 'tags',
        fullWidth: true,
        placeholder: 'Type a skill and press Enter',
        splitSpacesOnLoad: false,
        hint: 'Press Enter or comma to add each skill (spaces are allowed within a skill)',
      },
      {
        name: 'description',
        label: 'Job Description',
        type: 'textarea',
        fullWidth: true,
        rows: 6,
        placeholder: 'Describe the job role and responsibilities...',
      },
    );

    return fields;
  }, [departments, designations, isEditMode, minExpiryDate]);

  const effectiveJob = useMemo(() => {
    if (!job) return null;
    const status = formStatus ?? job.status;
    const expiry_date = formExpiryDate ?? (job.expiry_date ? job.expiry_date.split('T')[0] : null);
    return {
      ...job,
      status,
      expiry_date,
      is_active: status === 'open',
      is_archived: status === 'archived',
    };
  }, [job, formStatus, formExpiryDate]);

  const acceptsApplications = useMemo(() => {
    if (!effectiveJob) return false;
    if (formStatus === job?.status && job?.accepts_applications !== undefined) {
      return job.accepts_applications;
    }
    return jobAcceptsApplications(effectiveJob);
  }, [effectiveJob, formStatus, job]);

  const applyLink = effectiveJob?.job_code && acceptsApplications
    ? getJobApplyUrl(effectiveJob)
    : null;
  const applyLinkBlocked = effectiveJob?.job_code && !acceptsApplications;
  const expiredPreview = effectiveJob && isJobExpired(effectiveJob);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const toggleDocSelection = (typeId, selected) => {
    markDirty();
    setDocSelections((prev) => ({
      ...prev,
      [typeId]: {
        selected,
        is_required: prev[typeId]?.is_required !== false,
        display_order: prev[typeId]?.display_order ?? 0,
      },
    }));
  };

  const toggleDocRequired = (typeId, isRequired) => {
    markDirty();
    setDocSelections((prev) => ({
      ...prev,
      [typeId]: {
        ...prev[typeId],
        selected: true,
        is_required: isRequired,
      },
    }));
  };

  function handleDocumentTypeSaved(savedDoc) {
    if (!savedDoc?.id || savedDoc.is_active === false) return;
    markDirty();
    setDocumentTypes((prev) => {
      const without = prev.filter((d) => d.id !== savedDoc.id);
      return [...without, savedDoc];
    });
    setDocSelections((prev) => ({
      ...prev,
      [savedDoc.id]: {
        selected: true,
        is_required: savedDoc.mandatory !== false,
        display_order: prev[savedDoc.id]?.display_order ?? 0,
      },
    }));
  }

  const documentRequirementsSection = (
    <div className="mt-2 rounded-xl border border-purple-100 bg-purple-50/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-purple-700" />
          <h3 className="text-sm font-semibold text-purple-900">Required documents for this job</h3>
        </div>
        <button
          type="button"
          onClick={() => setDocModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs font-semibold text-purple-800 shadow-sm hover:bg-purple-50"
        >
          <Plus size={14} />
          Add document type
        </button>
      </div>
      <p className="text-xs text-purple-800/80 mb-4">
        Select which documents candidates must upload for this role. Requirements are frozen when a candidate applies.
      </p>
      {documentTypes.length === 0 ? (
        <p className="text-sm text-gray-600">
          No document types yet. Add one above, then select it for this job.
        </p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {[...documentTypes]
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
            .map((docType) => {
              const sel = docSelections[docType.id] || {};
              const checked = Boolean(sel.selected);
              return (
                <li
                  key={docType.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-white bg-white px-3 py-2 shadow-sm"
                >
                  <label className="flex items-center gap-2 flex-1 min-w-[140px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleDocSelection(docType.id, e.target.checked)}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm font-medium text-gray-900">{docType.name}</span>
                  </label>
                  {checked && (
                    <div className="flex items-center gap-3 text-xs">
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`req-${docType.id}`}
                          checked={sel.is_required !== false}
                          onChange={() => toggleDocRequired(docType.id, true)}
                        />
                        Required
                      </label>
                      <label className="inline-flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`req-${docType.id}`}
                          checked={sel.is_required === false}
                          onChange={() => toggleDocRequired(docType.id, false)}
                        />
                        Optional
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </div>
  );

  const defaultValues = useMemo(() => {
    if (!job) {
      return {
        employment_type: 'full_time',
        vacancies: 1,
      };
    }
    const editStatus = job.status === 'draft' ? 'open' : job.status;
    return {
      designation: job.designation || '',
      title: job.title,
      department: job.department,
      vacancies: job.vacancies || 1,
      employment_type: job.employment_type,
      status: editStatus,
      location: job.location,
      expiry_date: job.expiry_date ? job.expiry_date.split('T')[0] : '',
      experience_required: job.experience_required,
      salary_range: job.salary_range,
      required_skills: job.required_skills,
      description: job.description,
    };
  }, [job]);

  if (loading) {
    return (
      <HRPageWrapper color="purple" layoutSidebar={true}>
        <div className="max-w-3xl mx-auto py-12 text-center">
          <div className="text-gray-500">Loading job details...</div>
        </div>
      </HRPageWrapper>
    );
  }

  return (
    <HRPageWrapper color="purple" layoutSidebar={true}>
      <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {fromSetupWizard ? (
            <Link
              to={setupWizardRoute}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100"
            >
              <ArrowLeft size={16} />
              Back to Organization Settings
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => handleCancel(latestFormData)}
              className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
            >
              <ArrowLeft size={16} />
              Back to Recruitment
            </button>
          )}
        </div>

        <ReusableCard
          title={isEditMode ? 'Edit Job Opening' : 'Create Job Opening'}
          icon={Briefcase}
          theme="purple"
          headerAction={
            <div className="flex items-center gap-2">
              {isEditMode && (
                <button
                  onClick={handleDelete}
                  className="text-red-500 hover:text-red-700"
                  title="Delete Job"
                >
                  <Trash2 size={20} />
                </button>
              )}
              <button
                type="button"
                onClick={() => handleCancel(latestFormData)}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle size={20} />
              </button>
            </div>
          }
        >
          {isEditMode && applyLink && (
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <p className="text-xs font-medium text-blue-700 mb-2">Application Link</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={applyLink}
                      className="flex-1 px-3 py-2 text-sm text-blue-700 bg-white border border-blue-300 rounded-lg focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => shareJobApplyLink(effectiveJob, { openTab: false })}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                      Copy
                    </button>
                    <a
                      href={applyLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        e.preventDefault();
                        if (openJobApplyForm(effectiveJob)) {
                          toast.success('Application form opened in new tab');
                        }
                      }}
                      className="px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-300 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      Open form
                    </a>
                  </div>
                </div>
                <Share2 size={20} className="text-blue-600" />
              </div>
            </div>
          )}
          {isEditMode && applyLinkBlocked && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm font-medium text-amber-900">Applications Closed</p>
              <p className="mt-1 text-sm text-amber-800">
                {expiredPreview
                  ? 'The application deadline has passed. Set a future last date to apply and save — the job will reopen automatically.'
                  : 'This position is not accepting applications. Set status to Open with a valid future application deadline, or save with a valid deadline to reopen automatically.'}
              </p>
            </div>
          )}
          {departments.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-red-600 mb-4">No departments available.</p>
              <p className="text-sm text-gray-500 mb-4">Create a department first to add job openings.</p>
              <button
                type="button"
                onClick={() => navigate('/hr/operations/departments')}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Go to Onboarding
              </button>
            </div>
          ) : (
            <HRForm
              fields={formFields}
              onSubmit={handlePublish}
              onChange={handleFormChange}
              onCancel={handleCancel}
              onSecondaryAction={handleSaveDraft}
              secondaryActionLabel="Save draft"
              submitLabel={isEditMode ? 'Update Job' : 'Create Job'}
              theme="purple"
              loading={formLoading}
              secondaryLoading={draftLoading}
              defaultValues={defaultValues}
              footer={documentRequirementsSection}
            />
          )}
        </ReusableCard>
      </div>

      <DocumentTypeModal
        open={docModalOpen}
        mode="create"
        onClose={() => setDocModalOpen(false)}
        onSaved={handleDocumentTypeSaved}
      />
    </HRPageWrapper>
  );
}
