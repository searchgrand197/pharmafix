import {
  normalizeIndianMobile,
} from './employeeFormValidation';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const NAME_RE = /[a-zA-Z\u00C0-\u024F\u0900-\u097F]/;
const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;
const CIN_RE = /^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

export const ORGANIZATION_FIELD_LIMITS = {
  organization_name: 255,
  organization_address: 2000,
  organization_location: 255,
  organization_website: 255,
  company_email: 255,
  company_phone: 64,
  hr_name: 255,
  hr_designation: 255,
  hr_email: 255,
  hr_phone: 64,
  registered_office_address: 2000,
  corporate_office_address: 2000,
  company_registration_number: 128,
  footer_confidentiality_note: 2000,
};

export const ORGANIZATION_VALIDATED_FIELDS = [
  'organization_name',
  'organization_address',
  'organization_location',
  'organization_website',
  'company_email',
  'company_phone',
  'hr_name',
  'hr_designation',
  'hr_email',
  'hr_phone',
  'registered_office_address',
  'corporate_office_address',
  'company_registration_number',
  'footer_confidentiality_note',
];

export const ORGANIZATION_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ORGANIZATION_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

function trim(value) {
  return String(value ?? '').trim();
}

function validateRequiredName(value, label, maxLen) {
  if (!value) return `${label} is required`;
  if (value.length < 2) return `${label} must be at least 2 characters`;
  if (value.length > maxLen) return `${label} must be at most ${maxLen} characters`;
  if (!NAME_RE.test(value)) return `${label} must include at least one letter`;
  return null;
}

function validateOptionalEmail(value, label, maxLen) {
  if (!value) return null;
  if (value.length > maxLen) return `${label} is too long`;
  if (!EMAIL_RE.test(value)) return `Enter a valid ${label.toLowerCase()}`;
  return null;
}

function validateOptionalPhone(value, label) {
  const raw = trim(value);
  if (!raw) return null;

  const mobile = normalizeIndianMobile(raw);
  if (mobile.length !== 10) {
    return `${label} must be exactly 10 digits`;
  }
  if (!INDIAN_MOBILE_RE.test(mobile)) {
    return `${label} must start with 6, 7, 8, or 9`;
  }
  return null;
}

function validateOptionalWebsite(value) {
  if (!value) return null;
  if (value.length > ORGANIZATION_FIELD_LIMITS.organization_website) {
    return 'Website must be at most 255 characters';
  }

  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return 'Enter a valid website URL (e.g. https://yourhospital.com)';
    }
  } catch {
    return 'Enter a valid website URL (e.g. https://yourhospital.com)';
  }
  return null;
}

function validateOptionalText(value, label, maxLen, minLen = 0) {
  if (!value) return null;
  if (minLen && value.length < minLen) {
    return `${label} must be at least ${minLen} characters`;
  }
  if (value.length > maxLen) return `${label} must be at most ${maxLen} characters`;
  return null;
}

function validateOptionalCin(value) {
  if (!value) return null;
  if (value.length > ORGANIZATION_FIELD_LIMITS.company_registration_number) {
    return 'Registration number must be at most 128 characters';
  }
  const upper = value.toUpperCase();
  if (CIN_RE.test(upper)) return null;
  if (/^[A-Z0-9/-]{5,128}$/i.test(value)) return null;
  return 'Enter a valid registration number (e.g. U74999MH2020PTC123456)';
}

function hasCompanyContact(form) {
  return Boolean(trim(form.company_email) || trim(form.company_phone));
}

export function validateOrganizationImageFile(file) {
  if (!file) return null;
  if (!ORGANIZATION_IMAGE_TYPES.has(file.type)) {
    return 'Upload a JPG, PNG, GIF, or WebP image';
  }
  if (file.size > ORGANIZATION_IMAGE_MAX_BYTES) {
    return 'Image must be 5 MB or smaller';
  }
  return null;
}

export function validateOrganizationField(field, form) {
  const values = {
    organization_name: trim(form.organization_name),
    organization_address: trim(form.organization_address),
    organization_location: trim(form.organization_location),
    organization_website: trim(form.organization_website),
    company_email: trim(form.company_email).toLowerCase(),
    company_phone: trim(form.company_phone),
    hr_name: trim(form.hr_name),
    hr_designation: trim(form.hr_designation) || 'HR Manager',
    hr_email: trim(form.hr_email).toLowerCase(),
    hr_phone: trim(form.hr_phone),
    registered_office_address: trim(form.registered_office_address),
    corporate_office_address: trim(form.corporate_office_address),
    company_registration_number: trim(form.company_registration_number).toUpperCase(),
    footer_confidentiality_note: trim(form.footer_confidentiality_note),
  };

  switch (field) {
    case 'organization_name':
      return validateRequiredName(
        values.organization_name,
        'Hospital / company name',
        ORGANIZATION_FIELD_LIMITS.organization_name,
      );
    case 'organization_address':
      if (!values.organization_address) return 'Full address is required';
      if (values.organization_address.length < 5) {
        return 'Full address must be at least 5 characters';
      }
      return validateOptionalText(
        values.organization_address,
        'Full address',
        ORGANIZATION_FIELD_LIMITS.organization_address,
      );
    case 'organization_location':
      return validateOptionalText(
        values.organization_location,
        'City & pincode',
        ORGANIZATION_FIELD_LIMITS.organization_location,
        2,
      );
    case 'organization_website':
      return validateOptionalWebsite(values.organization_website);
    case 'company_email': {
      const emailError = validateOptionalEmail(
        values.company_email,
        'Company email',
        ORGANIZATION_FIELD_LIMITS.company_email,
      );
      if (emailError) return emailError;
      if (!values.company_email && !values.company_phone) {
        return 'Company email or main phone is required';
      }
      return null;
    }
    case 'company_phone': {
      const phoneError = validateOptionalPhone(values.company_phone, 'Main phone');
      if (phoneError) return phoneError;
      if (!values.company_email && !values.company_phone) {
        return 'Company email or main phone is required';
      }
      return null;
    }
    case 'hr_name':
      return validateRequiredName(values.hr_name, 'HR signatory name', ORGANIZATION_FIELD_LIMITS.hr_name);
    case 'hr_designation':
      if (!values.hr_designation) return 'HR designation is required';
      return validateOptionalText(
        values.hr_designation,
        'HR designation',
        ORGANIZATION_FIELD_LIMITS.hr_designation,
        2,
      );
    case 'hr_email':
      return validateOptionalEmail(values.hr_email, 'HR email', ORGANIZATION_FIELD_LIMITS.hr_email);
    case 'hr_phone':
      return validateOptionalPhone(values.hr_phone, 'HR phone');
    case 'registered_office_address':
      return validateOptionalText(
        values.registered_office_address,
        'Registered office address',
        ORGANIZATION_FIELD_LIMITS.registered_office_address,
      );
    case 'corporate_office_address':
      return validateOptionalText(
        values.corporate_office_address,
        'Corporate office address',
        ORGANIZATION_FIELD_LIMITS.corporate_office_address,
      );
    case 'company_registration_number':
      return validateOptionalCin(values.company_registration_number);
    case 'footer_confidentiality_note':
      return validateOptionalText(
        values.footer_confidentiality_note,
        'Confidentiality note',
        ORGANIZATION_FIELD_LIMITS.footer_confidentiality_note,
        10,
      );
    default:
      return null;
  }
}

export function validateOrganizationForm(form, { logoFile, signatureFile } = {}) {
  const errors = {};
  ORGANIZATION_VALIDATED_FIELDS.forEach((field) => {
    const message = validateOrganizationField(field, form);
    if (message) errors[field] = message;
  });

  if (!hasCompanyContact(form)) {
    const contactMessage = 'Company email or main phone is required';
    errors.company_email = errors.company_email || contactMessage;
    errors.company_phone = errors.company_phone || contactMessage;
  }

  const logoError = validateOrganizationImageFile(logoFile);
  if (logoError) errors.logo = logoError;

  const signatureError = validateOrganizationImageFile(signatureFile);
  if (signatureError) errors.signature = signatureError;

  return errors;
}

export function normalizeOrganizationForm(form) {
  return {
    organization_name: trim(form.organization_name),
    organization_address: trim(form.organization_address),
    organization_location: trim(form.organization_location),
    organization_contact: trim(form.organization_contact),
    organization_website: trim(form.organization_website),
    registered_office_address: trim(form.registered_office_address),
    corporate_office_address: trim(form.corporate_office_address),
    company_registration_number: trim(form.company_registration_number).toUpperCase(),
    footer_confidentiality_note: trim(form.footer_confidentiality_note),
    company_email: trim(form.company_email).toLowerCase(),
    company_phone: normalizeIndianMobile(form.company_phone),
    hr_name: trim(form.hr_name),
    hr_designation: trim(form.hr_designation) || 'HR Manager',
    hr_email: trim(form.hr_email).toLowerCase(),
    hr_phone: normalizeIndianMobile(form.hr_phone),
  };
}
