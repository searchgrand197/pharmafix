import React, { useState, useEffect } from 'react';
import TagInput from './TagInput';

const EMPTY_DEFAULT_VALUES = {};

export default function HRForm({
  fields,
  onSubmit,
  onChange,
  submitLabel = "Submit",
  onCancel,
  cancelLabel = "Cancel",
  theme = 'purple',
  defaultValues = EMPTY_DEFAULT_VALUES,
  footer = null,
  loading = false,
  secondaryActionLabel = null,
  onSecondaryAction = null,
  secondaryLoading = false,
}) {
  const [formData, setFormData] = useState(() => defaultValues || {});

  useEffect(() => {
    if (defaultValues && Object.keys(defaultValues).length > 0) {
      setFormData(defaultValues);
    }
  }, [defaultValues]);

  const themeClasses = {
    purple: {
      ring: 'focus:ring-purple-500',
      button: 'bg-purple-600 hover:bg-purple-700',
    },
    lightpink: {
      ring: 'focus:ring-pink-400',
      button: 'bg-pink-500 hover:bg-pink-600',
    },
  };

  const activeTheme = themeClasses[theme] || themeClasses.purple;

  const handleChange = (name, value) => {
    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      onChange?.(next);
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {fields.map((field) => (
          <div key={field.name} className={`flex flex-col ${field.fullWidth ? 'md:col-span-2' : ''}`}>
            <label className="text-sm font-medium text-gray-700 mb-1">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
            {field.type === 'select' ? (
              <select
                required={field.required}
                value={formData[field.name] || ''}
                onChange={(e) => handleChange(field.name, e.target.value)}
                className={`border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 bg-white ${activeTheme.ring}`}
              >
                <option value="" disabled>Select {field.label}</option>
                {field.options?.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <textarea
                required={field.required}
                placeholder={field.placeholder}
                value={formData[field.name] || ''}
                onChange={(e) => handleChange(field.name, e.target.value)}
                className={`border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 ${activeTheme.ring}`}
                rows={field.rows || 3}
              />
            ) : field.type === 'tags' ? (
              <>
                <TagInput
                  value={formData[field.name] || ''}
                  onChange={(val) => handleChange(field.name, val)}
                  placeholder={field.placeholder}
                  required={field.required}
                  splitSpacesOnLoad={field.splitSpacesOnLoad}
                  ringClass={activeTheme.ring.replace('focus:ring-', 'focus-within:ring-')}
                  chipClass={theme === 'lightpink'
                    ? 'bg-pink-50 border-pink-200 text-pink-900'
                    : 'bg-purple-50 border-purple-200 text-purple-900'}
                />
                {field.hint && (
                  <p className="mt-1 text-xs text-gray-500">{field.hint}</p>
                )}
              </>
            ) : (
              <>
                <input
                  type={field.type || 'text'}
                  required={field.required}
                  placeholder={field.placeholder}
                  min={field.type === 'date' ? field.min : undefined}
                  max={field.type === 'date' ? field.max : undefined}
                  value={formData[field.name] || ''}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  className={`border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 ${activeTheme.ring}`}
                />
                {field.hint && (
                  <p className="mt-1 text-xs text-gray-500">{field.hint}</p>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {footer}

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-50">
        {onCancel && (
          <button
            type="button"
            onClick={() => onCancel(formData)}
            disabled={loading || secondaryLoading}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        )}
        {secondaryActionLabel && onSecondaryAction && (
          <button
            type="button"
            onClick={() => onSecondaryAction(formData)}
            disabled={loading || secondaryLoading}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-purple-700 border border-purple-200 bg-white hover:bg-purple-50 transition-colors disabled:opacity-50"
          >
            {secondaryLoading ? 'Saving…' : secondaryActionLabel}
          </button>
        )}
        <button
          type="submit"
          disabled={loading || secondaryLoading}
          className={`px-6 py-2 rounded-xl text-sm font-semibold text-white shadow-md transition-colors disabled:opacity-50 ${activeTheme.button}`}
        >
          {loading ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
