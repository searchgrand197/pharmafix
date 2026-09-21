import React from 'react'
import {
  GUARDIAN_RELATIONSHIP_OPTIONS,
  SALUTATION_CHOICE_OPTIONS,
} from '../print/opdPrintFormat'
import {
  AGE_UNIT_OPTIONS,
  INDIAN_STATE_OPTIONS,
  capitalizePersonName,
  normalizeAgeUnit,
  sanitizePersonName,
} from './patientRegistrationUtils'

const TF_CLS =
  'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none'
const LBL_CLS = 'text-xs font-bold text-gray-800 mb-1 block'

function SectionHeading({ children }) {
  return (
    <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide border-b border-gray-200 pb-2 mb-3 col-span-full">
      {children}
    </h3>
  )
}

function AgeWithUnitInput({ value, unit, onValueChange, onUnitChange, inputClassName }) {
  return (
    <div className="flex gap-1">
      <input
        type="number"
        min="0"
        value={value}
        onChange={(e) => onValueChange(e.target.value.replace(/\D/g, '').slice(0, 3))}
        placeholder="Age"
        className={inputClassName}
        style={{ flex: 1, minWidth: 0 }}
      />
      <select
        value={normalizeAgeUnit(unit)}
        onChange={(e) => onUnitChange(e.target.value)}
        className={inputClassName}
        style={{ width: 'auto', minWidth: '4.5rem' }}
      >
        {AGE_UNIT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export default function PatientRegistrationForm({
  form,
  setForm,
  onSubmit,
  submitting = false,
  submitLabel = 'Register Patient',
  footerExtra = null,
  showFooter = true,
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <SectionHeading>Patient details</SectionHeading>

        <div>
          <label className={LBL_CLS}>Full name *</label>
          <div className="flex w-full min-w-0 rounded-xl border border-gray-200 overflow-hidden items-stretch focus-within:ring-2 focus-within:ring-emerald-500 focus-within:border-emerald-400">
            <select
              value={form.salutation_choice}
              onChange={(e) => setForm((f) => ({ ...f, salutation_choice: e.target.value }))}
              className="shrink-0 w-[5.25rem] sm:w-28 border-0 border-r border-gray-200 bg-gray-50 py-2 pl-2 pr-1 text-xs sm:text-sm font-bold text-gray-800 focus:outline-none cursor-pointer"
              aria-label="Title (Mr, Mrs, …)"
            >
              {SALUTATION_CHOICE_OPTIONS.map((o) => (
                <option key={o.value || '_none'} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              value={form.full_name}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  full_name: capitalizePersonName(sanitizePersonName(e.target.value)),
                }))
              }
              placeholder="Patient full name"
              required
              className="flex-1 min-w-0 border-0 bg-transparent py-2 px-3 text-sm font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className={LBL_CLS}>Age</label>
          <AgeWithUnitInput
            value={form.age}
            unit={form.ageUnit}
            onValueChange={(next) => setForm((f) => ({ ...f, age: next }))}
            onUnitChange={(next) => setForm((f) => ({ ...f, ageUnit: next }))}
            inputClassName={TF_CLS}
          />
        </div>
        <div>
          <label className={LBL_CLS}>Gender</label>
          <select
            className={TF_CLS}
            value={form.gender}
            onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className={LBL_CLS}>Blood group</label>
          <select
            className={TF_CLS}
            value={form.blood_group}
            onChange={(e) => setForm((f) => ({ ...f, blood_group: e.target.value }))}
          >
            <option value="">Unknown</option>
            {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        <SectionHeading>Contact &amp; guardian</SectionHeading>

        <div>
          <label className={LBL_CLS}>Mobile</label>
          <input
            type="tel"
            maxLength={10}
            className={TF_CLS}
            value={form.phone}
            placeholder="10-digit mobile number"
            onChange={(e) =>
              setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))
            }
          />
        </div>
        <div>
          <label className={LBL_CLS}>Guardian relation</label>
          <select
            className={TF_CLS}
            value={form.guardian_relationship}
            onChange={(e) => setForm((f) => ({ ...f, guardian_relationship: e.target.value }))}
            aria-label="Relation to guardian"
          >
            <option value="">Select relation…</option>
            {GUARDIAN_RELATIONSHIP_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={LBL_CLS}>Guardian name</label>
          <input
            className={TF_CLS}
            value={form.guardian_name}
            placeholder="Guardian name"
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                guardian_name: capitalizePersonName(sanitizePersonName(e.target.value)),
              }))
            }
          />
        </div>
        <div>
          <label className={LBL_CLS}>Street / locality</label>
          <input
            className={TF_CLS}
            value={form.address_line1}
            placeholder="House no., street, area"
            onChange={(e) => setForm((f) => ({ ...f, address_line1: e.target.value }))}
          />
        </div>

        <SectionHeading>Address</SectionHeading>

        <div>
          <label className={LBL_CLS}>City</label>
          <input
            className={TF_CLS}
            value={form.city}
            placeholder="City"
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
        </div>
        <div>
          <label className={LBL_CLS}>State</label>
          <select
            className={TF_CLS}
            value={form.state}
            onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
          >
            <option value="">Select state…</option>
            {INDIAN_STATE_OPTIONS.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>

        <SectionHeading>Notes</SectionHeading>

        <div>
          <label className={LBL_CLS}>Emergency tags</label>
          <input
            className={TF_CLS}
            value={form.emergency_tags}
            placeholder="Comma-separated tags (optional)"
            onChange={(e) => setForm((f) => ({ ...f, emergency_tags: e.target.value }))}
          />
        </div>
        <div>
          <label className={LBL_CLS}>Registration note</label>
          <textarea
            rows={3}
            maxLength={2000}
            className={`${TF_CLS} resize-y min-h-[88px]`}
            value={form.registration_note}
            placeholder="Optional — why this patient is being registered"
            onChange={(e) => setForm((f) => ({ ...f, registration_note: e.target.value }))}
          />
          <p className="text-[11px] text-gray-400 mt-1">{form.registration_note?.length || 0} / 2000</p>
        </div>
      </div>

      {showFooter && (
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          {footerExtra}
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 rounded-xl text-sm font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? 'Registering…' : submitLabel}
          </button>
        </div>
      )}
    </form>
  )
}
