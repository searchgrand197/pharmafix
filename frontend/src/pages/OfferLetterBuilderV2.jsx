import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import HRPageWrapper from '../components/HR/HRPageWrapper';
import api from '../api';
import toast from 'react-hot-toast';
import {
  blocksHaveVariables,
  buildSubstitutionContext,
  defaultOfferExpiryDate,
  hydrateOfferLetterContent,
  isJoiningDateRowLabel,
  isOfferExpiryDateRowLabel,
  syncJoiningDateInBlocks,
  syncOfferExpiryDateInBlocks,
  syncPositionDetailsInBlocks,
  toDateInputValue,
  todayISODate,
} from '../utils/offerLetterVariables';
import { 
  Save, FileText, Send, ArrowLeft, Download, Briefcase, User, 
  DollarSign, Clock, Layout as LayoutIcon, Type, MousePointer2, 
  Image as ImageIcon, CheckCircle2, Plus, Trash2, 
  GripVertical, AlignLeft, AlignCenter, AlignRight, Columns,
  Eye, ZoomIn, ZoomOut, Layers, Maximize2, Undo2,
  ChevronDown, ChevronRight, PenLine, Palette, Sparkles,
} from 'lucide-react';

const SIDEBAR_INPUT =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';
const SIDEBAR_LABEL = 'mb-1.5 block text-xs font-medium text-slate-600';

function SidebarField({ label, hint, required, children }) {
  return (
    <div>
      <label className={SIDEBAR_LABEL}>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p> : null}
    </div>
  );
}

function SidebarPanel({ title, description, icon: Icon, open, onToggle, children, collapsible = true }) {
  const header = (
    <>
      {Icon ? <Icon size={17} className="shrink-0 text-indigo-600" /> : null}
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
      </div>
      {collapsible ? (
        open ? (
          <ChevronDown size={16} className="shrink-0 text-slate-400" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-slate-400" />
        )
      ) : null}
    </>
  );

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
        >
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">{header}</div>
      )}
      {(!collapsible || open) ? (
        <div className={`space-y-3 px-4 pb-4 pt-1 ${collapsible ? 'border-t border-slate-100' : ''}`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** CSS pixels at 96dpi — matches print pipeline expectations */
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

const THEMES = {
  corporate: {
    name: 'Corporate',
    primary: '#2E2A5E',
    secondary: '#F4F6F8',
    accent: '#1F4E79'
  },
  modern: {
    name: 'Modern',
    primary: '#111827',
    secondary: '#F9FAFB',
    accent: '#3B82F6'
  },
  startup: {
    name: 'Startup',
    primary: '#0F172A',
    secondary: '#ECFDF5',
    accent: '#10B981'
  }
};

/**
 * A robust contentEditable wrapper that prevents text reverting 
 * during re-renders by maintaining local state while focused.
 */
const SafeEditable = React.memo(({ value, onBlur, className, style, tagName: Tag = 'span', ...props }) => {
  const elementRef = useRef(null);
  const isFocused = useRef(false);

  // Sync value ONLY when not focused. This is the critical fix.
  useEffect(() => {
    if (elementRef.current && !isFocused.current) {
      if (elementRef.current.innerText !== value) {
        elementRef.current.innerText = value || '';
      }
    }
  }, [value]);

  const handleBlur = (e) => {
    isFocused.current = false;
    const newValue = e.target.innerText;
    if (onBlur && newValue !== value) {
      onBlur(newValue);
    }
  };

  const handleFocus = () => {
    isFocused.current = true;
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  return (
    <Tag
      ref={elementRef}
      contentEditable
      suppressContentEditableWarning
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPaste={handlePaste}
      className={`${className} outline-none focus:bg-blue-50 transition-all`}
      style={style}
      {...props}
    />
  );
});

SafeEditable.displayName = 'SafeEditable';

const INITIAL_LETTER_SECTION_FONTS = {
  ref_date: 13,
  candidate_meta: 14,
  salutation: 14,
  footer_note: 8,
  table_title: 13,
  table_cell: 14,
  signatory_name: 14,
  signatory_line: 12,
};

/** Body blocks are built with real values via hydrateOfferLetterContent — never {{variables}}. */
const INITIAL_DYNAMIC_CONTENT = [];

const INITIAL_STATE = {
  candidate_name: '',
  candidate_email: '',
  candidate_phone: '',
  candidate_address: '',
  candidate: null,
  job_title: '',
  department: '',
  reporting_manager: '',
  job_location: '',
  work_mode: 'In-office',
  joining_date: new Date().toISOString().split('T')[0],
  offer_expiry_date: defaultOfferExpiryDate(),
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
  hr_designation: 'HR Manager',
  hr_email: '',
  hr_phone: '',
  letter_title: 'OFFER OF EMPLOYMENT',
  subject_label: '',
  subject_value: '',
  ref_label: 'Ref:',
  date_label: 'Date:',
  to_label: 'To,',
  dear_label: 'Dear',
  signatory_label: 'Authorized Signatory',
  theme: 'corporate',
  font_size: 14,
  letter_title_font_size: 24,
  company_name_font_size: 16,
  candidate_name_font_size: 18,
  company_meta_font_size: 16,
  logo_config: { width: 120, height: 60, url: '' },
  company_block_config: { maxWidth: 280 },
  letter_section_fonts: { ...INITIAL_LETTER_SECTION_FONTS },
  company_website: '',
  signature_config: { position: 'right', size: 'md', url: '', offsetX: 0, offsetY: 0 },
  dynamic_content: INITIAL_DYNAMIC_CONTENT
};

export default function OfferLetterBuilderV2() {
  const { builderId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const candidateIdParam = searchParams.get('candidate_id');
  const offerIdParam = searchParams.get('offer_id');
  const cloneDraftIdParam = searchParams.get('clone_draft_id');
  
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [candidates, setCandidates] = useState([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [offerSettings, setOfferSettings] = useState(null);
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [activeControlTab, setActiveControlTab] = useState('fields');
  const [sidebarPanels, setSidebarPanels] = useState({
    company: false,
    advancedWording: false,
    contentBlocks: false,
    designAdvanced: false,
  });

  const toggleSidebarPanel = (key) => {
    setSidebarPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  /** Mobile / narrow: switch between editor drawer and full-width preview */
  const [mobileWorkspace, setMobileWorkspace] = useState('edit');

  const pageRef = useRef(null);
  const letterheadRef = useRef(null);
  const logoRef = useRef(null);
  const companyBlockRef = useRef(null);
  const hrSignatureAreaRef = useRef(null);
  const signatureImgRef = useRef(null);
  const previewStageRef = useRef(null);
  const [canvasScale, setCanvasScale] = useState(1);
  /** Base fit: by paper width ('width') or full page visible ('page') */
  const [fitMode, setFitMode] = useState('width');
  /** Applied on top of fit-derived base (0.5 – 1.6) */
  const [zoomMultiplier, setZoomMultiplier] = useState(1);
  /** Unscaled paper height (grows with content past one A4 page) */
  const [paperLayoutHeight, setPaperLayoutHeight] = useState(A4_HEIGHT);

  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDraggingCompanyBlock, setIsDraggingCompanyBlock] = useState(false);
  const [companyDragOffset, setCompanyDragOffset] = useState({ x: 0, y: 0 });
  const [isDraggingSignature, setIsDraggingSignature] = useState(false);
  const [sigDragOffset, setSigDragOffset] = useState({ x: 0, y: 0 });
  const [deletedBlocksStack, setDeletedBlocksStack] = useState([]);
  const deletedBlocksStackRef = useRef([]);
  useEffect(() => {
    deletedBlocksStackRef.current = deletedBlocksStack;
  }, [deletedBlocksStack]);

  const recomputeCanvasScale = useCallback(() => {
    const el = previewStageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    const margin = 48;
    const paperH = Math.max(A4_HEIGHT, paperLayoutHeight);
    const fitW = (cw - margin) / A4_WIDTH;
    const fitH = (ch - margin) / paperH;
    const base = fitMode === 'page' ? Math.min(fitW, fitH) : fitW;
    const clampedBase = Math.max(0.32, Math.min(base, 1.65));
    const next = Math.max(0.32, Math.min(clampedBase * zoomMultiplier, 2));
    setCanvasScale(next);
  }, [fitMode, zoomMultiplier, paperLayoutHeight]);

  useEffect(() => {
    const el = previewStageRef.current;
    if (!el) return undefined;
    recomputeCanvasScale();
    const ro = new ResizeObserver(() => recomputeCanvasScale());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recomputeCanvasScale, mobileWorkspace, activeControlTab]);

  useEffect(() => {
    let ro = null;
    const attach = () => {
      const node = pageRef.current;
      if (!node) return;
      const measure = () => {
        const h = node.offsetHeight;
        if (h < A4_HEIGHT * 0.9) return;
        setPaperLayoutHeight((prev) => {
          const next = Math.max(A4_HEIGHT, Math.ceil(h));
          return next === prev ? prev : next;
        });
      };
      measure();
      if (ro) ro.disconnect();
      ro = new ResizeObserver(() => measure());
      ro.observe(node);
    };
    attach();
    const raf = requestAnimationFrame(() => attach());
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    };
  }, [mobileWorkspace, activeControlTab]);

  useEffect(() => {
    document.title = 'Offer Builder';
    return () => {
      document.title = 'HMS – Hospital Management';
    };
  }, []);

  useEffect(() => {
    fetchCandidates();
    fetchOfferSettings();
    if (builderId) {
      fetchBuilderData();
      return;
    }
    if (cloneDraftIdParam) {
      fetchDraftToClone(cloneDraftIdParam, candidateIdParam);
    } else if (offerIdParam) {
      fetchOfferData(offerIdParam);
    } else if (candidateIdParam) {
      fetchCandidateData(candidateIdParam);
    }
  }, [builderId, candidateIdParam, offerIdParam, cloneDraftIdParam]);

  function settingsDefaults(settings) {
    if (!settings) return {};
    return {
      company_name: settings.organization_name || '',
      company_address: settings.organization_address || '',
      company_location: settings.organization_location || '',
      company_contact: settings.organization_contact || settings.company_email || '',
      company_website: settings.organization_website || '',
      company_email: settings.company_email || '',
      company_phone: settings.company_phone || '',
      hr_name: settings.hr_name || '',
      hr_designation: settings.hr_designation || 'HR Manager',
      hr_email: settings.hr_email || '',
      hr_phone: settings.hr_phone || '',
      logo_config: {
        ...INITIAL_STATE.logo_config,
        ...(settings.logo_config || {}),
        url: settings.logo_url || settings.logo_config?.url || '',
      },
      signature_config: {
        ...INITIAL_STATE.signature_config,
        ...(settings.signature_config || {}),
        url: settings.signature_url || settings.signature_config?.url || '',
      },
    };
  }

  function applySettingsDefaults(baseData, settings, { overwrite = false } = {}) {
    const defaults = settingsDefaults(settings);
    const merged = { ...baseData };
    if (defaults.company_name) {
      merged.company_name = defaults.company_name;
    }
    ['company_address', 'company_location', 'company_contact', 'company_website', 'hr_name', 'hr_designation', 'hr_email', 'hr_phone'].forEach((key) => {
      if (overwrite || !merged[key]) merged[key] = defaults[key] ?? merged[key];
    });
    merged.logo_config = {
      ...INITIAL_STATE.logo_config,
      ...(overwrite ? {} : (merged.logo_config || {})),
      ...(defaults.logo_config || {}),
      ...(overwrite ? {} : (merged.logo_config || {})),
    };
    if (overwrite || !merged.logo_config.url) {
      merged.logo_config.url = defaults.logo_config?.url || merged.logo_config.url || '';
    }
    merged.signature_config = {
      ...INITIAL_STATE.signature_config,
      ...(overwrite ? {} : (merged.signature_config || {})),
      ...(defaults.signature_config || {}),
      ...(overwrite ? {} : (merged.signature_config || {})),
    };
    if (overwrite || !merged.signature_config.url) {
      merged.signature_config.url = defaults.signature_config?.url || merged.signature_config.url || '';
    }
    return merged;
  }

  function buildPayloadForSave(currentFormData) {
    return hydrateOfferLetterContent(
      applySettingsDefaults(currentFormData, offerSettings),
      offerSettings,
    );
  }

  useEffect(() => {
    if (!offerSettings) return;
    setFormData((prev) => {
      const merged = applySettingsDefaults(prev, offerSettings);
      const blocks = merged.dynamic_content || [];
      const hasTerms = blocks.some((b) => b?.type === 'terms');
      const hasVars = blocksHaveVariables(blocks);
      if (!hasVars && blocks.length > 0 && hasTerms) {
        return merged;
      }
      return hydrateOfferLetterContent(merged, offerSettings);
    });
  }, [offerSettings]);

  async function resolveOfferSettings() {
    if (offerSettings) return offerSettings;
    const { data: settingsData } = await api.get('/hr/organization-settings/current/');
    setOfferSettings(settingsData);
    return settingsData;
  }

  function normalizeBuilderApiData(data) {
    return {
      ...data,
      joining_date: toDateInputValue(data.joining_date) || INITIAL_STATE.joining_date,
      offer_expiry_date: toDateInputValue(data.offer_expiry_date) || INITIAL_STATE.offer_expiry_date,
      logo_config: { ...INITIAL_STATE.logo_config, ...(data.logo_config || {}) },
      company_block_config: {
        ...INITIAL_STATE.company_block_config,
        ...(data.company_block_config || {}),
      },
      company_meta_font_size:
        data.company_meta_font_size ?? INITIAL_STATE.company_meta_font_size,
      letter_section_fonts: {
        ...INITIAL_LETTER_SECTION_FONTS,
        ...(data.letter_section_fonts || {}),
      },
      company_website: data.company_website ?? '',
      signature_config: { ...INITIAL_STATE.signature_config, ...(data.signature_config || {}) },
      dynamic_content: data.dynamic_content || [],
    };
  }

  function applyBuilderPayload(data, settings) {
    const normalized = normalizeBuilderApiData(data);
    const withSettings = applySettingsDefaults(normalized, settings);
    return hydrateOfferLetterContent(withSettings, settings);
  }

  async function findLatestBuilderDraftForCandidate(candidateId) {
    if (!candidateId) return null;
    const { data } = await api.get('/hr/offer-builder-v2/', {
      params: { candidate: candidateId, limit: 1 },
    });
    const rows = Array.isArray(data) ? data : (data.results || []);
    return rows[0] || null;
  }

  function mapOfferSnapshotToFormData(offer) {
    return {
      candidate: offer.candidate?.id ?? offer.candidate ?? null,
      candidate_name: offer.candidate_name || '',
      candidate_email: offer.candidate_email || '',
      candidate_address: offer.candidate_address || '',
      candidate_name_salutation: (offer.candidate_name || '').split(' ')[0],
      company_name: offer.company_name || '',
      company_address: offer.company_address || '',
      job_title: offer.job_title || '',
      department: offer.department || '',
      job_location: offer.job_location || '',
      joining_date: toDateInputValue(offer.joining_date) || INITIAL_STATE.joining_date,
      offer_expiry_date: toDateInputValue(offer.offer_expiry_date) || INITIAL_STATE.offer_expiry_date,
      basic_salary: offer.basic_salary != null ? String(offer.basic_salary) : '',
      hra: offer.hra != null ? String(offer.hra) : '',
      special_allowance: offer.allowances != null ? String(offer.allowances) : '',
      bonus: offer.bonus != null ? String(offer.bonus) : '',
      ctc: offer.ctc != null ? String(offer.ctc) : '',
      working_hours: offer.working_hours || '',
      shift: offer.work_shift || '',
      weekly_off: offer.weekly_off || '',
      probation_period: offer.probation_period || '',
      notice_period: offer.notice_period || '',
      hr_name: offer.hr_name || '',
      hr_designation: offer.hr_designation || '',
    };
  }

  async function loadBuilderDraftById(draftId, { replaceUrl = false } = {}) {
    const settings = await resolveOfferSettings();
    const { data } = await api.get(`/hr/offer-builder-v2/${draftId}/`);
    setFormData(applyBuilderPayload(data, settings));
    if (replaceUrl) {
      navigate(`/hr/builder/${draftId}`, { replace: true });
    }
  }

  async function fetchOfferSettings() {
    try {
      const { data } = await api.get('/hr/organization-settings/current/');
      setOfferSettings(data);
      if (!builderId && !candidateIdParam && !offerIdParam && !cloneDraftIdParam) {
        setFormData((prev) => hydrateOfferLetterContent(applySettingsDefaults(prev, data), data));
      }
    } catch (error) {
      console.error('Failed to load offer settings', error);
    }
  }

  async function fetchCandidates() {
    setLoadingCandidates(true);
    try {
      const { data } = await api.get('/hr/candidates/');
      setCandidates(data.results || data);
    } catch (error) {
      console.error('Error fetching candidates:', error);
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function fetchDraftToClone(draftId, candidateId) {
    setLoading(true);
    try {
      // 1. Fetch the draft layout
      const { data: draftData } = await api.get(`/hr/offer-builder-v2/${draftId}/`);
      
      // 2. Fetch the current candidate info
      const { data: candData } = await api.get(`/hr/candidates/${candidateId}/`);

      // 3. Merge: Keep draft design, use current candidate info
      const mergedData = {
        ...draftData,
        id: undefined, // Don't use the old draft's ID
        joining_date: toDateInputValue(draftData.joining_date) || INITIAL_STATE.joining_date,
        offer_expiry_date: toDateInputValue(draftData.offer_expiry_date) || INITIAL_STATE.offer_expiry_date,
        candidate: candData.id,
        candidate_name: candData.name,
        candidate_email: candData.email,
        candidate_phone: candData.phone,
        candidate_address: candData.address,
        candidate_name_salutation: candData.name.split(' ')[0],
        job_title: candData.designation_name || candData.job_opening_title || draftData.job_title,
        department: candData.department_name || draftData.department,
        
        // Ensure configs are normalized
        logo_config: { ...INITIAL_STATE.logo_config, ...(draftData.logo_config || {}) },
        company_block_config: {
          ...INITIAL_STATE.company_block_config,
          ...(draftData.company_block_config || {}),
        },
        company_meta_font_size:
          draftData.company_meta_font_size ?? INITIAL_STATE.company_meta_font_size,
        letter_section_fonts: {
          ...INITIAL_LETTER_SECTION_FONTS,
          ...(draftData.letter_section_fonts || {}),
        },
        company_website: draftData.company_website ?? '',
        signature_config: { ...INITIAL_STATE.signature_config, ...(draftData.signature_config || {}) },
        dynamic_content: draftData.dynamic_content && draftData.dynamic_content.length > 0 ? draftData.dynamic_content : INITIAL_DYNAMIC_CONTENT
      };

      setFormData(
        hydrateOfferLetterContent(applySettingsDefaults(mergedData, offerSettings), offerSettings),
      );
      toast.success('Draft layout loaded for this candidate');
    } catch (error) {
      console.error('Error cloning draft:', error);
      toast.error('Failed to clone draft layout');
    } finally {
      setLoading(false);
    }
  }

  async function fetchBuilderData() {
    setLoading(true);
    try {
      await loadBuilderDraftById(builderId);
    } catch (error) {
      toast.error('Failed to load builder data');
    } finally {
      setLoading(false);
    }
  }

  async function fetchOfferData(offerId) {
    setLoading(true);
    try {
      const { data: offer } = await api.get(`/hr/offers/${offerId}/`);
      const candidateId = offer.candidate?.id ?? offer.candidate;
      const draft = await findLatestBuilderDraftForCandidate(candidateId);
      if (draft?.id) {
        await loadBuilderDraftById(draft.id, { replaceUrl: true });
        return;
      }
      const settings = await resolveOfferSettings();
      const snapshot = mapOfferSnapshotToFormData(offer);
      setFormData(
        hydrateOfferLetterContent(applySettingsDefaults(snapshot, settings), settings),
      );
    } catch (error) {
      console.error('Failed to load offer data', error);
      toast.error('Failed to load offer letter');
    } finally {
      setLoading(false);
    }
  }

  async function fetchCandidateData(candidateId) {
    if (!candidateId) return;
    setLoading(true);
    try {
      const draft = await findLatestBuilderDraftForCandidate(candidateId);
      if (draft?.id) {
        await loadBuilderDraftById(draft.id, { replaceUrl: true });
        return;
      }

      const { data } = await api.get(`/hr/candidates/${candidateId}/`);
      const settings = await resolveOfferSettings();
      const updatedData = {
        ...INITIAL_STATE,
        candidate_name: data.name,
        candidate_email: data.email,
        candidate_phone: data.phone,
        candidate_address: data.address,
        candidate_name_salutation: data.name.split(' ')[0],
        job_title: data.designation_name || data.job_opening_title || '',
        department: data.department_name || '',
        candidate: data.id,
        joining_date: data.joining_date
          ? toDateInputValue(data.joining_date)
          : INITIAL_STATE.joining_date,
        offer_expiry_date: INITIAL_STATE.offer_expiry_date,
      };

      setFormData(
        hydrateOfferLetterContent(applySettingsDefaults(updatedData, settings), settings),
      );
    } catch (error) {
      console.error('Failed to fetch candidate data', error);
      toast.error('Failed to load candidate offer details');
    } finally {
      setLoading(false);
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      if (['job_title', 'department', 'job_location', 'reporting_manager'].includes(name)) {
        const ctx = buildSubstitutionContext(next, offerSettings || {});
        return {
          ...next,
          dynamic_content: syncPositionDetailsInBlocks(prev.dynamic_content, ctx),
        };
      }
      return next;
    });
  };

  const handleJoiningDateChange = (e) => {
    const value = e.target.value;
    setFormData((prev) => {
      const next = { ...prev, joining_date: value };
      const formatted = buildSubstitutionContext(next, offerSettings || {}).joining_date;
      return {
        ...next,
        dynamic_content: syncJoiningDateInBlocks(prev.dynamic_content, formatted),
      };
    });
  };

  const handleOfferExpiryDateChange = (e) => {
    const value = e.target.value;
    setFormData((prev) => {
      const next = { ...prev, offer_expiry_date: value };
      const formatted = buildSubstitutionContext(next, offerSettings || {}).offer_expiry_date;
      return {
        ...next,
        dynamic_content: syncOfferExpiryDateInBlocks(prev.dynamic_content, formatted),
      };
    });
  };

  const updateConfig = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const applySavedOfferSettings = () => {
    if (!offerSettings) {
      toast.error('No saved offer settings found');
      return;
    }
    setFormData((prev) =>
      hydrateOfferLetterContent(
        applySettingsDefaults(prev, offerSettings, { overwrite: true }),
        offerSettings,
        { forceRebuild: true },
      ),
    );
    toast.success('Saved offer settings applied');
  };

  const updateNestedConfig = (parentKey, childKey, value) => {
    setFormData(prev => ({
      ...prev,
      [parentKey]: { ...prev[parentKey], [childKey]: value }
    }));
  };

  const patchLetterSectionFont = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      letter_section_fonts: {
        ...INITIAL_LETTER_SECTION_FONTS,
        ...(prev.letter_section_fonts || {}),
        [key]: value,
      },
    }));
  };

  // --- Dynamic Content Helpers ---
  const updateBlockContent = (blockId, newContent) => {
    setFormData(prev => ({
      ...prev,
      dynamic_content: prev.dynamic_content.map(b => 
        b.id === blockId ? { ...b, content: newContent } : b
      )
    }));
  };

  const updateBlockStyle = (blockId, key, value) => {
    setFormData(prev => ({
      ...prev,
      dynamic_content: prev.dynamic_content.map(b => 
        b.id === blockId ? { ...b, [key]: value } : b
      )
    }));
  };

  const updateTableRow = (blockId, rowIndex, colIndex, newValue) => {
    setFormData(prev => ({
      ...prev,
      dynamic_content: prev.dynamic_content.map(b => {
        if (b.id === blockId) {
          const newRows = [...b.rows];
          newRows[rowIndex].cols[colIndex] = newValue;
          return { ...b, rows: newRows };
        }
        return b;
      })
    }));
  };

  const addBlock = (type) => {
    const newId = `b-${Date.now()}`;
    let newBlock;
    if (type === 'paragraph') {
      newBlock = { id: newId, type: 'paragraph', content: 'Click to edit this paragraph…', fontSize: 14, marginTop: 0, marginBottom: 20 };
    } else if (type === 'heading') {
      newBlock = { id: newId, type: 'heading', content: 'New section title', fontSize: 18, marginTop: 20, marginBottom: 16 };
    } else if (type === 'table') {
      newBlock = { id: newId, type: 'table', title: 'New table', titleFontSize: 13, cellFontSize: 14, marginTop: 12, marginBottom: 22, rows: [
        { id: `r-${Date.now()}-1`, cols: ['Label', 'Value'] },
        { id: `r-${Date.now()}-2`, cols: ['Label', 'Value'] }
      ]};
    } else if (type === 'terms') {
      newBlock = {
        id: newId,
        type: 'terms',
        title: 'Terms & Conditions',
        marginTop: 12,
        marginBottom: 20,
        items: [
          { label: 'Probation Period', text: 'You will be on probation for {{probation_period}} from your date of joining.' },
          { label: 'Confidentiality', text: 'You shall maintain strict confidentiality of all proprietary and business information.' },
          { label: 'Code of Conduct', text: 'You are required to adhere to the organization\'s code of conduct and workplace policies.' },
          { label: 'Employment Conditions', text: 'Employment is subject to verification of credentials and statutory compliance.' },
          { label: 'Termination', text: 'After confirmation, either party may terminate with {{notice_period}} written notice.' },
          { label: 'Joining Conditions', text: 'This offer is contingent upon joining on the agreed date and written acceptance.' },
        ],
      };
    }

    if (!newBlock) return;

    setFormData(prev => ({
      ...prev,
      dynamic_content: [...prev.dynamic_content, newBlock]
    }));
  };

  const deleteBlock = (blockId) => {
    setFormData((prev) => {
      const idx = prev.dynamic_content.findIndex((b) => b.id === blockId);
      if (idx === -1) return prev;
      const block = JSON.parse(JSON.stringify(prev.dynamic_content[idx]));
      setDeletedBlocksStack((stack) => [...stack, { block, index: idx }]);
      return {
        ...prev,
        dynamic_content: prev.dynamic_content.filter((b) => b.id !== blockId),
      };
    });
  };

  const undoDeleteBlock = useCallback(() => {
    setDeletedBlocksStack((stack) => {
      if (stack.length === 0) {
        toast.error('Nothing to undo');
        return stack;
      }
      const { block, index } = stack[stack.length - 1];
      setFormData((prev) => {
        const dc = [...prev.dynamic_content];
        const insertAt = Math.min(Math.max(0, index), dc.length);
        dc.splice(insertAt, 0, block);
        return { ...prev, dynamic_content: dc };
      });
      toast.success('Block restored');
      return stack.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'z' || e.shiftKey) return;
      const t = e.target;
      if (t.closest('[contenteditable="true"]')) return;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      if (deletedBlocksStackRef.current.length === 0) return;
      e.preventDefault();
      undoDeleteBlock();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoDeleteBlock]);

  const addTableColumn = (blockId) => {
    setFormData(prev => ({
      ...prev,
      dynamic_content: prev.dynamic_content.map(b => {
        if (b.id === blockId) {
          return {
            ...b,
            rows: b.rows.map(r => ({
              ...r,
              cols: [...(r.cols && r.cols.length ? r.cols : ['']), 'New Col'],
            })),
          };
        }
        return b;
      })
    }));
  };

  const deleteTableColumn = (blockId, colIndex) => {
    setFormData(prev => ({
      ...prev,
      dynamic_content: prev.dynamic_content.map(b => {
        if (b.id !== blockId) return b;
        return {
          ...b,
          rows: b.rows.map((r) => {
            const cols = r.cols || [];
            if (cols.length <= 1) return { ...r, cols: [...cols] };
            return { ...r, cols: cols.filter((_, i) => i !== colIndex) };
          }),
        };
      }),
    }));
  };

  const addTableRow = (blockId) => {
    setFormData(prev => ({
      ...prev,
      dynamic_content: prev.dynamic_content.map(b => {
        if (b.id === blockId) {
          const first = b.rows[0];
          const colCount = Math.max(1, (first?.cols || []).length);
          return { ...b, rows: [...b.rows, { id: `r-${Date.now()}`, cols: Array(colCount).fill('New Value') }] };
        }
        return b;
      })
    }));
  };

  const deleteTableRow = (blockId, rowIndex) => {
    setFormData(prev => ({
      ...prev,
      dynamic_content: prev.dynamic_content.map(b => {
        if (b.id === blockId) {
          return { ...b, rows: b.rows.filter((_, i) => i !== rowIndex) };
        }
        return b;
      })
    }));
  };

  // --- Logo drag (clamped to letterhead band) ---
  const handleLogoMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-logo-action]')) return;
    e.preventDefault();
    if (!letterheadRef.current || !logoRef.current) return;
    setIsDraggingLogo(true);
    const rect = logoRef.current.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingLogo || !letterheadRef.current || !logoRef.current) return;
      const lh = letterheadRef.current.getBoundingClientRect();
      const logoWidth = formData.logo_config.width;
      const logoHeight = formData.logo_config.height;
      let newX = e.clientX - lh.left - dragOffset.x;
      let newY = e.clientY - lh.top - dragOffset.y;

      newX = Math.max(0, Math.min(newX, lh.width - logoWidth));
      newY = Math.max(0, Math.min(newY, lh.height - logoHeight));

      setFormData((prev) => ({
        ...prev,
        logo_config: { ...prev.logo_config, x: newX, y: newY },
      }));
    };

    const handleMouseUp = () => {
      setIsDraggingLogo(false);
    };
    if (isDraggingLogo) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingLogo, dragOffset, formData.logo_config.width, formData.logo_config.height]);

  const handleCompanyBlockMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-company-action]')) return;
    if (e.target.closest('[contenteditable="true"]')) return;
    if (!letterheadRef.current || !companyBlockRef.current) return;
    e.preventDefault();
    setIsDraggingCompanyBlock(true);
    const rect = companyBlockRef.current.getBoundingClientRect();
    setCompanyDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingCompanyBlock || !letterheadRef.current || !companyBlockRef.current) return;
      const lh = letterheadRef.current.getBoundingClientRect();
      const blockRect = companyBlockRef.current.getBoundingClientRect();
      let newX = e.clientX - lh.left - companyDragOffset.x;
      let newY = e.clientY - lh.top - companyDragOffset.y;
      newX = Math.max(0, Math.min(newX, lh.width - blockRect.width));
      newY = Math.max(0, Math.min(newY, lh.height - blockRect.height));
      setFormData((prev) => ({
        ...prev,
        company_block_config: { ...prev.company_block_config, x: newX, y: newY },
      }));
    };

    const handleMouseUp = () => {
      setIsDraggingCompanyBlock(false);
    };
    if (isDraggingCompanyBlock) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingCompanyBlock, companyDragOffset]);

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => updateNestedConfig('logo_config', 'url', reader.result);
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const clearLogo = () => {
    setFormData((prev) => ({
      ...prev,
      logo_config: { ...prev.logo_config, url: '', x: 0, y: 12 },
    }));
  };

  const handleSignatureMouseDown = (e) => {
    if (!formData.signature_config.url) return;
    if (e.button !== 0) return;
    if (e.target.closest('[data-sig-action]')) return;
    e.preventDefault();
    setIsDraggingSignature(true);
    const rect = signatureImgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSigDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    });
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingSignature || !hrSignatureAreaRef.current || !signatureImgRef.current) return;
      const parent = hrSignatureAreaRef.current.getBoundingClientRect();
      const sw = signatureImgRef.current.offsetWidth;
      const sh = signatureImgRef.current.offsetHeight;
      let nx = e.clientX - parent.left - sigDragOffset.x;
      let ny = e.clientY - parent.top - sigDragOffset.y;
      nx = Math.max(0, Math.min(nx, Math.max(0, parent.width - sw)));
      ny = Math.max(0, Math.min(ny, Math.max(0, parent.height - sh)));
      updateNestedConfig('signature_config', 'offsetX', Math.round(nx));
      updateNestedConfig('signature_config', 'offsetY', Math.round(ny));
    };

    const handleMouseUp = () => setIsDraggingSignature(false);
    if (isDraggingSignature) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSignature, sigDragOffset, formData.signature_config.size]);

  const handleSignatureUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => updateNestedConfig('signature_config', 'url', reader.result);
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const clearSignature = () => {
    setFormData((prev) => ({
      ...prev,
      signature_config: { ...prev.signature_config, url: '', offsetX: 0, offsetY: 0 },
    }));
  };

  const handleSaveDraft = async () => {
    if (!formData.candidate) {
      toast.error('Please select a candidate before saving');
      setActiveControlTab('fields');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayloadForSave(formData);
      if (builderId) {
        await api.put(`/hr/offer-builder-v2/${builderId}/`, payload);
        setFormData(payload);
        toast.success('Draft updated successfully');
      } else {
        const { data } = await api.post('/hr/offer-builder-v2/', payload);
        toast.success('Draft saved successfully');
        navigate(`/hr/builder/${data.id}`, { replace: true });
      }
    } catch (error) {
      toast.error('Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const payload = buildPayloadForSave(formData);
      if (builderId) payload.id = builderId;

      const url = builderId
        ? `/hr/offer-builder-v2/${builderId}/download-pdf/`
        : '/hr/offer-builder-v2/download-pdf/';

      const response = await api.post(url, payload, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeName = (formData.candidate_name || 'offer-letter').replace(/[^\w\s-]/g, '').trim() || 'offer-letter';
      link.href = objectUrl;
      link.download = `Offer_${safeName}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      toast.success('PDF downloaded');
    } catch (error) {
      console.error('PDF download failed', error);
      toast.error(error.response?.data?.error || 'Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleGenerateOffer = async () => {
    if (!builderId && !formData.candidate) {
      toast.error('Save draft first or ensure a candidate is selected');
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayloadForSave(formData);
      setFormData(payload);
      let currentId = builderId;
      if (builderId) {
        await api.put(`/hr/offer-builder-v2/${builderId}/`, payload);
      } else {
        const { data } = await api.post('/hr/offer-builder-v2/', payload);
        currentId = data.id;
      }
      const { data: genData } = await api.post(`/hr/offer-builder-v2/${currentId}/generate_offer/`);
      toast.success(genData.message || 'Offer generated and sent successfully!');
      if (formData.candidate) {
        const builderReturnTo = builderId
          ? `/hr/builder/${builderId}`
          : '/hr/builder';
        navigate(`/hr/candidates/${formData.candidate}`, {
          state: { returnTo: builderReturnTo },
        });
      } else navigate('/hr/recruitment/jobs');
    } catch (error) {
      const msg = error.response?.data?.error || 'Failed to generate offer';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const themeColors = THEMES[formData.theme] || THEMES.corporate;

  // --- Editable Block Components ---
  const EditableBlock = React.memo(({ block, themeColors, baseFontSize, updateBlockContent, updateBlockStyle, updateTableRow, addTableRow, deleteTableRow, addTableColumn, deleteTableColumn, deleteBlock }) => {
    const [isDraggingMargin, setIsDraggingMargin] = useState(null); // 'top' or 'bottom'
    const dragStartY = useRef(0);
    const initialMargin = useRef(0);

    const handleMarginMouseDown = (e, type) => {
      e.preventDefault();
      setIsDraggingMargin(type);
      dragStartY.current = e.clientY;
      initialMargin.current = type === 'top' ? (block.marginTop || 0) : (block.marginBottom || 0);
    };

    useEffect(() => {
      const handleMouseMove = (e) => {
        if (!isDraggingMargin) return;
        const deltaY = e.clientY - dragStartY.current;
        const newMargin = Math.max(0, Math.min(100, initialMargin.current + (isDraggingMargin === 'top' ? deltaY : -deltaY)));
        updateBlockStyle(block.id, isDraggingMargin === 'top' ? 'marginTop' : 'marginBottom', Math.round(newMargin));
      };

      const handleMouseUp = () => {
        setIsDraggingMargin(null);
      };

      if (isDraggingMargin) {
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
      }
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }, [isDraggingMargin]);

    const renderContent = () => {
      switch (block.type) {
        case 'heading':
          return (
            <div className="group/h flex flex-col items-center">
              <SafeEditable 
                tagName="h2"
                value={block.content}
                onBlur={(val) => updateBlockContent(block.id, val)}
                className="font-bold uppercase tracking-widest border-b-2 inline-block pb-1 focus:outline-none max-w-full break-words [overflow-wrap:anywhere]"
                style={{ 
                  color: themeColors.primary, 
                  borderColor: themeColors.accent,
                  fontSize: `${block.fontSize || 18}px` 
                }}
              />
              <div className="mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover/h:opacity-100 bg-white/90 backdrop-blur-sm p-1 rounded-lg border border-gray-100 shadow-sm">
                <button 
                  type="button"
                  onClick={() => updateBlockStyle(block.id, 'fontSize', Math.max(12, (block.fontSize || 18) - 2))}
                  className="p-1 hover:bg-gray-100 rounded text-gray-500"
                  title="Decrease font size"
                >
                  <span className="text-xs font-bold">A-</span>
                </button>
                <span className="text-[10px] font-bold text-gray-400 w-8 text-center">{block.fontSize || 18}px</span>
                <button 
                  type="button"
                  onClick={() => updateBlockStyle(block.id, 'fontSize', Math.min(40, (block.fontSize || 18) + 2))}
                  className="p-1 hover:bg-gray-100 rounded text-gray-500"
                  title="Increase font size"
                >
                  <span className="text-xs font-bold">A+</span>
                </button>
              </div>
            </div>
          );
        case 'paragraph':
          return (
            <div className="group/p flex flex-col">
              <SafeEditable 
                tagName="p"
                value={block.content}
                onBlur={(val) => updateBlockContent(block.id, val)}
                className="rounded whitespace-pre-wrap focus:outline-none break-words [overflow-wrap:anywhere] leading-[1.6]"
                style={{ fontSize: `${block.fontSize != null ? block.fontSize : baseFontSize}px` }}
              />
              <div className="mt-1 flex w-fit items-center gap-2 opacity-0 transition-opacity group-hover/p:opacity-100 bg-white/90 backdrop-blur-sm p-1 rounded-lg border border-gray-100 shadow-sm">
                <button 
                  type="button"
                  onClick={() => updateBlockStyle(block.id, 'fontSize', Math.max(8, (block.fontSize ?? baseFontSize) - 1))}
                  className="p-1 hover:bg-gray-100 rounded text-gray-500"
                  title="Decrease font size"
                >
                  <span className="text-[10px] font-bold">A-</span>
                </button>
                <span className="text-[9px] font-bold text-gray-400 w-8 text-center">{block.fontSize ?? baseFontSize}px</span>
                <button 
                  type="button"
                  onClick={() => updateBlockStyle(block.id, 'fontSize', Math.min(32, (block.fontSize ?? baseFontSize) + 1))}
                  className="p-1 hover:bg-gray-100 rounded text-gray-500"
                  title="Increase font size"
                >
                  <span className="text-[10px] font-bold">A+</span>
                </button>
              </div>
            </div>
          );
        case 'table':
          return (
            <div className="group/table overflow-hidden rounded-lg border border-slate-200/90 bg-white text-sm shadow-sm min-w-0 max-w-full">
              <div className="group/tt px-3 pt-3 pb-1">
                <SafeEditable
                  tagName="div"
                  value={block.title || ''}
                  onBlur={(val) => updateBlockStyle(block.id, 'title', val)}
                  className="min-h-[1.25rem] font-bold text-slate-800 outline-none focus:bg-slate-50/80"
                  style={{ fontSize: `${block.titleFontSize ?? 13}px` }}
                />
                <div className="mt-1 flex flex-wrap items-center gap-2 opacity-0 transition-opacity group-hover/table:opacity-100">
                  <span className="text-[9px] font-bold uppercase text-slate-400">Title</span>
                  <button type="button" onClick={() => updateBlockStyle(block.id, 'titleFontSize', Math.max(10, (block.titleFontSize ?? 13) - 1))} className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">A−</button>
                  <span className="text-[9px] font-bold text-slate-400">{block.titleFontSize ?? 13}px</span>
                  <button type="button" onClick={() => updateBlockStyle(block.id, 'titleFontSize', Math.min(22, (block.titleFontSize ?? 13) + 1))} className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">A+</button>
                  <span className="ml-2 text-[9px] font-bold uppercase text-slate-400">Table</span>
                  <button type="button" onClick={() => updateBlockStyle(block.id, 'cellFontSize', Math.max(9, (block.cellFontSize ?? 14) - 1))} className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">A−</button>
                  <span className="text-[9px] font-bold text-slate-400">{block.cellFontSize ?? 14}px</span>
                  <button type="button" onClick={() => updateBlockStyle(block.id, 'cellFontSize', Math.min(20, (block.cellFontSize ?? 14) + 1))} className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">A+</button>
                </div>
              </div>
              <table className="w-full min-w-0 table-fixed border-collapse" style={{ fontSize: `${block.cellFontSize ?? 14}px` }}>
                <tbody>
                  {block.rows.map((row, rIdx) => (
                    <tr key={row.id} className="group/row relative border-b border-slate-200 last:border-0">
                      {(row.cols || []).map((col, cIdx) => {
                        const isJoiningDateCell =
                          cIdx === 1 && isJoiningDateRowLabel((row.cols || [])[0]);
                        return (
                        <td 
                          key={cIdx}
                          className={`min-w-0 border-r border-slate-200 p-0 last:border-0 ${cIdx === 0 ? 'w-[38%] font-semibold text-slate-800' : 'text-slate-700'}`}
                          style={cIdx === 0 ? { backgroundColor: themeColors.secondary } : {}}
                        >
                          {isJoiningDateCell ? (
                            <input
                              type="date"
                              value={toDateInputValue(formData.joining_date)}
                              onChange={handleJoiningDateChange}
                              className="h-full w-full min-h-[2.5rem] cursor-pointer border-0 bg-transparent p-2.5 text-slate-700 outline-none focus:bg-blue-50/50 focus:ring-2 focus:ring-inset focus:ring-blue-300"
                              style={{ fontSize: `${block.cellFontSize ?? 14}px` }}
                              title="Pick joining date"
                            />
                          ) : (
                            <SafeEditable 
                              tagName="div"
                              value={col}
                              onBlur={(val) => updateTableRow(block.id, rIdx, cIdx, val)}
                              className="h-full w-full break-words p-2.5 [overflow-wrap:anywhere] leading-snug"
                            />
                          )}
                        </td>
                        );
                      })}
                      <td className="absolute -right-8 top-0 flex h-full w-8 items-center justify-center border-0 bg-slate-50 p-0 align-middle opacity-0 transition-opacity group-hover/row:opacity-100">
                          <button type="button" onClick={() => deleteTableRow(block.id, rIdx)} className="p-1 text-red-400 hover:text-red-600">
                            <Trash2 size={12} />
                          </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex gap-2 border-t border-slate-100 bg-slate-50/90 p-2 opacity-0 transition-opacity group-hover/table:opacity-100">
                <button type="button" onClick={() => addTableRow(block.id)} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline">
                  <Plus size={10} /> Row
                </button>
                <button type="button" onClick={() => addTableColumn(block.id)} className="flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:underline">
                  <Plus size={10} /> Column
                </button>
                <div className="flex-1" />
                <div className="flex flex-wrap gap-1">
                  {(block.rows[0]?.cols || []).map((_, i) => (
                    <button key={i} type="button" onClick={() => deleteTableColumn(block.id, i)} className="rounded bg-red-50 px-1 text-[9px] text-red-500 hover:bg-red-100">
                      −Col {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        case 'terms':
          return (
            <div className="group/terms rounded-lg border border-slate-200 bg-slate-50/50 p-4">
              <SafeEditable
                tagName="div"
                value={block.title || 'Terms & Conditions'}
                onBlur={(val) => updateBlockStyle(block.id, 'title', val)}
                className="mb-3 font-bold uppercase tracking-wide text-slate-800 outline-none focus:bg-white/80"
              />
              <div className="space-y-3">
                {(block.items || []).map((item, idx) => (
                  <div key={idx} className="rounded border border-slate-100 bg-white p-3">
                    <SafeEditable
                      tagName="div"
                      value={item.label || ''}
                      onBlur={(val) => {
                        const items = [...(block.items || [])];
                        items[idx] = { ...items[idx], label: val };
                        updateBlockStyle(block.id, 'items', items);
                      }}
                      className="mb-1 font-bold text-slate-800 outline-none"
                    />
                    <SafeEditable
                      tagName="p"
                      value={item.text || ''}
                      onBlur={(val) => {
                        const items = [...(block.items || [])];
                        items[idx] = { ...items[idx], text: val };
                        updateBlockStyle(block.id, 'items', items);
                      }}
                      className="whitespace-pre-wrap text-justify text-slate-600 outline-none leading-relaxed"
                      style={{ fontSize: `${block.cellFontSize ?? 13}px` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        default:
          return null;
      }
    };

    return (
      <div 
        className={`relative group border-2 border-transparent hover:border-blue-100 rounded-xl transition-all duration-300 ${isDraggingMargin ? 'border-blue-300 bg-blue-50/10' : ''}`}
        style={{ 
          marginTop: `${block.marginTop != null ? block.marginTop : 0}px`, 
          marginBottom: `${block.marginBottom != null ? block.marginBottom : 18}px` 
        }}
      >
        {/* Margin Handles */}
        <div 
          onMouseDown={(e) => handleMarginMouseDown(e, 'top')}
          className="absolute -top-3 left-0 right-0 h-4 cursor-row-resize opacity-0 group-hover:opacity-100 flex items-center justify-center group/margin z-10"
          title="Drag to adjust top margin"
        >
          <div className="w-16 h-1 bg-blue-200 rounded-full group-hover/margin:bg-blue-400 transition-colors"></div>
          <span className="absolute -top-5 text-[9px] font-black text-blue-500 bg-white border border-blue-100 px-1.5 py-0.5 rounded shadow-sm opacity-0 group-hover/margin:opacity-100 pointer-events-none uppercase tracking-tighter">
            Margin Top: {block.marginTop || 0}px
          </span>
        </div>

        <div 
          onMouseDown={(e) => handleMarginMouseDown(e, 'bottom')}
          className="absolute -bottom-3 left-0 right-0 h-4 cursor-row-resize opacity-0 group-hover:opacity-100 flex items-center justify-center group/margin z-10"
          title="Drag to adjust bottom margin"
        >
          <div className="w-16 h-1 bg-blue-200 rounded-full group-hover/margin:bg-blue-400 transition-colors"></div>
          <span className="absolute -bottom-5 text-[9px] font-black text-blue-500 bg-white border border-blue-100 px-1.5 py-0.5 rounded shadow-sm opacity-0 group-hover/margin:opacity-100 pointer-events-none uppercase tracking-tighter">
            Margin Bottom: {block.marginBottom != null ? block.marginBottom : 18}px
          </span>
        </div>

        <div className="absolute -left-12 top-0 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <button
            onClick={() => deleteBlock(block.id)}
            className="rounded-lg bg-red-500 p-1.5 text-white shadow-lg transition-colors hover:bg-red-600"
            title="Remove block (restore with Undo or Ctrl+Z)"
          >
            <Trash2 size="14" />
          </button>
          <div className="bg-gray-200 text-gray-500 p-1.5 rounded-lg cursor-grab active:cursor-grabbing">
            <GripVertical size="14" />
          </div>
        </div>
        <div className={block.type === 'heading' ? 'text-center' : ''}>
          {renderContent()}
        </div>
      </div>
    );
  });

  EditableBlock.displayName = 'EditableBlock';

  const PreviewTemplate = () => {
    const ls = { ...INITIAL_LETTER_SECTION_FONTS, ...(formData.letter_section_fonts || {}) };
    return (
    <div 
      ref={pageRef}
      className="offer-letter-preview-root box-border w-[794px] min-h-[1123px] bg-white p-12 text-gray-800 font-serif leading-relaxed relative transition-all duration-300 break-words [overflow-wrap:anywhere]" 
      id="offer-letter-preview"
      style={{ fontSize: `${formData.font_size}px` }}
    >
      {/* Letterhead — flex row matches PDF table layout */}
      <div
        ref={letterheadRef}
        className="mb-8 flex items-start justify-between gap-4 border-b border-gray-200 pb-6"
      >
        <div
          ref={logoRef}
          className="group/logo relative"
          style={{
            width: `${formData.logo_config.width || 120}px`,
            height: `${formData.logo_config.height || 60}px`,
          }}
        >
          <input type="file" id="preview-logo-upload" className="hidden" accept="image/*" onChange={handleLogoUpload} />
          {formData.logo_config.url ? (
            <>
              <img src={formData.logo_config.url} alt="" className="pointer-events-none h-full w-full object-contain" />
              <div
                className="absolute -top-1 -right-1 z-[60] flex gap-0.5 opacity-0 transition-opacity group-hover/logo:opacity-100"
                data-logo-action
                onMouseDown={(e) => e.stopPropagation()}
              >
                <label
                  htmlFor="preview-logo-upload"
                  className="cursor-pointer rounded-md border border-slate-200 bg-white/95 px-2 py-0.5 text-[9px] font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Replace
                </label>
                <button
                  type="button"
                  className="rounded-md border border-slate-200 bg-white/95 px-2 py-0.5 text-[9px] font-bold text-red-600 shadow-sm hover:bg-red-50"
                  onClick={clearLogo}
                >
                  Remove
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="pointer-events-none flex h-full w-full items-center justify-center rounded border-2 border-dashed border-gray-300 bg-white/90 text-center text-[10px] font-semibold text-gray-500 font-sans">
                + Add logo
              </div>
              <label
                htmlFor="preview-logo-upload"
                data-logo-action
                className="absolute bottom-0.5 right-0.5 cursor-pointer rounded border border-slate-200 bg-white/95 px-1.5 py-0.5 text-[8px] font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                onMouseDown={(e) => e.stopPropagation()}
              >
                Upload
              </label>
            </>
          )}
        </div>

        <div
          ref={companyBlockRef}
          className="group/company-cluster min-w-0 flex-1 text-right"
        >
          <div className="letterhead-cluster-stack flex flex-col items-end gap-0.5 text-right [&_[contenteditable]]:border-0 [&_[contenteditable]]:outline-none">
            <SafeEditable
              value={formData.company_name || ''}
              onBlur={(val) => updateConfig('company_name', val)}
              tagName="div"
              className="m-0 max-w-full border-0 p-0 font-serif font-bold leading-tight tracking-tight"
              style={{
                color: themeColors.primary,
                fontSize: `${formData.company_name_font_size ?? 16}px`,
              }}
            />
            <div
              className="flex w-full flex-col items-end gap-0.5 font-serif leading-snug text-gray-500 [&_[contenteditable]]:border-0"
              style={{ fontSize: `${formData.company_meta_font_size ?? 16}px` }}
            >
              <SafeEditable
                value={formData.company_address || 'Street address, district'}
                onBlur={(val) => updateConfig('company_address', val)}
                tagName="div"
                className="m-0 max-w-full border-0 p-0 break-words text-right"
              />
              <SafeEditable
                value={formData.company_location || 'City, Postal code'}
                onBlur={(val) => updateConfig('company_location', val)}
                tagName="div"
                className="m-0 max-w-full border-0 p-0 break-words text-right"
              />
              <SafeEditable
                value={formData.company_contact || 'Email | Phone'}
                onBlur={(val) => updateConfig('company_contact', val)}
                tagName="div"
                className="m-0 max-w-full border-0 p-0 break-all text-right"
              />
            </div>
            <div
              className="mt-1.5 flex flex-wrap items-center justify-end gap-1 opacity-0 transition-opacity group-hover/company-cluster:opacity-100"
              data-company-action
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span className="mr-1 text-[9px] font-bold uppercase text-gray-400" data-company-action>
                Name
              </span>
              <button
                type="button"
                data-company-action
                onClick={() =>
                  updateConfig('company_name_font_size', Math.max(10, (formData.company_name_font_size ?? 16) - 1))
                }
                className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 shadow border border-gray-100"
              >
                A−
              </button>
              <span className="text-[9px] font-bold text-gray-400" data-company-action>
                {formData.company_name_font_size ?? 16}px
              </span>
              <button
                type="button"
                data-company-action
                onClick={() =>
                  updateConfig('company_name_font_size', Math.min(40, (formData.company_name_font_size ?? 16) + 1))
                }
                className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 shadow border border-gray-100"
              >
                A+
              </button>
              <span className="mx-1 text-[9px] font-bold uppercase text-gray-400" data-company-action>
                Addr
              </span>
              <button
                type="button"
                data-company-action
                onClick={() =>
                  updateConfig(
                    'company_meta_font_size',
                    Math.max(10, (formData.company_meta_font_size ?? 16) - 1),
                  )
                }
                className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 shadow border border-gray-100"
              >
                A−
              </button>
              <span className="text-[9px] font-bold text-gray-400" data-company-action>
                {formData.company_meta_font_size ?? 16}px
              </span>
              <button
                type="button"
                data-company-action
                onClick={() =>
                  updateConfig(
                    'company_meta_font_size',
                    Math.min(28, (formData.company_meta_font_size ?? 16) + 1),
                  )
                }
                className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 shadow border border-gray-100"
              >
                A+
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center mb-8 group/title relative">
        <div className="flex flex-col items-center">
          <SafeEditable 
            tagName="h2"
            value={formData.letter_title}
            onBlur={(val) => updateConfig('letter_title', val)}
            className="font-bold uppercase tracking-widest border-b-2 inline-block pb-1 focus:outline-none max-w-full px-1 break-words [overflow-wrap:anywhere]"
            style={{ 
              color: themeColors.primary, 
              borderColor: themeColors.accent,
              fontSize: `${formData.letter_title_font_size || 24}px`
            }}
          />
          <div className="flex items-center gap-1 opacity-0 group-hover/title:opacity-100 transition-opacity bg-white/80 backdrop-blur-sm p-0.5 rounded border border-gray-100 shadow-sm mt-1">
            <button onClick={() => updateConfig('letter_title_font_size', Math.max(8, (formData.letter_title_font_size || 24) - 2))} className="p-1 hover:bg-gray-100 rounded text-gray-400 font-bold text-xs">A-</button>
            <span className="text-[10px] font-bold text-gray-400 px-1">{formData.letter_title_font_size || 24}px</span>
            <button onClick={() => updateConfig('letter_title_font_size', Math.min(72, (formData.letter_title_font_size || 24) + 2))} className="p-1 hover:bg-gray-100 rounded text-gray-400 font-bold text-xs">A+</button>
          </div>
        </div>
      </div>

      <div className="group/refs mb-7">
        <div
          className="flex flex-col gap-3 font-bold text-slate-800 sm:flex-row sm:items-start sm:justify-between"
          style={{ fontSize: `${ls.ref_date}px` }}
        >
          <div className="flex min-w-0 flex-wrap gap-x-1 gap-y-1">
            <SafeEditable value={formData.ref_label} onBlur={(val) => updateConfig('ref_label', val)} />
            <SafeEditable
              value={formData.ref_value || `CH/OFFER/${new Date().getFullYear()}/${builderId ? builderId.substring(0, 4) : 'TEMP'}`}
              onBlur={(val) => updateConfig('ref_value', val)}
              className="break-all focus:bg-blue-50"
            />
          </div>
          <div className="flex min-w-0 flex-wrap gap-x-1 gap-y-1 sm:justify-end sm:text-right">
            <SafeEditable value={formData.date_label} onBlur={(val) => updateConfig('date_label', val)} />
            <SafeEditable
              value={
                formData.date_value ||
                new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
              }
              onBlur={(val) => updateConfig('date_value', val)}
              className="break-words focus:bg-blue-50"
            />
          </div>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1 opacity-0 transition-opacity group-hover/refs:opacity-100">
          <span className="text-[9px] font-bold uppercase text-slate-400">Ref & date</span>
          <button
            type="button"
            onClick={() => patchLetterSectionFont('ref_date', Math.max(10, ls.ref_date - 1))}
            className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm"
          >
            A−
          </button>
          <span className="text-[9px] font-bold text-slate-400">{ls.ref_date}px</span>
          <button
            type="button"
            onClick={() => patchLetterSectionFont('ref_date', Math.min(18, ls.ref_date + 1))}
            className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm"
          >
            A+
          </button>
        </div>
      </div>

      <div className="group/cmeta relative mb-7">
        <SafeEditable
          value={formData.to_label}
          onBlur={(val) => updateConfig('to_label', val)}
          tagName="p"
          className="font-bold text-slate-700"
          style={{ fontSize: `${ls.candidate_meta}px` }}
        />
        <div className="flex flex-col items-start">
          <SafeEditable
            value={formData.candidate_name || '[Candidate Name]'}
            onBlur={(val) => updateConfig('candidate_name', val)}
            tagName="p"
            className="font-bold uppercase focus:outline-none"
            style={{ color: themeColors.primary, fontSize: `${formData.candidate_name_font_size || 18}px` }}
          />
          <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/cmeta:opacity-100 sm:bg-white/80 border border-gray-100 sm:backdrop-blur-sm p-0.5 rounded shadow-sm">
            <button
              type="button"
              onClick={() => updateConfig('candidate_name_font_size', Math.max(8, (formData.candidate_name_font_size || 18) - 1))}
              className="rounded p-0.5 text-[10px] font-bold text-gray-400 hover:bg-gray-100"
            >
              A-
            </button>
            <span className="text-[9px] font-bold text-gray-400">{formData.candidate_name_font_size || 18}px</span>
            <button
              type="button"
              onClick={() => updateConfig('candidate_name_font_size', Math.min(48, (formData.candidate_name_font_size || 18) + 1))}
              className="rounded p-0.5 text-[10px] font-bold text-gray-400 hover:bg-gray-100"
            >
              A+
            </button>
          </div>
        </div>
        <SafeEditable
          value={formData.candidate_address || '[Candidate Address]'}
          onBlur={(val) => updateConfig('candidate_address', val)}
          tagName="p"
          className="mt-1 whitespace-pre-wrap text-slate-600"
          style={{ fontSize: `${ls.candidate_meta}px` }}
        />
        <SafeEditable
          value={formData.candidate_email}
          onBlur={(val) => updateConfig('candidate_email', val)}
          tagName="p"
          className="text-slate-600"
          style={{ fontSize: `${ls.candidate_meta}px` }}
        />
        <SafeEditable
          value={formData.candidate_phone || '[Candidate Phone]'}
          onBlur={(val) => updateConfig('candidate_phone', val)}
          tagName="p"
          className="text-slate-600"
          style={{ fontSize: `${ls.candidate_meta}px` }}
        />
        <div className="mt-1 flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover/cmeta:opacity-100">
          <span className="text-[9px] font-bold uppercase text-slate-400">Address lines</span>
          <button
            type="button"
            onClick={() => patchLetterSectionFont('candidate_meta', Math.max(10, ls.candidate_meta - 1))}
            className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm"
          >
            A−
          </button>
          <span className="text-[9px] font-bold text-slate-400">{ls.candidate_meta}px</span>
          <button
            type="button"
            onClick={() => patchLetterSectionFont('candidate_meta', Math.min(20, ls.candidate_meta + 1))}
            className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm"
          >
            A+
          </button>
        </div>
      </div>

      <div className="group/sal mb-8">
        <div className="flex flex-wrap items-baseline gap-1" style={{ fontSize: `${ls.salutation}px` }}>
          <SafeEditable value={formData.dear_label} onBlur={(val) => updateConfig('dear_label', val)} />
          <SafeEditable
            value={formData.candidate_name_salutation || 'Candidate'}
            onBlur={(val) => updateConfig('candidate_name_salutation', val)}
            className="font-bold"
          />
          <span>,</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover/sal:opacity-100">
          <span className="text-[9px] font-bold uppercase text-slate-400">Greeting</span>
          <button
            type="button"
            onClick={() => patchLetterSectionFont('salutation', Math.max(10, ls.salutation - 1))}
            className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm"
          >
            A−
          </button>
          <span className="text-[9px] font-bold text-slate-400">{ls.salutation}px</span>
          <button
            type="button"
            onClick={() => patchLetterSectionFont('salutation', Math.min(22, ls.salutation + 1))}
            className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm"
          >
            A+
          </button>
        </div>
      </div>

      <div className="dynamic-blocks-container min-w-0 max-w-full space-y-1">
        {formData.dynamic_content.map((block) => (
          <EditableBlock
            key={block.id}
            block={block}
            baseFontSize={formData.font_size}
            themeColors={themeColors}
            updateBlockContent={updateBlockContent}
            updateBlockStyle={updateBlockStyle}
            updateTableRow={updateTableRow}
            addTableRow={addTableRow}
            deleteTableRow={deleteTableRow}
            addTableColumn={addTableColumn}
            deleteTableColumn={deleteTableColumn}
            deleteBlock={deleteBlock}
          />
        ))}
        
        <div className="group/add mt-10 flex justify-center gap-3 border-t border-dashed border-slate-200 pt-5 opacity-0 transition-opacity hover:opacity-100">
          <button onClick={() => addBlock('heading')} className="flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-blue-500 transition-colors uppercase tracking-widest bg-white px-3 py-1 rounded-full border border-gray-100 shadow-sm">
            <Plus size={12} /> Add Heading
          </button>
          <button onClick={() => addBlock('paragraph')} className="flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-blue-500 transition-colors uppercase tracking-widest bg-white px-3 py-1 rounded-full border border-gray-100 shadow-sm">
            <Plus size={12} /> Add Paragraph
          </button>
          <button onClick={() => addBlock('table')} className="flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-blue-500 transition-colors uppercase tracking-widest bg-white px-3 py-1 rounded-full border border-gray-100 shadow-sm">
            <Plus size={12} /> Add Table
          </button>
        </div>
      </div>

      <div className="mt-8 text-sm">
        <div className="letter-closing w-full">
        <div className="w-full max-w-[220px]">
          <div className="group/signb w-full">
            <div ref={hrSignatureAreaRef} className="relative min-h-[52px] w-full">
              <input type="file" id="preview-sig-upload" className="hidden" accept="image/*" onChange={handleSignatureUpload} />
              {formData.signature_config.url ? (
                <div
                  ref={signatureImgRef}
                  onMouseDown={handleSignatureMouseDown}
                  className={`group/sig absolute z-10 select-none ${isDraggingSignature ? 'ring-2 ring-violet-400 ring-offset-1 rounded' : ''} cursor-move`}
                  style={{
                    left: `${formData.signature_config.offsetX ?? 0}px`,
                    top: `${formData.signature_config.offsetY ?? 0}px`,
                  }}
                >
                  <img
                    src={formData.signature_config.url}
                    alt=""
                    draggable={false}
                    className={`pointer-events-none object-left object-contain ${
                      formData.signature_config.size === 'sm' ? 'h-8 max-w-[140px]' : formData.signature_config.size === 'lg' ? 'h-20 max-w-[220px]' : 'h-12 max-w-[180px]'
                    }`}
                  />
                  <div
                    className="absolute -top-1 -right-1 z-[60] flex gap-0.5 opacity-0 transition-opacity group-hover/sig:opacity-100"
                    data-sig-action
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <label
                      htmlFor="preview-sig-upload"
                      className="cursor-pointer rounded-md border border-slate-200 bg-white/95 px-2 py-0.5 text-[9px] font-bold text-slate-700 shadow-sm hover:bg-slate-50"
                    >
                      Replace
                    </label>
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 bg-white/95 px-2 py-0.5 text-[9px] font-bold text-red-600 shadow-sm hover:bg-red-50"
                      onClick={clearSignature}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <label
                  htmlFor="preview-sig-upload"
                  className="flex h-16 max-w-[240px] cursor-pointer items-center justify-center rounded border-2 border-dashed border-gray-300 bg-gray-50/80 text-center text-[10px] font-semibold text-gray-500 transition-colors hover:border-violet-300 hover:bg-violet-50/40"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  + Add HR signature
                </label>
              )}
            </div>
            <div className="mt-1 space-y-0.5 border-t border-slate-800 pt-1.5">
              <SafeEditable
                value={formData.hr_name || ''}
                onBlur={(val) => updateConfig('hr_name', val)}
                tagName="p"
                className="font-bold text-slate-900"
                style={{ fontSize: `${ls.signatory_name}px` }}
              />
              <SafeEditable
                value={formData.hr_designation || ''}
                onBlur={(val) => updateConfig('hr_designation', val)}
                tagName="p"
                className="text-slate-600"
                style={{ fontSize: `${ls.signatory_line}px` }}
              />
              <p className="text-slate-500" style={{ fontSize: `${ls.signatory_line}px` }}>
                For {formData.company_name || 'Company'}
              </p>
              <div className="flex flex-wrap items-center gap-1 pt-1 opacity-0 transition-opacity group-hover/signb:opacity-100">
                <span className="text-[9px] font-bold uppercase text-slate-400">Sign-off</span>
                <button
                  type="button"
                  onClick={() => patchLetterSectionFont('signatory_name', Math.max(11, ls.signatory_name - 1))}
                  className="rounded border border-slate-100 bg-white px-1 py-0.5 text-[9px] font-bold text-slate-500"
                >
                  N−
                </button>
                <button
                  type="button"
                  onClick={() => patchLetterSectionFont('signatory_name', Math.min(20, ls.signatory_name + 1))}
                  className="rounded border border-slate-100 bg-white px-1 py-0.5 text-[9px] font-bold text-slate-500"
                >
                  N+
                </button>
                <button
                  type="button"
                  onClick={() => patchLetterSectionFont('signatory_line', Math.max(9, ls.signatory_line - 1))}
                  className="rounded border border-slate-100 bg-white px-1 py-0.5 text-[9px] font-bold text-slate-500"
                >
                  S−
                </button>
                <button
                  type="button"
                  onClick={() => patchLetterSectionFont('signatory_line', Math.min(16, ls.signatory_line + 1))}
                  className="rounded border border-slate-100 bg-white px-1 py-0.5 text-[9px] font-bold text-slate-500"
                >
                  S+
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer — grouped with signature (matches PDF, no extra divider) */}
        <div
          className="group/foot mt-2.5 w-full text-center text-slate-500"
          style={{ fontSize: `${ls.footer_note}px`, lineHeight: 1.4 }}
        >
          <div className="space-y-0 normal-case">
            {((offerSettings?.registered_office_address || formData.company_address || '').trim() ||
              (offerSettings?.corporate_office_address || '').trim() ||
              (formData.company_website || offerSettings?.organization_website || '').trim() ||
              (formData.hr_email || offerSettings?.hr_email || '').trim() ||
              (offerSettings?.company_registration_number || '').trim()) && (
              <div>
                {((offerSettings?.registered_office_address || formData.company_address || '').trim() ||
                  (offerSettings?.corporate_office_address || '').trim()) && (
                  <div>
                    {(offerSettings?.registered_office_address || formData.company_address || '').trim() && (
                      <>
                        <span className="font-semibold text-slate-600">Reg. Office:</span>{' '}
                        {(offerSettings?.registered_office_address || formData.company_address || '').trim()}
                      </>
                    )}
                    {(offerSettings?.registered_office_address || formData.company_address || '').trim() &&
                      (offerSettings?.corporate_office_address || '').trim() && (
                        <span className="mx-1.5 text-slate-300">•</span>
                      )}
                    {(offerSettings?.corporate_office_address || '').trim() && (
                      <>
                        <span className="font-semibold text-slate-600">Corp. Office:</span>{' '}
                        {(offerSettings?.corporate_office_address || '').trim()}
                      </>
                    )}
                  </div>
                )}
                {((formData.company_website || offerSettings?.organization_website || '').trim() ||
                  (formData.hr_email || offerSettings?.hr_email || '').trim() ||
                  (offerSettings?.company_registration_number || '').trim()) && (
                  <div>
                    {(formData.company_website || offerSettings?.organization_website || '').trim()}
                    {(formData.company_website || offerSettings?.organization_website || '').trim() &&
                      (formData.hr_email || offerSettings?.hr_email || '').trim() && (
                        <span className="mx-1.5 text-slate-300">•</span>
                      )}
                    {(formData.hr_email || offerSettings?.hr_email || '').trim() && (
                      <>HR: {(formData.hr_email || offerSettings?.hr_email || '').trim()}</>
                    )}
                    {(offerSettings?.company_registration_number || '').trim() &&
                      ((formData.company_website || offerSettings?.organization_website || '').trim() ||
                        (formData.hr_email || offerSettings?.hr_email || '').trim()) && (
                        <span className="mx-1.5 text-slate-300">•</span>
                      )}
                    {(offerSettings?.company_registration_number || '').trim() && (
                      <>
                        <span className="font-semibold text-slate-600">CIN:</span>{' '}
                        {(offerSettings?.company_registration_number || '').trim()}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="pt-1.5 text-[7px] font-bold uppercase tracking-wide text-slate-400">
              {(
                offerSettings?.footer_confidentiality_note ||
                'CONFIDENTIAL — This document is intended solely for the named recipient.'
              ).trim()}
            </div>
            <div className="pt-0.5 text-[7px] italic normal-case text-slate-400">
              {`This is a system-generated offer letter issued by ${(formData.company_name || offerSettings?.organization_name || 'the organization').trim()}. It is valid only when accompanied by an authorized signature.`}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1 opacity-0 transition-opacity group-hover/foot:opacity-100">
            <span className="text-[9px] font-bold normal-case text-slate-400">Footer size</span>
            <button
              type="button"
              onClick={() => patchLetterSectionFont('footer_note', Math.max(7, ls.footer_note - 1))}
              className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold normal-case text-slate-500 shadow-sm"
            >
              A-
            </button>
            <span className="text-[9px] font-bold normal-case text-slate-400">{ls.footer_note}px</span>
            <button
              type="button"
              onClick={() => patchLetterSectionFont('footer_note', Math.min(12, ls.footer_note + 1))}
              className="rounded border border-slate-100 bg-white px-1.5 py-0.5 text-[10px] font-bold normal-case text-slate-500 shadow-sm"
            >
              A+
            </button>
          </div>
        </div>
        </div>

      </div>
    </div>
    );
  };

  return (
    <HRPageWrapper color="purple">
      <div className="fixed inset-x-0 bottom-0 z-[35] flex max-h-[100dvh] flex-col overflow-hidden border-t border-slate-200/90 bg-slate-100 shadow-[0_-8px_32px_rgba(15,23,42,0.07)] max-md:top-[7.25rem] md:top-14 md:left-64">
        <header className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-slate-200 bg-white px-2 sm:gap-2 sm:px-3">
          <button
            type="button"
            onClick={() => navigate('/hr/recruitment/jobs')}
            className="flex shrink-0 items-center gap-1 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100"
            title="Back"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="hidden min-w-0 truncate text-xs font-bold text-slate-800 sm:block">Offer Builder</span>

          <div className="ml-auto hidden items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 lg:flex">
            <button
              type="button"
              onClick={() => {
                setFitMode('width');
                setZoomMultiplier(1);
              }}
              className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${fitMode === 'width' && zoomMultiplier === 1 ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Fit width
            </button>
            <button
              type="button"
              onClick={() => {
                setFitMode('page');
                setZoomMultiplier(1);
              }}
              className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${fitMode === 'page' && zoomMultiplier === 1 ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Fit page
            </button>
            <div className="mx-0.5 flex items-center gap-0.5 border-l border-slate-200 pl-1">
              <button
                type="button"
                onClick={() => setZoomMultiplier((z) => Math.max(0.5, Math.round((z - 0.1) * 100) / 100))}
                className="rounded p-1.5 text-slate-500 hover:bg-white hover:text-slate-900"
                title="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <span className="min-w-[2.75rem] text-center font-mono text-[10px] font-semibold tabular-nums text-slate-600">
                {Math.round(canvasScale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoomMultiplier((z) => Math.min(1.6, Math.round((z + 0.1) * 100) / 100))}
                className="rounded p-1.5 text-slate-500 hover:bg-white hover:text-slate-900"
                title="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setFitMode('width');
              setZoomMultiplier(1);
              if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
                setMobileWorkspace('preview');
              }
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-700 shadow-sm hover:bg-slate-50 sm:px-3 sm:text-xs"
          >
            <Eye size={15} />
            <span className="hidden sm:inline">Preview</span>
          </button>

          <button
            type="button"
            onClick={undoDeleteBlock}
            disabled={deletedBlocksStack.length === 0}
            className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-white p-2 text-slate-600 shadow-sm disabled:opacity-40 sm:hidden"
            title="Undo removed block"
          >
            <Undo2 size={16} />
          </button>

          <div className="mx-0.5 hidden h-6 w-px bg-slate-200 sm:block" />

          <button
            type="button"
            onClick={undoDeleteBlock}
            disabled={deletedBlocksStack.length === 0}
            className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-700 shadow-sm transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex sm:px-3 sm:text-xs"
            title="Restore last removed block (Ctrl+Z)"
          >
            <Undo2 size={14} /> Undo block
          </button>

          <div className="mx-0.5 hidden h-6 w-px bg-slate-200 sm:block" />

          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={saving || downloadingPdf}
            className="hidden items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-sm transition-all hover:bg-blue-700 disabled:opacity-50 sm:inline-flex sm:px-3 sm:text-xs"
          >
            <Save size={14} /> {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={saving || downloadingPdf}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-800 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-50 sm:px-3 sm:text-xs"
            title="Download PDF preview (includes Terms & Conditions)"
          >
            <Download size={14} />
            <span className="hidden sm:inline">{downloadingPdf ? 'Preparing…' : 'Download PDF'}</span>
            <span className="sm:hidden">{downloadingPdf ? '…' : 'PDF'}</span>
          </button>
          <button
            type="button"
            onClick={handleGenerateOffer}
            disabled={saving || downloadingPdf}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-50 sm:px-3 sm:text-xs"
          >
            <Send size={14} />
            <span className="hidden sm:inline">{saving ? 'Sending…' : 'Generate & send'}</span>
            <span className="sm:hidden">{saving ? '…' : 'Send'}</span>
          </button>
        </header>

        <div className="flex shrink-0 gap-0 border-b border-slate-200 bg-white lg:hidden">
          <button
            type="button"
            onClick={() => setMobileWorkspace('edit')}
            className={`flex-1 py-2.5 text-center text-xs font-bold transition-colors ${mobileWorkspace === 'edit' ? 'border-b-2 border-indigo-600 text-indigo-700 bg-indigo-50/50' : 'text-slate-500'}`}
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setFitMode('width');
              setZoomMultiplier(1);
              setMobileWorkspace('preview');
            }}
            className={`flex-1 py-2.5 text-center text-xs font-bold transition-colors ${mobileWorkspace === 'preview' ? 'border-b-2 border-indigo-600 text-indigo-700 bg-indigo-50/50' : 'text-slate-500'}`}
          >
            Preview canvas
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div
            className={`flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white lg:w-[400px] lg:min-w-[380px] lg:max-w-[420px] ${
              mobileWorkspace === 'preview' ? 'hidden' : 'flex'
            } lg:flex`}
          >
          <div className="flex shrink-0 items-center justify-end gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2 lg:hidden">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Save draft'}
            </button>
          </div>

          <div className="flex border-b border-slate-200 bg-white">
            <button type="button" onClick={() => setActiveControlTab('fields')} className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 transition-all sm:py-3 ${activeControlTab === 'fields' ? 'border-b-2 border-indigo-600 bg-indigo-50/50 text-indigo-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
              <span className="flex items-center gap-1.5 text-xs font-semibold sm:text-sm"><FileText size={15} /> Offer details</span>
              <span className="hidden text-[10px] text-slate-500 sm:block">Candidate &amp; job</span>
            </button>
            <button type="button" onClick={() => setActiveControlTab('components')} className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 transition-all sm:py-3 ${activeControlTab === 'components' ? 'border-b-2 border-indigo-600 bg-indigo-50/50 text-indigo-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
              <span className="flex items-center gap-1.5 text-xs font-semibold sm:text-sm"><PenLine size={15} /> Letter content</span>
              <span className="hidden text-[10px] text-slate-500 sm:block">Add sections</span>
            </button>
            <button type="button" onClick={() => setActiveControlTab('design')} className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 transition-all sm:py-3 ${activeControlTab === 'design' ? 'border-b-2 border-indigo-600 bg-indigo-50/50 text-indigo-800' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}>
              <span className="flex items-center gap-1.5 text-xs font-semibold sm:text-sm"><Palette size={15} /> Branding</span>
              <span className="hidden text-[10px] text-slate-500 sm:block">Logo &amp; colors</span>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-6">
            {activeControlTab === 'fields' ? (
              <div className="animate-in fade-in space-y-4 pb-20 duration-300">
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3">
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-indigo-900">
                    <Sparkles size={15} className="mt-0.5 shrink-0 text-indigo-600" />
                    <span>
                      <strong className="font-semibold">Quick guide:</strong> Fill in the candidate and job details below, then edit the letter on the right. Use <strong>Branding</strong> for logo and colors. When ready, click <strong>Generate &amp; send</strong>.
                    </span>
                  </p>
                </div>

                <SidebarPanel title="1. Who is this offer for?" description="Pick a candidate or type details manually" icon={User} collapsible={false}>
                  <SidebarField label="Candidate" required hint="Opens from a candidate profile? This may already be filled in.">
                    <select
                      value={formData.candidate || ''}
                      onChange={(e) => {
                        if (e.target.value) fetchCandidateData(e.target.value);
                      }}
                      disabled={loadingCandidates}
                      className={`${SIDEBAR_INPUT} font-medium text-indigo-900`}
                    >
                      <option value="">Choose a candidate…</option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.job_opening_title || 'No role'})
                        </option>
                      ))}
                    </select>
                  </SidebarField>
                  <SidebarField label="Full name">
                    <input name="candidate_name" value={formData.candidate_name} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="Candidate name" />
                  </SidebarField>
                  <SidebarField label="Email">
                    <input name="candidate_email" type="email" value={formData.candidate_email} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="email@example.com" />
                  </SidebarField>
                  <SidebarField label="Phone">
                    <input name="candidate_phone" value={formData.candidate_phone} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="Phone number" />
                  </SidebarField>
                  <SidebarField label="Address">
                    <textarea name="candidate_address" value={formData.candidate_address} onChange={handleChange} rows="2" className={`${SIDEBAR_INPUT} resize-none`} placeholder="Mailing address" />
                  </SidebarField>
                </SidebarPanel>

                <SidebarPanel title="2. Job & joining date" description="Shown in the Position Details table on the letter" icon={Briefcase} collapsible={false}>
                  <SidebarField label="Designation">
                    <input name="job_title" value={formData.job_title} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="e.g. Staff Nurse" />
                  </SidebarField>
                  <SidebarField label="Department">
                    <input name="department" value={formData.department} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="e.g. Nursing" />
                  </SidebarField>
                  <SidebarField label="Joining date" hint="You can also pick this date directly in the letter preview table.">
                    <input
                      type="date"
                      name="joining_date"
                      value={toDateInputValue(formData.joining_date)}
                      onChange={handleJoiningDateChange}
                      className={SIDEBAR_INPUT}
                    />
                  </SidebarField>
                  <SidebarField label="Last date to accept offer" hint="Candidate must accept on or before this date.">
                    <input
                      type="date"
                      name="offer_expiry_date"
                      min={todayISODate()}
                      value={toDateInputValue(formData.offer_expiry_date)}
                      onChange={handleOfferExpiryDateChange}
                      className={SIDEBAR_INPUT}
                    />
                  </SidebarField>
                </SidebarPanel>

                <SidebarPanel title="3. Who signs the letter?" description="Name and contact shown at the bottom of the offer" icon={MousePointer2} collapsible={false}>
                  <SidebarField label="Signatory name">
                    <input name="hr_name" value={formData.hr_name} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="HR manager name" />
                  </SidebarField>
                  <SidebarField label="Contact email">
                    <input name="hr_email" type="email" value={formData.hr_email || ''} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="hr@company.com" />
                  </SidebarField>
                  <SidebarField label="Title on letter">
                    <input name="hr_designation" value={formData.hr_designation} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="e.g. HR Manager" />
                  </SidebarField>
                </SidebarPanel>

                <SidebarPanel
                  title="Company on letterhead"
                  description="Usually loaded from saved settings — expand only if you need to override"
                  icon={Briefcase}
                  open={sidebarPanels.company}
                  onToggle={() => toggleSidebarPanel('company')}
                >
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={applySavedOfferSettings} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700">
                      Load saved company info
                    </button>
                    <button type="button" onClick={() => navigate('/hr/recruitment/offers?section=settings')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                      Edit default settings
                    </button>
                  </div>
                  <SidebarField label="Company name">
                    <input name="company_name" value={formData.company_name || ''} placeholder="Your organization" onChange={handleChange} className={SIDEBAR_INPUT} />
                  </SidebarField>
                  <SidebarField label="Street address">
                    <input name="company_address" value={formData.company_address || ''} placeholder="Street, district" onChange={handleChange} className={SIDEBAR_INPUT} />
                  </SidebarField>
                  <SidebarField label="City & postal code">
                    <input name="company_location" value={formData.company_location || ''} placeholder="City, PIN" onChange={handleChange} className={SIDEBAR_INPUT} />
                  </SidebarField>
                  <SidebarField label="Phone / email on letterhead">
                    <input name="company_contact" value={formData.company_contact || ''} placeholder="contact@company.com | +91 …" onChange={handleChange} className={SIDEBAR_INPUT} />
                  </SidebarField>
                  <SidebarField label="Website (optional)">
                    <input name="company_website" value={formData.company_website || ''} placeholder="https://www.example.org" onChange={handleChange} className={SIDEBAR_INPUT} />
                  </SidebarField>
                </SidebarPanel>

                <SidebarPanel
                  title="Advanced letter wording"
                  description="Optional — change labels like Ref:, Date:, Dear"
                  icon={FileText}
                  open={sidebarPanels.advancedWording}
                  onToggle={() => toggleSidebarPanel('advancedWording')}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <SidebarField label="Reference label">
                      <input name="ref_label" value={formData.ref_label} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="Ref:" />
                    </SidebarField>
                    <SidebarField label="Date label">
                      <input name="date_label" value={formData.date_label} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="Date:" />
                    </SidebarField>
                    <SidebarField label="To label">
                      <input name="to_label" value={formData.to_label} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="To," />
                    </SidebarField>
                    <SidebarField label="Dear label">
                      <input name="dear_label" value={formData.dear_label} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="Dear" />
                    </SidebarField>
                  </div>
                  <SidebarField label="Letter heading">
                    <input name="letter_title" value={formData.letter_title} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="OFFER OF EMPLOYMENT" />
                  </SidebarField>
                  <SidebarField label="Signature line label">
                    <input name="signatory_label" value={formData.signatory_label} onChange={handleChange} className={SIDEBAR_INPUT} placeholder="Authorized Signatory" />
                  </SidebarField>
                </SidebarPanel>
              </div>
            ) : activeControlTab === 'components' ? (
              <div className="animate-in fade-in space-y-4 pb-16 duration-300">
                <div className="rounded-xl border border-violet-100 bg-violet-50/80 px-4 py-3 text-xs leading-relaxed text-violet-900">
                  <strong className="font-semibold">Tip:</strong> Click any text on the letter preview to edit it directly — that is usually the fastest way. Use the buttons below only when you need to add a new section.
                </div>

                <SidebarPanel title="Add a new section" description="Inserts at the bottom of the letter body" icon={Layers} collapsible={false}>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => addBlock('heading')} className="group flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3 transition-all hover:border-indigo-300 hover:bg-indigo-50">
                      <Type size={18} className="mb-1.5 text-slate-500 group-hover:text-indigo-600" />
                      <span className="text-xs font-medium text-slate-700">Section heading</span>
                    </button>
                    <button type="button" onClick={() => addBlock('paragraph')} className="group flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3 transition-all hover:border-indigo-300 hover:bg-indigo-50">
                      <AlignLeft size={18} className="mb-1.5 text-slate-500 group-hover:text-indigo-600" />
                      <span className="text-xs font-medium text-slate-700">Paragraph</span>
                    </button>
                    <button type="button" onClick={() => addBlock('table')} className="group col-span-2 flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 transition-all hover:border-indigo-300 hover:bg-indigo-50">
                      <Columns size={18} className="text-slate-500 group-hover:text-indigo-600" />
                      <span className="text-xs font-medium text-slate-700">Table (salary, benefits, etc.)</span>
                    </button>
                    <button type="button" onClick={() => addBlock('terms')} className="group col-span-2 flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 transition-all hover:border-indigo-300 hover:bg-indigo-50">
                      <FileText size={18} className="text-slate-500 group-hover:text-indigo-600" />
                      <span className="text-xs font-medium text-slate-700">Terms &amp; conditions</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Removed something by mistake? Click <strong>Undo block</strong> in the top bar.
                  </p>
                </SidebarPanel>

                <SidebarPanel
                  title="Edit sections here (optional)"
                  description={`${(formData.dynamic_content || []).length} block(s) in the letter`}
                  icon={PenLine}
                  open={sidebarPanels.contentBlocks}
                  onToggle={() => toggleSidebarPanel('contentBlocks')}
                >
                  <div className="space-y-3">
                    {(formData.dynamic_content || []).length === 0 ? (
                      <p className="text-xs text-slate-500">No extra sections yet. The letter starts with standard offer content.</p>
                    ) : null}
                    {(formData.dynamic_content || []).map((block) => (
                      <div key={block.id} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase text-slate-500">{block.type}</span>
                          <button type="button" onClick={() => deleteBlock(block.id)} className="text-[10px] font-bold text-red-500">Remove</button>
                        </div>
                        {block.type === 'paragraph' || block.type === 'heading' ? (
                          <textarea
                            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                            rows={3}
                            value={block.content || ''}
                            onChange={(e) => updateBlockContent(block.id, e.target.value)}
                          />
                        ) : null}
                        {block.type === 'terms' ? (
                          <div className="space-y-2">
                            <input
                              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold"
                              value={block.title || ''}
                              onChange={(e) => updateBlockStyle(block.id, 'title', e.target.value)}
                              placeholder="Section title"
                            />
                            {(block.items || []).map((item, idx) => (
                              <div key={idx} className="space-y-1 rounded border border-slate-100 bg-white p-2">
                                <input
                                  className="w-full rounded border border-slate-200 px-2 py-1 text-[11px] font-bold"
                                  value={item.label || ''}
                                  onChange={(e) => {
                                    const items = [...(block.items || [])];
                                    items[idx] = { ...items[idx], label: e.target.value };
                                    updateBlockStyle(block.id, 'items', items);
                                  }}
                                />
                                <textarea
                                  className="w-full rounded border border-slate-200 px-2 py-1 text-[11px]"
                                  rows={2}
                                  value={item.text || ''}
                                  onChange={(e) => {
                                    const items = [...(block.items || [])];
                                    items[idx] = { ...items[idx], text: e.target.value };
                                    updateBlockStyle(block.id, 'items', items);
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </SidebarPanel>
              </div>
            ) : (
              <div className="animate-in fade-in space-y-4 pb-16 duration-300">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
                  Choose how the letter looks. You can also drag the logo and company name directly on the preview.
                </div>

                <SidebarPanel title="Color theme" description="Accent colors for headings and tables" icon={Palette} collapsible={false}>
                  <div className="grid grid-cols-1 gap-2">
                    {Object.entries(THEMES).map(([id, theme]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => updateConfig('theme', id)}
                        className={`flex items-center justify-between rounded-lg border p-3 text-left transition-all ${
                          formData.theme === id
                            ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{theme.name}</p>
                          <div className="mt-1.5 flex gap-1">
                            <div className="h-4 w-4 rounded-full" style={{ backgroundColor: theme.primary }} />
                            <div className="h-4 w-4 rounded-full" style={{ backgroundColor: theme.secondary }} />
                            <div className="h-4 w-4 rounded-full" style={{ backgroundColor: theme.accent }} />
                          </div>
                        </div>
                        {formData.theme === id ? <CheckCircle2 size={18} className="text-indigo-600" /> : null}
                      </button>
                    ))}
                  </div>
                </SidebarPanel>

                <SidebarPanel title="Logo & signature" description="Shown on the letterhead and sign-off area" icon={ImageIcon} collapsible={false}>
                  <SidebarField label="Company logo">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        {formData.logo_config.url ? (
                          <button type="button" onClick={clearLogo} className="text-xs font-medium text-red-600 hover:underline">
                            Remove logo
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">No logo uploaded</span>
                        )}
                      </div>
                      <input type="file" id="logo-upload" className="hidden" accept="image/*" onChange={handleLogoUpload} />
                      <label
                        htmlFor="logo-upload"
                        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white p-4 transition-all hover:border-indigo-400 hover:bg-indigo-50/30"
                      >
                        {formData.logo_config.url ? (
                          <div className="flex items-center gap-3">
                            <img src={formData.logo_config.url} alt="Logo" className="h-10 w-10 object-contain" />
                            <span className="text-xs font-semibold text-indigo-700">Change logo</span>
                          </div>
                        ) : (
                          <>
                            <ImageIcon size={22} className="mb-1 text-slate-400" />
                            <span className="text-xs font-medium text-slate-600">Upload logo</span>
                          </>
                        )}
                      </label>
                    </div>
                  </SidebarField>

                  <SidebarField label="Authorized signature image">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        {formData.signature_config.url ? (
                          <button type="button" onClick={clearSignature} className="text-xs font-medium text-red-600 hover:underline">
                            Remove signature
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">No signature uploaded</span>
                        )}
                      </div>
                      <input type="file" id="sig-upload-sidebar" className="hidden" accept="image/*" onChange={handleSignatureUpload} />
                      <label
                        htmlFor="sig-upload-sidebar"
                        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white p-4 transition-all hover:border-indigo-400 hover:bg-indigo-50/30"
                      >
                        {formData.signature_config.url ? (
                          <div className="flex items-center gap-3">
                            <img src={formData.signature_config.url} alt="Signature" className="h-10 max-w-[120px] object-contain" />
                            <span className="text-xs font-semibold text-indigo-700">Change signature</span>
                          </div>
                        ) : (
                          <>
                            <FileText size={22} className="mb-1 text-slate-400" />
                            <span className="text-xs font-medium text-slate-600">Upload signature</span>
                          </>
                        )}
                      </label>
                    </div>
                  </SidebarField>
                </SidebarPanel>

                <SidebarPanel
                  title="Fine-tuning (optional)"
                  description="Font size, logo size, and layout width"
                  icon={LayoutIcon}
                  open={sidebarPanels.designAdvanced}
                  onToggle={() => toggleSidebarPanel('designAdvanced')}
                >
                  <SidebarField label={`Text size (${formData.font_size}px)`} hint="Affects the main body text across the letter.">
                    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <button
                        type="button"
                        onClick={() => updateConfig('font_size', Math.max(8, formData.font_size - 1))}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white font-bold text-slate-600 hover:bg-slate-100"
                      >
                        −
                      </button>
                      <span className="flex-1 text-center text-sm font-semibold text-slate-800">{formData.font_size}px</span>
                      <button
                        type="button"
                        onClick={() => updateConfig('font_size', Math.min(32, formData.font_size + 1))}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white font-bold text-slate-600 hover:bg-slate-100"
                      >
                        +
                      </button>
                    </div>
                  </SidebarField>

                  {formData.logo_config.url ? (
                    <>
                      <SidebarField label={`Logo width (${formData.logo_config.width}px)`}>
                        <input
                          type="range"
                          min="50"
                          max="400"
                          value={formData.logo_config.width}
                          onChange={(e) => updateNestedConfig('logo_config', 'width', parseInt(e.target.value, 10))}
                          className="h-2 w-full cursor-pointer accent-indigo-600"
                        />
                      </SidebarField>
                      <SidebarField label={`Logo height (${formData.logo_config.height}px)`}>
                        <input
                          type="range"
                          min="20"
                          max="200"
                          value={formData.logo_config.height}
                          onChange={(e) => updateNestedConfig('logo_config', 'height', parseInt(e.target.value, 10))}
                          className="h-2 w-full cursor-pointer accent-indigo-600"
                        />
                      </SidebarField>
                    </>
                  ) : null}

                  <SidebarField
                    label={`Company name block width (${(formData.company_block_config || {}).maxWidth ?? 280}px)`}
                    hint="Drag the company block on the preview, or adjust here."
                  >
                    <input
                      type="range"
                      min="180"
                      max="420"
                      value={(formData.company_block_config || {}).maxWidth ?? 280}
                      onChange={(e) =>
                        updateNestedConfig('company_block_config', 'maxWidth', parseInt(e.target.value, 10))
                      }
                      className="h-2 w-full cursor-pointer accent-indigo-600"
                    />
                  </SidebarField>
                </SidebarPanel>
              </div>
            )}
          </div>
        </div>

        <div
          ref={previewStageRef}
          className={`relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-gradient-to-br from-slate-300 to-slate-200 [scrollbar-gutter:stable] ${
            mobileWorkspace === 'edit' ? 'hidden' : 'block'
          } lg:block`}
        >
          <div className="flex min-h-full w-full flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
            <p className="mb-3 max-w-xl rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-center text-xs font-medium text-indigo-900">
              Click any text on the letter to edit. Use the left panel for candidate details, joining date, and branding. The downloaded PDF matches this preview.
            </p>
            <div className="mb-4 flex flex-wrap items-center justify-center gap-2 lg:hidden">
              <button
                type="button"
                onClick={() => {
                  setFitMode('width');
                  setZoomMultiplier(1);
                }}
                className="rounded-lg border border-slate-400/80 bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-700 shadow-sm"
              >
                Fit width
              </button>
              <button
                type="button"
                onClick={() => {
                  setFitMode('page');
                  setZoomMultiplier(1);
                }}
                className="rounded-lg border border-slate-400/80 bg-white/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-700 shadow-sm"
              >
                Fit page
              </button>
              <button
                type="button"
                onClick={() => setZoomMultiplier((z) => Math.max(0.5, Math.round((z - 0.1) * 100) / 100))}
                className="rounded-lg border border-slate-400/80 bg-white/95 p-2 text-slate-700 shadow-sm"
                aria-label="Zoom out"
              >
                <ZoomOut size={16} />
              </button>
              <span className="min-w-[3rem] rounded-md bg-white/95 px-2 py-1 text-center font-mono text-[11px] font-semibold tabular-nums text-slate-800 shadow-sm">
                {Math.round(canvasScale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoomMultiplier((z) => Math.min(1.6, Math.round((z + 0.1) * 100) / 100))}
                className="rounded-lg border border-slate-400/80 bg-white/95 p-2 text-slate-700 shadow-sm"
                aria-label="Zoom in"
              >
                <ZoomIn size={16} />
              </button>
            </div>
            <div className="mb-6 hidden items-center gap-3 rounded-full border border-slate-300/80 bg-white/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-sm backdrop-blur lg:flex">
              <Maximize2 size={12} className="text-indigo-500" />
              A4 canvas
              <span className="font-mono text-indigo-600 tabular-nums">{Math.round(canvasScale * 100)}%</span>
            </div>
            <div
              className="rounded-sm shadow-[0_16px_48px_-12px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/10"
              style={{
                width: A4_WIDTH * canvasScale,
                height: Math.max(A4_HEIGHT, paperLayoutHeight) * canvasScale,
                position: 'relative',
              }}
            >
              <div
                className="absolute left-0 top-0 shadow-none"
                style={{
                  width: A4_WIDTH,
                  minHeight: A4_HEIGHT,
                  transform: `scale(${canvasScale})`,
                  transformOrigin: 'top left',
                }}
              >
                <PreviewTemplate />
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </HRPageWrapper>
  );
}
