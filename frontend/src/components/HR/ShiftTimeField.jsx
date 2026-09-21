import React, { useEffect, useState } from 'react';
import {
  parts12ToTime24,
  parts24ToTime24,
  time24ToParts12,
  time24ToParts24,
} from '../../utils/timeDisplay';

const selectClass = 'rounded-xl border border-slate-200 px-2 py-2 text-sm bg-white';

const HOURS_12 = Array.from({ length: 12 }, (_, i) => String(i + 1));
const HOURS_24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export default function ShiftTimeField({
  label,
  value,
  onChange,
  format = '12h',
  required = false,
}) {
  const [parts12, setParts12] = useState({ hour12: '', minute: '', period: '' });
  const [parts24, setParts24] = useState({ hour: '', minute: '' });

  useEffect(() => {
    if (format === '12h') {
      setParts12(time24ToParts12(value));
    } else {
      setParts24(time24ToParts24(value));
    }
  }, [value, format]);

  function handle12Change(patch) {
    const next = { ...parts12, ...patch };
    setParts12(next);
    const time24 = parts12ToTime24(next.hour12, next.minute, next.period);
    onChange(time24);
  }

  function handle24Change(patch) {
    const next = { ...parts24, ...patch };
    setParts24(next);
    const time24 = parts24ToTime24(next.hour, next.minute);
    onChange(time24);
  }

  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {format === '12h' ? (
        <div className="mt-1 grid grid-cols-[1fr_auto_1fr_auto] items-center gap-1.5">
          <select
            required={required}
            className={selectClass}
            value={parts12.hour12}
            onChange={(e) => handle12Change({ hour12: e.target.value })}
          >
            <option value="">h</option>
            {HOURS_12.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <span className="text-slate-400">:</span>
          <select
            required={required}
            className={selectClass}
            value={parts12.minute}
            onChange={(e) => handle12Change({ minute: e.target.value })}
          >
            <option value="">m</option>
            {MINUTES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <select
            required={required}
            className={selectClass}
            value={parts12.period}
            onChange={(e) => handle12Change({ period: e.target.value })}
          >
            <option value="">AM/PM</option>
            <option value="AM">AM</option>
            <option value="PM">PM</option>
          </select>
        </div>
      ) : (
        <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
          <select
            required={required}
            className={selectClass}
            value={parts24.hour}
            onChange={(e) => handle24Change({ hour: e.target.value })}
          >
            <option value="">h</option>
            {HOURS_24.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <span className="text-slate-400">:</span>
          <select
            required={required}
            className={selectClass}
            value={parts24.minute}
            onChange={(e) => handle24Change({ minute: e.target.value })}
          >
            <option value="">m</option>
            {MINUTES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      )}
    </label>
  );
}
