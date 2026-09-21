import React, { useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { Image as ImageIcon, Save } from 'lucide-react';

const blank = {
  organization_name: '',
  organization_address: '',
  organization_location: '',
  organization_contact: '',
  organization_website: '',
  hr_name: '',
  hr_designation: 'HR Manager',
};

const nonEditablePayloadFields = new Set([
  'id',
  'created_at',
  'updated_at',
  'hospital',
  'logo',
  'signature',
  'logo_url',
  'signature_url',
  'logo_config',
  'signature_config',
]);

function errorText(error, fallback = 'Could not save offer settings') {
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

/**
 * Organization / HR defaults for offer letters (saved to /hr/offer-letter-settings/current/).
 */
export default function OfferLetterSettingsPanel() {
  const [form, setForm] = useState(blank);
  const [logoFile, setLogoFile] = useState(null);
  const [signatureFile, setSignatureFile] = useState(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [signatureUrl, setSignatureUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get('/hr/offer-letter-settings/current/');
        setForm({ ...blank, ...data });
        setLogoUrl(data.logo_url || '');
        setSignatureUrl(data.signature_url || '');
      } catch (error) {
        toast.error(errorText(error, 'Could not load offer settings'));
      }
    }
    load();
  }, []);

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (!nonEditablePayloadFields.has(key)) {
        payload.append(key, value || '');
      }
    });
    if (logoFile) payload.append('logo', logoFile);
    if (signatureFile) payload.append('signature', signatureFile);

    try {
      const { data } = await api.patch('/hr/offer-letter-settings/current/', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm({ ...blank, ...data });
      setLogoUrl(data.logo_url || '');
      setSignatureUrl(data.signature_url || '');
      setLogoFile(null);
      setSignatureFile(null);
      toast.success('Offer letter settings saved');
    } catch (error) {
      console.error('Offer settings save failed', error?.response?.data || error);
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-gray-900">Offer letter settings</h3>
        <p className="mt-1 text-sm text-gray-600">
          Organization and HR details reused by new offer letters. Changes apply to offers you create after saving.
        </p>
      </div>

      <form onSubmit={save} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid gap-5 md:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Organization name
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={form.organization_name || ''}
              onChange={(e) => setField('organization_name', e.target.value)}
              placeholder="Curevice Pvt Ltd"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Location
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={form.organization_location || ''}
              onChange={(e) => setField('organization_location', e.target.value)}
              placeholder="City, PIN"
            />
          </label>
          <label className="md:col-span-2 text-sm font-semibold text-slate-700">
            Organization address
            <textarea
              className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={form.organization_address || ''}
              onChange={(e) => setField('organization_address', e.target.value)}
              placeholder="Street, area, district"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Contact info
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={form.organization_contact || ''}
              onChange={(e) => setField('organization_contact', e.target.value)}
              placeholder="hr@example.com | +91..."
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Website
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={form.organization_website || ''}
              onChange={(e) => setField('organization_website', e.target.value)}
              placeholder="https://www.example.com"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            HR name
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={form.hr_name || ''}
              onChange={(e) => setField('hr_name', e.target.value)}
              placeholder="HR Manager name"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            HR designation
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={form.hr_designation || ''}
              onChange={(e) => setField('hr_designation', e.target.value)}
              placeholder="HR Manager"
            />
          </label>

          <div className="rounded-xl border border-slate-200 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ImageIcon size={16} /> Organization logo
            </p>
            {logoUrl ? (
              <img src={logoUrl} alt="Organization logo" className="mb-3 max-h-24 rounded border border-slate-100 object-contain" />
            ) : null}
            <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} className="text-sm" />
          </div>

          <div className="rounded-xl border border-slate-200 p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ImageIcon size={16} /> HR signature
            </p>
            {signatureUrl ? (
              <img src={signatureUrl} alt="HR signature" className="mb-3 max-h-24 rounded border border-slate-100 object-contain" />
            ) : null}
            <input type="file" accept="image/*" onChange={(e) => setSignatureFile(e.target.files?.[0] || null)} className="text-sm" />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
