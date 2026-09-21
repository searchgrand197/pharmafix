const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const NAME_RE = /[a-zA-Z\u00C0-\u024F\u0900-\u097F]/;
const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;
const EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship']);
export const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
];
const GENDER_VALUES = new Set(GENDER_OPTIONS.map((option) => option.value));

export const EMPLOYEE_FIELD_LIMITS = {
  name: 200,
  email: 254,
  phone: 20,
  job_title: 200,
  manager_name: 200,
  address: 500,
  emergency_contact: 200,
};

export function cleanPhoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

export function normalizeIndianMobile(raw) {
  const digits = cleanPhoneDigits(raw);
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function validateName(name) {
  if (!name) return 'Name is required';
  if (name.length < 2) return 'Name must be at least 2 characters';
  if (name.length > EMPLOYEE_FIELD_LIMITS.name) return `Name must be at most ${EMPLOYEE_FIELD_LIMITS.name} characters`;
  if (!NAME_RE.test(name)) return 'Name must include at least one letter';
  return null;
}

function validateEmail(email) {
  if (!email) return 'Email is required';
  if (email.length > EMPLOYEE_FIELD_LIMITS.email) return 'Email is too long';
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address';
  return null;
}

function validatePhone(phone) {
  const digits = cleanPhoneDigits(phone);
  if (!digits) return 'Mobile number is required';
  const mobile = normalizeIndianMobile(phone);
  if (mobile.length !== 10) {
    return 'Enter a valid 10-digit mobile number';
  }
  if (!INDIAN_MOBILE_RE.test(mobile)) {
    return 'Mobile number must start with 6, 7, 8, or 9';
  }
  if (String(phone).trim().length > EMPLOYEE_FIELD_LIMITS.phone) {
    return `Mobile number must be at most ${EMPLOYEE_FIELD_LIMITS.phone} characters`;
  }
  return null;
}

function validateDepartment(departmentId, departments = []) {
  if (!departmentId) return 'Department is required';
  if (departments.length && !departments.some((d) => String(d.id) === String(departmentId))) {
    return 'Select a valid department from the list';
  }
  return null;
}

function validateJobTitle(jobTitle) {
  if (!jobTitle) return 'Job title is required';
  if (jobTitle.length < 2) return 'Job title must be at least 2 characters';
  if (jobTitle.length > EMPLOYEE_FIELD_LIMITS.job_title) {
    return `Job title must be at most ${EMPLOYEE_FIELD_LIMITS.job_title} characters`;
  }
  return null;
}

function validateDesignationOrJobTitle(form) {
  if (form.designation) return null;
  return validateJobTitle((form.job_title || '').trim());
}

function validateJoiningDate(joiningDate) {
  if (!joiningDate) return 'Joining date is required';
  const parsed = new Date(`${joiningDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return 'Enter a valid joining date';
  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - 50);
  if (parsed < minDate) return 'Joining date is too far in the past';
  return null;
}

function validateAmount(value, { required = false, label = 'Amount' } = {}) {
  if (value === '' || value == null) {
    return required ? `${label} is required` : null;
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return `${label} must be a valid number`;
  if (num < 0) return `${label} cannot be negative`;
  if (num > 99_999_999.99) return `${label} is too large`;
  if (required && num <= 0) return `${label} must be greater than 0`;
  return null;
}

function validateCustomSalaryField(field, form) {
  const custom = form.custom_salary || {};
  const labels = {
    basic: 'Basic salary',
    hra: 'HRA',
    medical: 'Medical allowance',
    special_allowance: 'Special allowance',
  };
  return validateAmount(custom[field], {
    required: field === 'basic',
    label: labels[field] || field,
  });
}

function validateEmploymentType(employmentType) {
  if (!employmentType) return null;
  if (!EMPLOYMENT_TYPES.has(employmentType)) return 'Select a valid employment type';
  return null;
}

function validateGender(gender) {
  if (!gender) return 'Gender is required';
  if (!GENDER_VALUES.has(gender)) return 'Select a valid gender';
  return null;
}

function validateOptionalText(value, field, label, maxLen) {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return `${label} must be at most ${maxLen} characters`;
  return null;
}

export function validateManualEmployeeField(field, form, options = {}) {
  const trimmed = {
    name: (form.name || '').trim(),
    email: (form.email || '').trim().toLowerCase(),
    phone: (form.phone || '').trim(),
    department: form.department || '',
    designation: form.designation || '',
    job_title: (form.job_title || '').trim(),
    joining_date: form.joining_date || '',
    employment_type: form.employment_type || '',
    gender: form.gender || '',
    manager_name: (form.manager_name || '').trim(),
    address: (form.address || '').trim(),
    emergency_contact: (form.emergency_contact || '').trim(),
  };

  switch (field) {
    case 'name': return validateName(trimmed.name);
    case 'email': return validateEmail(trimmed.email);
    case 'phone': return validatePhone(trimmed.phone);
    case 'gender': return validateGender(trimmed.gender);
    case 'department': return validateDepartment(trimmed.department, options.departments);
    case 'designation':
      if (trimmed.designation && options.designations?.length
        && !options.designations.some((d) => String(d.id) === String(trimmed.designation))) {
        return 'Select a valid designation from the list';
      }
      return validateDesignationOrJobTitle(trimmed);
    case 'job_title':
      if (trimmed.designation) return null;
      return validateJobTitle(trimmed.job_title);
    case 'joining_date': return validateJoiningDate(trimmed.joining_date);
    case 'employment_type': return validateEmploymentType(trimmed.employment_type);
    case 'custom_basic':
      if (form.pay_mode !== 'custom') return null;
      return validateCustomSalaryField('basic', form);
    case 'custom_hra':
      if (form.pay_mode !== 'custom') return null;
      return validateCustomSalaryField('hra', form);
    case 'custom_medical':
      if (form.pay_mode !== 'custom') return null;
      return validateCustomSalaryField('medical', form);
    case 'custom_special_allowance':
      if (form.pay_mode !== 'custom') return null;
      return validateCustomSalaryField('special_allowance', form);
    case 'manager_name':
      return validateOptionalText(trimmed.manager_name, field, 'Manager name', EMPLOYEE_FIELD_LIMITS.manager_name);
    case 'address':
      return validateOptionalText(trimmed.address, field, 'Address', EMPLOYEE_FIELD_LIMITS.address);
    case 'emergency_contact':
      return validateOptionalText(trimmed.emergency_contact, field, 'Emergency contact', EMPLOYEE_FIELD_LIMITS.emergency_contact);
    default:
      return null;
  }
}

export function validateManualEmployeeForm(form, options = {}) {
  const fields = [
    'name',
    'email',
    'phone',
    'gender',
    'department',
    'designation',
    'job_title',
    'joining_date',
    'employment_type',
    'manager_name',
    'address',
    'emergency_contact',
  ];
  if (form.pay_mode === 'custom') {
    fields.push('custom_basic', 'custom_hra', 'custom_medical', 'custom_special_allowance');
  }
  const errors = {};
  fields.forEach((field) => {
    const message = validateManualEmployeeField(field, form, options);
    if (message) errors[field] = message;
  });
  return errors;
}

export function buildManualEmployeePayload(form, { hospitalId, departments = [], designations = [] } = {}) {
  const dept = departments.find((d) => String(d.id) === String(form.department));
  const designation = designations.find((d) => String(d.id) === String(form.designation));
  const payMode = form.pay_mode === 'custom' ? 'custom' : 'level';
  const payload = {
    name: (form.name || '').trim(),
    email: (form.email || '').trim().toLowerCase(),
    phone: normalizeIndianMobile(form.phone),
    gender: form.gender || '',
    department_id: form.department || '',
    department: dept?.name || '',
    designation: form.designation || '',
    job_title: designation?.name || (form.job_title || '').trim(),
    joining_date: form.joining_date,
    employment_type: form.employment_type,
    manager_name: (form.manager_name || '').trim(),
    address: (form.address || '').trim(),
    emergency_contact: (form.emergency_contact || '').trim(),
    start_onboarding: false,
    document_timing: 'skip',
    offline_physical_verify_all: true,
    pay_mode: payMode,
  };
  if (payMode === 'custom') {
    const custom = form.custom_salary || {};
    payload.custom_salary = {
      basic: custom.basic !== '' && custom.basic != null ? String(custom.basic) : '',
      hra: custom.hra !== '' && custom.hra != null ? String(custom.hra) : '0',
      medical: custom.medical !== '' && custom.medical != null ? String(custom.medical) : '0',
      special_allowance:
        custom.special_allowance !== '' && custom.special_allowance != null
          ? String(custom.special_allowance)
          : '0',
    };
  } else if (form.compensation_level) {
    payload.compensation_level = form.compensation_level;
  }
  if (hospitalId) payload.hospital_id = hospitalId;
  return payload;
}
