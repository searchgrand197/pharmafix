function normalizeErrorValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return String(value[0] || '');
  if (typeof value === 'object' && value.message) return String(value.message);
  return String(value);
}

/**
 * Extract a human-readable message from API error response bodies.
 * Handles BiometricLinkError (message/field_errors), DRF handler (errors), and legacy shapes.
 */
export function parseApiErrorMessage(data, fallback = 'Something went wrong') {
  if (!data) return fallback;
  if (typeof data === 'string') return data;
  if (data.message) return String(data.message);

  const fieldErrors = parseApiFieldErrors(data);
  const firstFieldError = Object.values(fieldErrors)[0];
  if (firstFieldError) return firstFieldError;

  if (data.error) return String(data.error);
  if (data.detail) return String(data.detail);
  return fallback;
}

/**
 * Normalize API validation errors into { fieldName: message }.
 */
export function parseApiFieldErrors(data) {
  if (!data || typeof data !== 'object') return {};

  const normalized = {};

  if (data.field_errors && typeof data.field_errors === 'object') {
    Object.entries(data.field_errors).forEach(([key, value]) => {
      const message = normalizeErrorValue(value);
      if (message) normalized[key] = message;
    });
  }

  if (data.errors && typeof data.errors === 'object') {
    Object.entries(data.errors).forEach(([key, value]) => {
      if (key === 'detail' || key === 'non_field_errors') return;
      const message = normalizeErrorValue(value);
      if (message) normalized[key] = message;
    });
  }

  return normalized;
}

export function parseApiError(error, fallback = 'Something went wrong') {
  const data = error?.response?.data;
  return {
    message: parseApiErrorMessage(data, fallback),
    fieldErrors: parseApiFieldErrors(data),
  };
}
