import DischargePrescriptionPanel from '../DischargePrescriptionPanel'
import DischargeSuggestibleInput from './DischargeSuggestibleInput'
import { AmPmTimeInput, FormattedDateInput, toHtmlTimeValue } from '../DateTimeInputs'
import {
  DISCHARGE_ADVICE_FIELDS,
  DISCHARGE_COURSE_FIELDS,
  DISCHARGE_NARRATIVE_FIELDS,
  DISCHARGE_VITAL_FIELDS,
} from './dischargeFormUtils'

export default function DischargeClinicalForm({
  sectionIdPrefix,
  summary,
  setSummary,
  surgeryDraft,
  updateSurgeryDraftField,
  saveSurgeryRow,
  resetSurgeryDraft,
  editingSurgeryIndex,
  editSurgeryRow,
  removeSurgeryRow,
  dischargeRxItems,
  setDischargeRxItems,
  setVital,
  addInvRow,
  updateInvRow,
  removeInvRow,
  getSuggestions,
  dsInp,
  dsLbl,
  dosagePatternOptions,
  timingOptions,
  footer = null,
}) {
  const sid = (name) => `${sectionIdPrefix}-${name}`

  const setField = (key, value) => setSummary((s) => ({ ...s, [key]: value }))

  return (
    <div className="space-y-4">
      <details id={sid('metadata')} open className="scroll-mt-3 bg-white rounded-xl border border-slate-200 shadow-sm">
        <summary className="px-3 py-2 cursor-pointer text-xs font-black uppercase tracking-wide text-slate-600 bg-slate-100 hover:bg-slate-200/80">Discharge metadata &amp; identifiers</summary>
        <div className="px-4 sm:px-5 py-4 space-y-4 bg-slate-50/70 border-t border-slate-200">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><span className={dsLbl}>Discharge type</span>
              <select value={summary.discharge_type} onChange={(e) => setField('discharge_type', e.target.value)} className={dsInp}>
                {[['routine', 'Routine'], ['lama', 'LAMA'], ['dama', 'DAMA'], ['referred', 'Referred'], ['transferred', 'Transferred'], ['death', 'Death'], ['absconded', 'Absconded']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div><span className={dsLbl}>Condition / status</span>
              <select value={summary.discharge_status} onChange={(e) => setField('discharge_status', e.target.value)} className={dsInp}>
                {[['cured', 'Cured'], ['improved', 'Improved'], ['unchanged', 'Unchanged'], ['worsened', 'Worsened'], ['deceased', 'Deceased']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div><span className={dsLbl}>Mode of admission</span>
              <select value={summary.mode_of_admission} onChange={(e) => setField('mode_of_admission', e.target.value)} className={dsInp}>
                <option value="emergency">Emergency</option><option value="opd">OPD</option><option value="referral">Referral</option>
              </select></div>
            <DischargeSuggestibleInput
              label="Condition at discharge (text)"
              value={summary.condition_at_discharge}
              onChange={(v) => setField('condition_at_discharge', v)}
              suggestions={getSuggestions('condition_at_discharge')}
              placeholder="e.g. Stable, afebrile"
              className={dsInp}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <span className={dsLbl}>Discharge date</span>
              <FormattedDateInput
                value={summary.discharge_date || ''}
                onChange={(v) => setField('discharge_date', v)}
                className={dsInp}
              />
            </div>
            <div className="min-w-0 sm:col-span-1">
              <span className={dsLbl}>Discharge time</span>
              <AmPmTimeInput
                value={toHtmlTimeValue(summary.discharge_time)}
                onChange={(v) => setField('discharge_time', v)}
                selectClassName={dsInp}
              />
            </div>
            <div>
              <span className={dsLbl}>Next follow-up</span>
              <FormattedDateInput
                value={summary.next_follow_up_date || ''}
                onChange={(v) => setField('next_follow_up_date', v)}
                className={dsInp}
              />
            </div>
            <div>
              <span className={dsLbl}>Stitch removal</span>
              <FormattedDateInput
                value={summary.stitch_removal_date || ''}
                onChange={(v) => setField('stitch_removal_date', v)}
                className={dsInp}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <DischargeSuggestibleInput label="Treating consultant" value={summary.treating_consultant} onChange={(v) => setField('treating_consultant', v)} suggestions={getSuggestions('treating_consultant')} className={dsInp} />
            <DischargeSuggestibleInput label="Consultant reg. no." value={summary.consultant_registration_no} onChange={(v) => setField('consultant_registration_no', v)} suggestions={getSuggestions('consultant_registration_no')} className={dsInp} />
            <DischargeSuggestibleInput label="RMO / Signatory name" value={summary.rmo_signed_by} onChange={(v) => setField('rmo_signed_by', v)} suggestions={getSuggestions('rmo_signed_by')} className={dsInp} />
            <DischargeSuggestibleInput label="Follow-up doctor" value={summary.follow_up_doctor} onChange={(v) => setField('follow_up_doctor', v)} suggestions={getSuggestions('follow_up_doctor')} placeholder="Doctor name" className={dsInp} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <DischargeSuggestibleInput label="Follow-up department" value={summary.follow_up_department} onChange={(v) => setField('follow_up_department', v)} suggestions={getSuggestions('follow_up_department')} placeholder="Department" className={dsInp} />
            <DischargeSuggestibleInput label="Referred to facility" value={summary.referred_to_facility} onChange={(v) => setField('referred_to_facility', v)} suggestions={getSuggestions('referred_to_facility')} className={dsInp} />
            <div className="sm:col-span-2 lg:col-span-2">
              <DischargeSuggestibleInput label="Referral reason" value={summary.referral_reason} onChange={(v) => setField('referral_reason', v)} suggestions={getSuggestions('referral_reason')} className={dsInp} />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-200">
            <div className="sm:col-span-2"><DischargeSuggestibleInput label="ABHA ID" value={summary.abha_id} onChange={(v) => setField('abha_id', v)} suggestions={getSuggestions('abha_id')} className={dsInp} /></div>
            <div className="sm:col-span-2"><DischargeSuggestibleInput label="Insurance provider" value={summary.insurance_provider} onChange={(v) => setField('insurance_provider', v)} suggestions={getSuggestions('insurance_provider')} className={dsInp} /></div>
            <DischargeSuggestibleInput label="TPA" value={summary.tpa_name} onChange={(v) => setField('tpa_name', v)} suggestions={getSuggestions('tpa_name')} className={dsInp} />
            <DischargeSuggestibleInput label="Policy no." value={summary.policy_number} onChange={(v) => setField('policy_number', v)} suggestions={getSuggestions('policy_number')} className={dsInp} />
            <DischargeSuggestibleInput label="Claim no." value={summary.claim_number} onChange={(v) => setField('claim_number', v)} suggestions={getSuggestions('claim_number')} className={dsInp} />
            <div className="flex items-center gap-2.5 pt-5">
              <input type="checkbox" id={`${sectionIdPrefix}_edu`} checked={summary.patient_education_given} onChange={(e) => setField('patient_education_given', e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-emerald-600 cursor-pointer" />
              <label htmlFor={`${sectionIdPrefix}_edu`} className="text-xs font-semibold text-slate-600 uppercase tracking-wide cursor-pointer select-none">Patient education given</label>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="col-span-2 sm:col-span-2"><DischargeSuggestibleInput label="Attendant counselled by" value={summary.attendant_counselled_by} onChange={(v) => setField('attendant_counselled_by', v)} suggestions={getSuggestions('attendant_counselled_by')} className={dsInp} /></div>
          </div>
        </div>
      </details>

      {summary.discharge_type === 'death' && (
        <details id={sid('death')} open className="scroll-mt-3 bg-red-50 rounded-xl border border-red-200 shadow-sm">
          <summary className="px-3 py-2 cursor-pointer text-xs font-black uppercase tracking-wide text-red-800 bg-red-100">Death summary</summary>
          <div className="px-5 py-5 grid grid-cols-1 sm:grid-cols-2 gap-6 bg-red-50/60 border-t border-red-200">
            <div className="sm:col-span-2">
              <DischargeSuggestibleInput label="Cause of death" value={summary.cause_of_death} onChange={(v) => setField('cause_of_death', v)} suggestions={getSuggestions('cause_of_death')} multiline className={dsInp} />
            </div>
            <div><span className={dsLbl}>Time of death</span><input type="datetime-local" value={summary.time_of_death ? String(summary.time_of_death).slice(0, 16) : ''} onChange={(e) => setField('time_of_death', e.target.value ? `${e.target.value}:00` : '')} className={dsInp} /></div>
            <DischargeSuggestibleInput label="Notified to" value={summary.notified_to} onChange={(v) => setField('notified_to', v)} suggestions={getSuggestions('notified_to')} className={dsInp} />
            <label className="flex items-center gap-2 text-sm text-slate-800 pt-5"><input type="checkbox" checked={summary.autopsy_required} onChange={(e) => setField('autopsy_required', e.target.checked)} /> Autopsy required</label>
          </div>
        </details>
      )}

      <details id={sid('narrative')} open className="scroll-mt-3 bg-white rounded-xl border border-slate-200 shadow-sm">
        <summary className="px-3 py-2 cursor-pointer text-xs font-black uppercase tracking-wide text-slate-600 bg-slate-100 hover:bg-slate-200/80">Clinical narrative</summary>
        <div className="px-5 py-5 space-y-5 bg-slate-50/70 border-t border-slate-200">
          <DischargeSuggestibleInput label="Discharge summary / overview" value={summary.summary_notes} onChange={(v) => setField('summary_notes', v)} suggestions={getSuggestions('summary_notes')} multiline placeholder="Brief overview..." className={dsInp} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {DISCHARGE_NARRATIVE_FIELDS.filter(([k]) => k !== 'summary_notes').map(([k, l]) => {
              if (k === 'physical_examination') {
                return (
                  <div key={k} className="md:col-span-2">
                    <span className={dsLbl}>{l}</span>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-4 mt-2 mb-3">
                      {DISCHARGE_VITAL_FIELDS.map((vk) => (
                        <DischargeSuggestibleInput
                          key={vk}
                          label={vk === 'bp' ? 'BP' : vk.toUpperCase()}
                          value={(summary.vitals_at_discharge || {})[vk] || ''}
                          onChange={(v) => setVital(vk, v)}
                          suggestions={getSuggestions(vk, 'vitals')}
                          className={dsInp}
                        />
                      ))}
                    </div>
                    <DischargeSuggestibleInput
                      value={summary.physical_examination}
                      onChange={(v) => setField('physical_examination', v)}
                      suggestions={getSuggestions('physical_examination')}
                      multiline
                      className={dsInp}
                    />
                  </div>
                )
              }
              return (
                <DischargeSuggestibleInput key={k} label={l} value={summary[k]} onChange={(v) => setField(k, v)} suggestions={getSuggestions(k)} multiline className={dsInp} />
              )
            })}
          </div>
        </div>
      </details>

      <details id={sid('operative')} open className="scroll-mt-3 bg-white rounded-xl border border-slate-200 shadow-sm">
        <summary className="px-3 py-2 cursor-pointer text-xs font-black uppercase tracking-wide text-slate-600 bg-slate-100 hover:bg-slate-200/80">Operative / procedure</summary>
        <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/70 border-t border-slate-200">
          <div>
            <span className={dsLbl}>Surgery date</span>
            <FormattedDateInput
              value={surgeryDraft.surgery_date || ''}
              onChange={(v) => updateSurgeryDraftField('surgery_date', v)}
              className={dsInp}
            />
          </div>
          <DischargeSuggestibleInput label="Procedure (short)" value={surgeryDraft.procedure_name} onChange={(v) => updateSurgeryDraftField('procedure_name', v)} suggestions={getSuggestions('procedure_name', 'child_fields')} multiline className={dsInp} />
          <DischargeSuggestibleInput label="Surgeon" value={surgeryDraft.surgeon_name} onChange={(v) => updateSurgeryDraftField('surgeon_name', v)} suggestions={getSuggestions('surgeon_name', 'child_fields')} className={dsInp} />
          <DischargeSuggestibleInput label="Assistant" value={surgeryDraft.assistant_name} onChange={(v) => updateSurgeryDraftField('assistant_name', v)} suggestions={getSuggestions('assistant_name', 'child_fields')} className={dsInp} />
          <DischargeSuggestibleInput label="Anaesthetist" value={surgeryDraft.anaesthetist_name} onChange={(v) => updateSurgeryDraftField('anaesthetist_name', v)} suggestions={getSuggestions('anaesthetist_name', 'child_fields')} className={dsInp} />
          <DischargeSuggestibleInput label="Anaesthesia" value={surgeryDraft.anaesthesia_type} onChange={(v) => updateSurgeryDraftField('anaesthesia_type', v)} suggestions={getSuggestions('anaesthesia_type', 'child_fields')} className={dsInp} />
          <div className="md:col-span-2"><DischargeSuggestibleInput label="Operative findings" value={surgeryDraft.operative_findings} onChange={(v) => updateSurgeryDraftField('operative_findings', v)} suggestions={getSuggestions('operative_findings')} multiline className={dsInp} /></div>
          <div className="md:col-span-2"><DischargeSuggestibleInput label="Intra-op complications" value={surgeryDraft.intra_op_complications} onChange={(v) => updateSurgeryDraftField('intra_op_complications', v)} suggestions={getSuggestions('intra_op_complications')} multiline className={dsInp} /></div>
          <div className="md:col-span-2 flex items-center gap-2 pt-1">
            <button type="button" onClick={saveSurgeryRow} className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">{editingSurgeryIndex >= 0 ? 'Update Surgery' : 'Save Surgery'}</button>
            {editingSurgeryIndex >= 0 && <button type="button" onClick={resetSurgeryDraft} className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200">Cancel Edit</button>}
          </div>
          <div className="md:col-span-2">
            <span className={dsLbl}>Saved surgeries</span>
            <div className="rounded-lg border border-slate-200 overflow-x-auto bg-white">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 text-left"><th className="p-2">Date</th><th className="p-2">Procedure</th><th className="p-2">Surgeon</th><th className="p-2">Anaesthesia</th><th className="p-2 w-24">Action</th></tr></thead>
                <tbody>
                  {(summary.surgery_rows || []).length === 0
                    ? <tr><td colSpan={5} className="p-3 text-slate-400">No surgery rows saved yet.</td></tr>
                    : (summary.surgery_rows || []).map((row, idx) => (
                      <tr key={idx} className="border-t border-slate-100">
                        <td className="p-2">{row.surgery_date || '—'}</td>
                        <td className="p-2">{row.procedure_name || '—'}</td>
                        <td className="p-2">{row.surgeon_name || '—'}</td>
                        <td className="p-2">{row.anaesthesia_type || '—'}</td>
                        <td className="p-2"><div className="flex items-center gap-2"><button type="button" onClick={() => editSurgeryRow(idx)} className="text-blue-600 font-bold">Edit</button><button type="button" onClick={() => removeSurgeryRow(idx)} className="text-red-600 font-bold">Delete</button></div></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </details>

      <details id={sid('investigations')} open className="scroll-mt-3 bg-white rounded-xl border border-slate-200 shadow-sm">
        <summary className="px-3 py-2 cursor-pointer text-xs font-black uppercase tracking-wide text-slate-600 bg-slate-100 hover:bg-slate-200/80">Investigations (structured)</summary>
        <div className="px-5 py-5 bg-slate-50/70 border-t border-slate-200 space-y-3">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-50 text-left"><th className="px-2.5 py-2">Type</th><th className="px-2.5 py-2">Test</th><th className="px-2.5 py-2">Value</th><th className="px-2.5 py-2">Ref</th><th className="px-2.5 py-2">Date</th><th className="px-2 py-2 w-8" /></tr></thead>
              <tbody>
                {(summary.investigation_rows || []).map((row, idx) => (
                  <tr key={idx} className="border-t border-slate-100">
                    <td className="px-2.5 py-1.5"><select value={row.category || 'lab'} onChange={(e) => updateInvRow(idx, 'category', e.target.value)} className={dsInp}><option value="lab">Lab</option><option value="imaging">Imaging</option></select></td>
                    <td className="px-2.5 py-1.5">
                      <DischargeSuggestibleInput value={row.test_name} onChange={(v) => updateInvRow(idx, 'test_name', v)} suggestions={getSuggestions('test_name', 'child_fields')} placeholder="Test name" className={dsInp} />
                    </td>
                    <td className="px-2.5 py-1.5"><input value={row.value} onChange={(e) => updateInvRow(idx, 'value', e.target.value)} className={dsInp} /></td>
                    <td className="px-2.5 py-1.5"><input value={row.reference_range} onChange={(e) => updateInvRow(idx, 'reference_range', e.target.value)} className={dsInp} /></td>
                    <td className="px-2.5 py-1.5">
                      <FormattedDateInput
                        value={row.test_date || ''}
                        onChange={(v) => updateInvRow(idx, 'test_date', v)}
                        className={dsInp}
                      />
                    </td>
                    <td className="px-2 py-1.5"><button type="button" onClick={() => removeInvRow(idx)} className="text-red-600 font-bold px-1">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addInvRow} className="text-xs font-bold text-emerald-700 hover:underline">+ Add investigation row</button>
          <DischargeSuggestibleInput label="Investigations — free text (extra notes)" value={summary.investigations} onChange={(v) => setField('investigations', v)} suggestions={getSuggestions('investigations')} multiline className={dsInp} />
        </div>
      </details>

      <details id={sid('course')} open className="scroll-mt-3 bg-white rounded-xl border border-slate-200 shadow-sm">
        <summary className="px-3 py-2 cursor-pointer text-xs font-black uppercase tracking-wide text-slate-600 bg-slate-100 hover:bg-slate-200/80">Hospital course &amp; complications</summary>
        <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/70 border-t border-slate-200">
          {DISCHARGE_COURSE_FIELDS.map(([k, l]) => (
            <div key={k} className={k === 'course_in_hospital' ? 'md:col-span-2' : ''}>
              <DischargeSuggestibleInput label={l} value={summary[k]} onChange={(v) => setField(k, v)} suggestions={getSuggestions(k)} multiline className={dsInp} />
            </div>
          ))}
        </div>
      </details>

      <div id={sid('prescriptions')} className="scroll-mt-3 space-y-2">
        <DischargePrescriptionPanel
          items={dischargeRxItems}
          onChange={setDischargeRxItems}
          dosagePatternOptions={dosagePatternOptions}
          timingOptions={timingOptions}
        />
        <details className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <summary className="px-3 py-2 cursor-pointer text-xs font-black uppercase tracking-wide text-slate-600 bg-slate-50 hover:bg-slate-100">Extra medication notes (optional)</summary>
          <div className="px-5 sm:px-6 py-5 bg-slate-50/70 border-t border-slate-200">
            <DischargeSuggestibleInput value={summary.medications_on_discharge} onChange={(v) => setField('medications_on_discharge', v)} suggestions={getSuggestions('medications_on_discharge')} multiline className={`${dsInp} font-mono w-full`} placeholder="Additional instructions not covered above..." />
          </div>
        </details>
      </div>

      <details id={sid('advice')} open className="scroll-mt-3 bg-white rounded-xl border border-slate-200 shadow-sm">
        <summary className="px-3 py-2 cursor-pointer text-xs font-black uppercase tracking-wide text-slate-600 bg-slate-100 hover:bg-slate-200/80">Advice on discharge</summary>
        <div className="px-5 sm:px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/70 border-t border-slate-200">
          {DISCHARGE_ADVICE_FIELDS.map(([k, l]) => (
            <div key={k} className={k === 'warning_signs' ? 'md:col-span-2' : ''}>
              <DischargeSuggestibleInput label={l} value={summary[k]} onChange={(v) => setField(k, v)} suggestions={getSuggestions(k)} multiline className={dsInp} />
            </div>
          ))}
        </div>
      </details>

      {footer}
    </div>
  )
}
