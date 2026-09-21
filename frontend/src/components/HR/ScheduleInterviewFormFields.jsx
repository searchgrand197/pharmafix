import React from 'react';
import { currentISTClockLabel, todayISODate } from '../../utils/interviewDateTime';
import { applyOfflineInterviewDefaults } from './scheduleInterviewFormUtils';

/**
 * Shared interview scheduling fields (single + bulk). All date/time fields use IST.
 */
export default function ScheduleInterviewFormFields({ form, onChange, offlineDefaults }) {
  const set = (patch) => onChange({ ...form, ...patch });

  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-gray-500 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
        All interview times are in <strong>IST (India Standard Time)</strong>.
        {' '}Server now: <strong>{currentISTClockLabel()}</strong> — pick the same clock for date and time below.
      </p>
      <div>
        <label className="mb-1 block font-medium text-gray-700">Interview type</label>
        <select
          value={form.interviewType}
          onChange={(e) => {
            const interviewType = e.target.value;
            const nextForm = {
              ...form,
              interviewType,
            };
            onChange(
              interviewType === 'offline'
                ? applyOfflineInterviewDefaults(nextForm, offlineDefaults)
                : nextForm
            );
          }}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
        >
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block font-medium text-gray-700">Date (IST)</label>
          <input
            type="date"
            min={todayISODate()}
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
          />
        </div>
        <div>
          <label className="mb-1 block font-medium text-gray-700">Time (IST)</label>
          <input
            type="time"
            value={form.time}
            onChange={(e) => set({ time: e.target.value })}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block font-medium text-gray-700">Duration (minutes)</label>
        <input
          type="number"
          min={15}
          max={480}
          step={15}
          value={form.durationMinutes}
          onChange={(e) => set({ durationMinutes: Number(e.target.value) || 60 })}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
        />
      </div>
      <div>
        <label className="mb-1 block font-medium text-gray-700">Interviewer / host (optional)</label>
        <input
          value={form.interviewer}
          onChange={(e) => set({ interviewer: e.target.value })}
          placeholder="Name or panel"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
        />
      </div>
      <div>
        <label className="mb-1 block font-medium text-gray-700">Notes (optional)</label>
        <textarea
          value={form.notes}
          onChange={(e) => set({ notes: e.target.value })}
          rows={2}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
        />
      </div>
      {form.interviewType === 'online' && (
        <>
          <div>
            <label className="mb-1 block font-medium text-gray-700">Platform</label>
            <input
              value={form.platform}
              onChange={(e) => set({ platform: e.target.value })}
              placeholder="e.g. Google Meet"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
            />
          </div>
          <div>
            <label className="mb-1 block font-medium text-gray-700">Meeting link</label>
            <input
              type="url"
              value={form.meetingLink}
              onChange={(e) => set({ meetingLink: e.target.value })}
              placeholder="https://meet.google.com/..."
              className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
            />
            <p className="mt-1 text-xs text-gray-500">
              Paste your Google Meet or other video link. The candidate will receive it by email.
            </p>
          </div>
        </>
      )}
      {form.interviewType === 'offline' && (
        <>
          <div>
            <label className="mb-1 block font-medium text-gray-700">Office address</label>
            <textarea
              value={form.officeAddress}
              onChange={(e) => set({ officeAddress: e.target.value })}
              rows={2}
              placeholder="Building, floor, full address…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
            />
          </div>
          <div>
            <label className="mb-1 block font-medium text-gray-700">Location / parking notes</label>
            <textarea
              value={form.locationNotes}
              onChange={(e) => set({ locationNotes: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-100"
            />
          </div>
        </>
      )}
    </div>
  );
}
