/**
 * Resolve offer letter {{variables}} to real values from form + organization settings.
 * Letters should never show raw {{placeholders}} to HR or candidates.
 */

const VAR_RE = /\{\{\s*(\w+)\s*\}\}/g;

export function formatJoiningDate(value) {
  if (!value) {
    return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  }
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

export const formatOfferExpiryDate = formatJoiningDate;

/** Default last date to accept: today + 7 days as YYYY-MM-DD. */
export function defaultOfferExpiryDate(daysAhead = 7) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
}

/** Today's date as YYYY-MM-DD (for date input min). */
export function todayISODate() {
  return new Date().toISOString().split('T')[0];
}

/** Normalize API / display values to `YYYY-MM-DD` for `<input type="date">`. */
export function toDateInputValue(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

export function isJoiningDateRowLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  return normalized === 'date of joining' || normalized === 'joining date';
}

export function isOfferExpiryDateRowLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  return (
    normalized === 'last date to accept offer'
    || normalized === 'last date to accept'
    || normalized === 'offer validity'
  );
}

/** Update "Date of Joining" cells in Position Details tables when the picker changes. */
export function syncJoiningDateInBlocks(blocks, formattedDate) {
  return syncPositionDetailsInBlocks(blocks, { joining_date: formattedDate });
}

/** Update "Last date to accept" cells in Position Details tables when the picker changes. */
export function syncOfferExpiryDateInBlocks(blocks, formattedDate) {
  return syncPositionDetailsInBlocks(blocks, { offer_expiry_date: formattedDate });
}

function matchPositionRowLabel(label, rowKey) {
  const normalized = String(label || '').trim().toLowerCase();
  if (rowKey === 'designation') return normalized === 'designation';
  if (rowKey === 'department') return normalized === 'department';
  if (rowKey === 'location') return normalized === 'location';
  if (rowKey === 'joining_date') return isJoiningDateRowLabel(label);
  if (rowKey === 'offer_expiry_date') return isOfferExpiryDateRowLabel(label);
  if (rowKey === 'reporting_manager') return normalized === 'reporting manager';
  return false;
}

/** Keep Position Details table rows aligned with sidebar / candidate fields. */
export function syncPositionDetailsInBlocks(blocks, ctx = {}) {
  if (!Array.isArray(blocks)) return blocks;

  const dash = '—';
  const values = {
    designation: (ctx.designation || ctx.job_title || '').trim() || dash,
    department: (ctx.department || '').trim() || dash,
    location: (ctx.job_location || '').trim() || dash,
    joining_date: (ctx.joining_date || '').trim() || dash,
    offer_expiry_date: (ctx.offer_expiry_date || '').trim() || dash,
    reporting_manager: (ctx.reporting_manager || '').trim() || dash,
  };

  return blocks.map((block) => {
    if (block.type !== 'table' || !block.rows) return block;
    const rows = block.rows.map((row) => {
      const label = (row.cols || [])[0];
      for (const [key, value] of Object.entries(values)) {
        if (matchPositionRowLabel(label, key) && value !== dash) {
          return { ...row, cols: [row.cols[0], value] };
        }
      }
      return row;
    });
    return { ...block, rows };
  });
}

/** Build substitution map from builder form + organization settings. */
export function buildSubstitutionContext(formData = {}, settings = {}) {
  const companyName = (settings.organization_name || formData.company_name || '').trim();
  const companyEmail = (formData.company_email || settings.company_email || '').trim();
  const companyPhone = (formData.company_phone || settings.company_phone || '').trim();
  let companyContact = (formData.company_contact || settings.organization_contact || '').trim();
  if (!companyContact && (companyEmail || companyPhone)) {
    companyContact = [companyEmail, companyPhone].filter(Boolean).join(' | ');
  }

  return {
    company_name: companyName,
    organization_name: companyName,
    company_address: (formData.company_address || settings.organization_address || '').trim(),
    company_location: (formData.company_location || settings.organization_location || '').trim(),
    company_contact: companyContact,
    company_website: (formData.company_website || settings.organization_website || '').trim(),
    company_email: companyEmail,
    company_phone: companyPhone,
    hr_name: (formData.hr_name || settings.hr_name || '').trim(),
    hr_designation: (formData.hr_designation || settings.hr_designation || 'HR Manager').trim(),
    hr_email: (formData.hr_email || settings.hr_email || '').trim(),
    hr_phone: (formData.hr_phone || settings.hr_phone || '').trim(),
    candidate_name: (formData.candidate_name || '').trim(),
    candidate_email: (formData.candidate_email || '').trim(),
    candidate_phone: (formData.candidate_phone || '').trim(),
    candidate_address: (formData.candidate_address || '').trim(),
    job_title: (formData.job_title || '').trim(),
    designation: (formData.job_title || '').trim(),
    department: (formData.department || '').trim(),
    job_location: (formData.job_location || '').trim(),
    reporting_manager: (formData.reporting_manager || '').trim(),
    joining_date: formatJoiningDate(formData.joining_date),
    offer_expiry_date: formatOfferExpiryDate(formData.offer_expiry_date || defaultOfferExpiryDate()),
    work_mode: (formData.work_mode || '').trim(),
    ctc: (formData.ctc || '').trim(),
    basic_salary: (formData.basic_salary || '').trim(),
    hra: (formData.hra || '').trim(),
    special_allowance: (formData.special_allowance || '').trim(),
    bonus: (formData.bonus || '').trim(),
    probation_period: (formData.probation_period || '').trim(),
    notice_period: (formData.notice_period || '').trim(),
    working_hours: (formData.working_hours || '').trim(),
    weekly_off: (formData.weekly_off || '').trim(),
    shift: (formData.shift || '').trim(),
  };
}

/** Replace {{key}} with values; strip any remaining unknown placeholders. */
export function substituteInText(text, ctx) {
  if (!text || typeof text !== 'string') return text || '';

  let result = text;
  Object.entries(ctx).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    const re = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    result = result.replace(re, String(value));
  });
  return result.replace(VAR_RE, '').trim();
}

export function contentHasVariables(text) {
  return typeof text === 'string' && /\{\{\s*\w+\s*\}\}/.test(text);
}

export function blocksHaveVariables(blocks) {
  if (!Array.isArray(blocks)) return false;
  return blocks.some((block) => {
    if (!block || typeof block !== 'object') return false;
    if (contentHasVariables(block.content) || contentHasVariables(block.title)) return true;
    if (block.type === 'table') {
      return (block.rows || []).some((row) => (row.cols || []).some((c) => contentHasVariables(String(c))));
    }
    if (block.type === 'terms') {
      return (block.items || []).some(
        (item) => contentHasVariables(item.label) || contentHasVariables(item.text),
      );
    }
    return false;
  });
}

/** Substitute all blocks in dynamic_content. */
export function substituteDynamicContent(blocks, ctx) {
  if (!Array.isArray(blocks)) return [];

  return blocks.map((block) => {
    const b = { ...block };
    if (b.type === 'paragraph' || b.type === 'heading') {
      b.content = substituteInText(b.content, ctx);
    } else if (b.type === 'table') {
      if (b.title) b.title = substituteInText(b.title, ctx);
      b.rows = (b.rows || []).map((row) => ({
        ...row,
        cols: (row.cols || []).map((col) => substituteInText(String(col ?? ''), ctx)),
      }));
    } else if (b.type === 'terms') {
      if (b.title) b.title = substituteInText(b.title, ctx);
      b.items = (b.items || []).map((item) => ({
        ...item,
        label: substituteInText(item.label || '', ctx),
        text: substituteInText(item.text || '', ctx),
      }));
    }
    return b;
  });
}

/** Enterprise Terms & Conditions block with resolved values (no {{variables}}). */
export function buildDefaultTermsBlock(ctx, settings = {}) {
  const probation = ctx.probation_period || '6 Months';
  const notice = ctx.notice_period || '30 Days';
  const hours = ctx.working_hours || 'as per company policy';
  const weeklyOff = ctx.weekly_off || 'as per company policy';
  const expiry = ctx.offer_expiry_date || 'the date specified in this letter';

  let items;
  const fromSettings = settings?.default_terms_conditions;
  if (Array.isArray(fromSettings) && fromSettings.length > 0) {
    items = fromSettings.map((item) => ({
      label: substituteInText(item.label || '', ctx),
      text: substituteInText(item.text || '', ctx),
    }));
  } else {
    items = [
      {
        label: 'Probation Period',
        text: `You will be on probation for ${probation} from your date of joining. During this period, either party may terminate employment with shorter notice as per company policy.`,
      },
      {
        label: 'Confidentiality',
        text: 'You shall maintain strict confidentiality of all proprietary, patient, and business information and shall not disclose any such information during or after your employment.',
      },
      {
        label: 'Code of Conduct',
        text: "You are required to adhere to the organization's code of conduct, ethics policy, and all applicable workplace policies at all times.",
      },
      {
        label: 'Employment Conditions',
        text: `Your employment is subject to satisfactory verification of credentials, medical fitness, and compliance with statutory requirements. Working hours: ${hours}; weekly off: ${weeklyOff}.`,
      },
      {
        label: 'Termination',
        text: `After confirmation, either party may terminate employment by giving ${notice} written notice or salary in lieu thereof, subject to applicable law and company policy.`,
      },
      {
        label: 'Joining Conditions',
        text: `Please accept this offer on or before ${expiry} by using the link in your email. This offer is contingent upon your joining on or before the agreed date, submission of required documents, and acceptance of this letter in writing. Failure to join on the agreed date may result in withdrawal of this offer.`,
      },
    ];
  }

  return {
    id: 'terms-default',
    type: 'terms',
    title: 'Terms & Conditions',
    marginTop: 12,
    marginBottom: 20,
    items,
  };
}

export function ensureTermsBlock(blocks, ctx, settings = {}) {
  const list = [...(blocks || [])];
  if (!list.some((b) => b && b.type === 'terms')) {
    list.push(buildDefaultTermsBlock(ctx, settings));
  }
  return list;
}

/** Default letter body using resolved values (no {{variables}}). */
export function buildResolvedDynamicContent(ctx, settings = {}) {
  const org = ctx.company_name || 'our organization';
  const role = ctx.job_title || 'the offered position';
  const dash = '—';

  return [
    {
      id: 'p1',
      type: 'paragraph',
      content: `Further to our discussions, we are pleased to offer you employment with ${org} in the position of ${role}. We believe your skills and experience will be a valuable addition to our organization.`,
      fontSize: 14,
      marginTop: 0,
      marginBottom: 20,
    },
    {
      id: 't1',
      type: 'table',
      title: 'Position Details',
      titleFontSize: 13,
      cellFontSize: 14,
      marginTop: 4,
      marginBottom: 22,
      rows: [
        { id: 'r1', cols: ['Designation', ctx.job_title || dash] },
        { id: 'r2', cols: ['Department', ctx.department || dash] },
        { id: 'r3', cols: ['Location', ctx.job_location || dash] },
        { id: 'r4', cols: ['Date of Joining', ctx.joining_date || dash] },
        { id: 'r5', cols: ['Last date to accept offer', ctx.offer_expiry_date || dash] },
        { id: 'r6', cols: ['Reporting Manager', ctx.reporting_manager || dash] },
      ],
    },
    {
      id: 'h2',
      type: 'heading',
      content: 'Compensation & Benefits',
      fontSize: 18,
      marginTop: 8,
      marginBottom: 16,
    },
    {
      id: 't2',
      type: 'table',
      title: 'Salary Structure (Annual)',
      titleFontSize: 13,
      cellFontSize: 14,
      marginTop: 0,
      marginBottom: 22,
      rows: [
        { id: 'rs1', cols: ['Basic Salary', ctx.basic_salary || dash] },
        { id: 'rs2', cols: ['HRA', ctx.hra || dash] },
        { id: 'rs3', cols: ['Special Allowance', ctx.special_allowance || dash] },
        { id: 'rs4', cols: ['Total CTC', ctx.ctc || dash] },
      ],
    },
    {
      id: 'p2',
      type: 'paragraph',
      content: `You will be entitled to benefits and leave as per company policy. Working hours: ${ctx.working_hours || dash}; weekly off: ${ctx.weekly_off || dash}.`,
      fontSize: 14,
      marginTop: 0,
      marginBottom: 12,
    },
    buildDefaultTermsBlock(ctx, settings),
  ];
}

/**
 * Merge settings into form, then resolve all letter text to real values.
 */
export function hydrateOfferLetterContent(formData, settings, { forceRebuild = false } = {}) {
  const merged = { ...formData };
  const orgName = (settings?.organization_name || '').trim();
  if (orgName) {
    merged.company_name = orgName;
  }
  const ctx = buildSubstitutionContext(merged, settings);

  const blocks = merged.dynamic_content;
  const needsWork = forceRebuild || !blocks?.length || blocksHaveVariables(blocks);

  if (needsWork) {
    if (blocks?.length && blocksHaveVariables(blocks)) {
      merged.dynamic_content = substituteDynamicContent(blocks, ctx);
    } else if (!blocks?.length || forceRebuild) {
      merged.dynamic_content = buildResolvedDynamicContent(ctx, settings);
    }
  }

  merged.dynamic_content = ensureTermsBlock(merged.dynamic_content || [], ctx, settings);
  merged.dynamic_content = syncPositionDetailsInBlocks(merged.dynamic_content, ctx);

  return merged;
}
