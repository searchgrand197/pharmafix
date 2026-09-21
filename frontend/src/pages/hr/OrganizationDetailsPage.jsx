import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { Building2, Image as ImageIcon, Save, Upload, X } from 'lucide-react';
import SetupWizardNav from '../../components/HR/SetupWizardNav';
import { isFromSetupWizard } from './setupWizardUtils';
import {
  normalizeOrganizationForm,
  ORGANIZATION_VALIDATED_FIELDS,
  validateOrganizationField,
  validateOrganizationForm,
  validateOrganizationImageFile,
} from '../../utils/organizationFormValidation';

const blank = {
  organization_name: '',
  organization_address: '',
  organization_location: '',
  organization_contact: '',
  organization_website: '',
  registered_office_address: '',
  corporate_office_address: '',
  company_registration_number: '',
  footer_confidentiality_note:
    'CONFIDENTIAL — This document is intended solely for the named recipient.',
  company_email: '',
  company_phone: '',
  hr_name: '',
  hr_designation: 'HR Manager',
  hr_email: '',
  hr_phone: '',
};

const EDITABLE_FIELDS = [
  'organization_name',
  'organization_address',
  'organization_location',
  'organization_contact',
  'organization_website',
  'registered_office_address',
  'corporate_office_address',
  'company_registration_number',
  'footer_confidentiality_note',
  'company_email',
  'company_phone',
  'hr_name',
  'hr_designation',
  'hr_email',
  'hr_phone',
];

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

function resolveMediaUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname.startsWith('/media/')) {
      return `${window.location.origin}${parsed.pathname}${parsed.search}`;
    }
    return parsed.href;
  } catch {
    return url;
  }
}

function errorText(error, fallback = 'Could not save organization settings') {
  const data = error?.response?.data;
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (data.detail || data.error) return data.detail || data.error;
  const key = Object.keys(data)[0];
  const val = data[key];
  if (Array.isArray(val)) return `${key}: ${val.join(', ')}`;
  if (typeof val === 'string') return `${key}: ${val}`;
  return fallback;
}

function mapApiFieldErrors(data) {
  if (!data || typeof data !== 'object') return {};
  const mapped = {};
  Object.entries(data).forEach(([key, val]) => {
    if (key === 'detail' || key === 'error') return;
    const message = Array.isArray(val) ? val.join(', ') : String(val);
    mapped[key] = message;
  });
  return mapped;
}

function FieldError({ message }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <span className={`mt-0.5 block text-[11px] ${hint ? 'text-slate-400' : 'invisible'}`}>
        {hint || '\u00a0'}
      </span>
      <div className="mt-1">{children}</div>
      <FieldError message={error} />
    </label>
  );
}

function ImageUploadBlock({
  label,
  previewSrc,
  error,
  inputRef,
  uploadLabel,
  onFileSelect,
  onRemove,
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-600">
        <ImageIcon size={14} /> {label}
      </p>
      <div className="mb-3 flex min-h-20 items-center justify-center rounded border border-dashed border-slate-200 bg-white p-2">
        {previewSrc ? (
          <img src={previewSrc} alt={label} className="max-h-16 max-w-full object-contain" />
        ) : (
          <p className="text-xs text-slate-400">No image yet</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
        >
          <Upload size={14} />
          {uploadLabel}
        </button>
        {previewSrc ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <X size={14} />
            Remove
          </button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          onFileSelect(e.target.files?.[0] || null);
          e.target.value = '';
        }}
        aria-invalid={Boolean(error)}
      />
      <FieldError message={error} />
    </div>
  );
}

export default function OrganizationDetailsPage() {
  const [searchParams] = useSearchParams();
  const fromSetupWizard = isFromSetupWizard(searchParams);
  const logoInputRef = useRef(null);
  const signatureInputRef = useRef(null);

  const [form, setForm] = useState(blank);
  const [logoFile, setLogoFile] = useState(null);
  const [signatureFile, setSignatureFile] = useState(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [signatureUrl, setSignatureUrl] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [signaturePreview, setSignaturePreview] = useState('');
  const [clearLogo, setClearLogo] = useState(false);
  const [clearSignature, setClearSignature] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  const inputClass = (field) => [
    'w-full rounded-lg border px-3 py-2 text-sm',
    errors[field] ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-slate-200',
  ].join(' ');

  const logoDisplaySrc = logoPreview || (!clearLogo && logoUrl) || '';
  const signatureDisplaySrc = signaturePreview || (!clearSignature && signatureUrl) || '';

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    if (signaturePreview) URL.revokeObjectURL(signaturePreview);
  }, [logoPreview, signaturePreview]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/hr/organization-settings/current/');
      setForm({ ...blank, ...data });
      setLogoUrl(resolveMediaUrl(data.logo_url || ''));
      setSignatureUrl(resolveMediaUrl(data.signature_url || ''));
      setClearLogo(false);
      setClearSignature(false);
    } catch (error) {
      toast.error(errorText(error, 'Could not load organization settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Hospital Details | HR';
    load();
  }, [load]);

  const applyFieldError = (field, nextForm) => {
    const message = validateOrganizationField(field, nextForm);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  };

  function setField(name, value) {
    const nextForm = { ...form, [name]: value };
    setForm(nextForm);
    if (touched[name] || name === 'company_email' || name === 'company_phone') {
      applyFieldError(name, nextForm);
      if (name === 'company_email' || name === 'company_phone') {
        const paired = name === 'company_email' ? 'company_phone' : 'company_email';
        applyFieldError(paired, nextForm);
      }
    }
  }

  function markTouched(field) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    applyFieldError(field, form);
    if (field === 'company_email' || field === 'company_phone') {
      const paired = field === 'company_email' ? 'company_phone' : 'company_email';
      applyFieldError(paired, form);
    }
  }

  function handleLogoChange(file) {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setClearLogo(false);
    setLogoPreview(file ? URL.createObjectURL(file) : '');
    const message = validateOrganizationImageFile(file);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next.logo = message;
      else delete next.logo;
      return next;
    });
  }

  function handleSignatureChange(file) {
    if (signaturePreview) URL.revokeObjectURL(signaturePreview);
    setSignatureFile(file);
    setClearSignature(false);
    setSignaturePreview(file ? URL.createObjectURL(file) : '');
    const message = validateOrganizationImageFile(file);
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next.signature = message;
      else delete next.signature;
      return next;
    });
  }

  function handleLogoRemove() {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview('');
    if (logoUrl) setClearLogo(true);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.logo;
      return next;
    });
  }

  function handleSignatureRemove() {
    if (signaturePreview) URL.revokeObjectURL(signaturePreview);
    setSignatureFile(null);
    setSignaturePreview('');
    if (signatureUrl) setClearSignature(true);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.signature;
      return next;
    });
  }

  async function save(event) {
    event.preventDefault();
    setTouched(Object.fromEntries(ORGANIZATION_VALIDATED_FIELDS.map((field) => [field, true])));

    const nextErrors = validateOrganizationForm(form, { logoFile, signatureFile });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('Please fix the highlighted fields.');
      return;
    }

    setSaving(true);
    const normalized = normalizeOrganizationForm(form);
    const body = {};
    EDITABLE_FIELDS.forEach((key) => {
      body[key] = normalized[key] ?? '';
    });

    try {
      let data;
      const hasImageChanges = logoFile || signatureFile || clearLogo || clearSignature;
      if (hasImageChanges) {
        const payload = new FormData();
        Object.entries(body).forEach(([key, value]) => {
          payload.append(key, value ?? '');
        });
        if (logoFile) payload.append('logo', logoFile);
        if (signatureFile) payload.append('signature', signatureFile);
        if (clearLogo) payload.append('clear_logo', 'true');
        if (clearSignature) payload.append('clear_signature', 'true');
        ({ data } = await api.patch('/hr/organization-settings/current/', payload, {
          headers: { 'Content-Type': 'multipart/form-data' },
        }));
      } else {
        ({ data } = await api.patch('/hr/organization-settings/current/', body));
      }
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      if (signaturePreview) URL.revokeObjectURL(signaturePreview);
      setForm({ ...blank, ...data });
      setLogoUrl(resolveMediaUrl(data.logo_url || ''));
      setSignatureUrl(resolveMediaUrl(data.signature_url || ''));
      setLogoFile(null);
      setSignatureFile(null);
      setLogoPreview('');
      setSignaturePreview('');
      setClearLogo(false);
      setClearSignature(false);
      setErrors({});
      toast.success('Hospital details saved');
    } catch (error) {
      const apiErrors = mapApiFieldErrors(error?.response?.data);
      if (Object.keys(apiErrors).length > 0) {
        setErrors((prev) => ({ ...prev, ...apiErrors }));
      }
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 pb-12">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Building2 className="text-violet-600" size={24} />
          Hospital Details
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Your hospital&apos;s name, address, and HR contact — used on offer letters, payslips, and HR emails.
        </p>
      </div>

      <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Fill this in once. Details appear when you send{' '}
        <Link to="/hr/recruitment/offers" className="font-medium text-violet-700 hover:underline">
          offer letters
        </Link>
        , email candidates, and onboard new staff. Save at the bottom when you are done.
      </p>

      <form onSubmit={save} className="space-y-6" noValidate>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">1. Hospital details</h2>
            <p className="text-xs text-slate-500">Shown at the top of offer letters and official emails.</p>
          </div>

          <Field
            label="Hospital / company name *"
            hint="e.g. City Care Hospital Pvt Ltd"
            error={errors.organization_name}
          >
            <input
              className={inputClass('organization_name')}
              placeholder="Your hospital name"
              value={form.organization_name || ''}
              onChange={(e) => setField('organization_name', e.target.value)}
              onBlur={() => markTouched('organization_name')}
              aria-invalid={Boolean(errors.organization_name)}
            />
          </Field>

          <Field
            label="Full address *"
            hint="Street, building, area"
            error={errors.organization_address}
          >
            <textarea
              className={`${inputClass('organization_address')} min-h-20`}
              placeholder="123 Main Road, Sector 5"
              value={form.organization_address || ''}
              onChange={(e) => setField('organization_address', e.target.value)}
              onBlur={() => markTouched('organization_address')}
              aria-invalid={Boolean(errors.organization_address)}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City & pincode" error={errors.organization_location}>
              <input
                className={inputClass('organization_location')}
                placeholder="e.g. Mumbai 400001"
                value={form.organization_location || ''}
                onChange={(e) => setField('organization_location', e.target.value)}
                onBlur={() => markTouched('organization_location')}
                aria-invalid={Boolean(errors.organization_location)}
              />
            </Field>
            <Field label="Website (optional)" error={errors.organization_website}>
              <input
                className={inputClass('organization_website')}
                placeholder="https://yourhospital.com"
                value={form.organization_website || ''}
                onChange={(e) => setField('organization_website', e.target.value)}
                onBlur={() => markTouched('organization_website')}
                aria-invalid={Boolean(errors.organization_website)}
              />
            </Field>
            <Field label="Main phone *" hint="10-digit mobile number" error={errors.company_phone}>
              <input
                className={inputClass('company_phone')}
                placeholder="9876543210"
                inputMode="numeric"
                maxLength={14}
                value={form.company_phone || ''}
                onChange={(e) => setField('company_phone', e.target.value)}
                onBlur={() => markTouched('company_phone')}
                aria-invalid={Boolean(errors.company_phone)}
              />
            </Field>
            <Field label="Main email *" error={errors.company_email}>
              <input
                type="email"
                className={inputClass('company_email')}
                placeholder="hr@yourhospital.com"
                value={form.company_email || ''}
                onChange={(e) => setField('company_email', e.target.value)}
                onBlur={() => markTouched('company_email')}
                aria-invalid={Boolean(errors.company_email)}
              />
            </Field>
          </div>
          <p className="text-[11px] text-slate-400">* Required — provide at least one of main phone or main email.</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">2. HR signatory</h2>
            <p className="text-xs text-slate-500">Who signs offer letters and appears as the HR contact.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name *" error={errors.hr_name}>
              <input
                className={inputClass('hr_name')}
                placeholder="e.g. Priya Sharma"
                value={form.hr_name || ''}
                onChange={(e) => setField('hr_name', e.target.value)}
                onBlur={() => markTouched('hr_name')}
                aria-invalid={Boolean(errors.hr_name)}
              />
            </Field>
            <Field label="Designation *" error={errors.hr_designation}>
              <input
                className={inputClass('hr_designation')}
                placeholder="HR Manager"
                value={form.hr_designation || ''}
                onChange={(e) => setField('hr_designation', e.target.value)}
                onBlur={() => markTouched('hr_designation')}
                aria-invalid={Boolean(errors.hr_designation)}
              />
            </Field>
            <Field label="Email" error={errors.hr_email}>
              <input
                type="email"
                className={inputClass('hr_email')}
                placeholder="priya@yourhospital.com"
                value={form.hr_email || ''}
                onChange={(e) => setField('hr_email', e.target.value)}
                onBlur={() => markTouched('hr_email')}
                aria-invalid={Boolean(errors.hr_email)}
              />
            </Field>
            <Field label="Phone" hint="10-digit mobile number" error={errors.hr_phone}>
              <input
                className={inputClass('hr_phone')}
                placeholder="9876543210"
                inputMode="numeric"
                maxLength={14}
                value={form.hr_phone || ''}
                onChange={(e) => setField('hr_phone', e.target.value)}
                onBlur={() => markTouched('hr_phone')}
                aria-invalid={Boolean(errors.hr_phone)}
              />
            </Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">3. Logo &amp; signature</h2>
            <p className="text-xs text-slate-500">Optional but recommended — JPG/PNG up to 5 MB.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ImageUploadBlock
              label="Company logo"
              previewSrc={logoDisplaySrc}
              error={errors.logo}
              inputRef={logoInputRef}
              uploadLabel="Upload logo"
              onFileSelect={handleLogoChange}
              onRemove={handleLogoRemove}
            />
            <ImageUploadBlock
              label="HR signature"
              previewSrc={signatureDisplaySrc}
              error={errors.signature}
              inputRef={signatureInputRef}
              uploadLabel="Upload signature"
              onFileSelect={handleSignatureChange}
              onRemove={handleSignatureRemove}
            />
          </div>
        </section>

        <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
            Advanced — legal footer &amp; extra addresses
          </summary>
          <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-3">
            <Field label="Registered office address (optional)" error={errors.registered_office_address}>
              <textarea
                className={`${inputClass('registered_office_address')} min-h-16`}
                value={form.registered_office_address || ''}
                onChange={(e) => setField('registered_office_address', e.target.value)}
                onBlur={() => markTouched('registered_office_address')}
                aria-invalid={Boolean(errors.registered_office_address)}
              />
            </Field>
            <Field label="Corporate office address (optional)" error={errors.corporate_office_address}>
              <textarea
                className={`${inputClass('corporate_office_address')} min-h-16`}
                value={form.corporate_office_address || ''}
                onChange={(e) => setField('corporate_office_address', e.target.value)}
                onBlur={() => markTouched('corporate_office_address')}
                aria-invalid={Boolean(errors.corporate_office_address)}
              />
            </Field>
            <Field
              label="CIN / company registration number (optional)"
              hint="e.g. U74999MH2020PTC123456"
              error={errors.company_registration_number}
            >
              <input
                className={inputClass('company_registration_number')}
                placeholder="e.g. U74999MH2020PTC123456"
                value={form.company_registration_number || ''}
                onChange={(e) => setField('company_registration_number', e.target.value.toUpperCase())}
                onBlur={() => markTouched('company_registration_number')}
                aria-invalid={Boolean(errors.company_registration_number)}
              />
            </Field>
            <Field label="Confidentiality note on offer letter footer" error={errors.footer_confidentiality_note}>
              <textarea
                className={`${inputClass('footer_confidentiality_note')} min-h-16`}
                value={form.footer_confidentiality_note || ''}
                onChange={(e) => setField('footer_confidentiality_note', e.target.value)}
                onBlur={() => markTouched('footer_confidentiality_note')}
                aria-invalid={Boolean(errors.footer_confidentiality_note)}
              />
            </Field>
          </div>
        </details>

        <button
          type="submit"
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60 sm:w-auto"
        >
          <Save size={16} />
          {saving ? 'Saving…' : 'Save hospital details'}
        </button>

        <SetupWizardNav className="border-t border-slate-100 pt-4" />
      </form>

      {!fromSetupWizard && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            to="/hr/settings/organization"
            className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-violet-700 hover:bg-violet-50"
          >
            Organization Settings
          </Link>
          <Link
            to="/hr/recruitment/offers"
            className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-violet-700 hover:bg-violet-50"
          >
            Offer letters
          </Link>
        </div>
      )}
    </div>
  );
}
