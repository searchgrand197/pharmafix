import React, { useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import {
  Calendar,
  UserCheck,
  UserX,
  Video,
} from 'lucide-react';
import BulkInterviewModal from './BulkInterviewModal';
import {
  getSelectionStageContext,
  getVisibleBulkActions,
} from '../../hr/recruitmentBulkActions';

/**
 * Fixed bottom bulk-action bar for recruitment candidate lists.
 * Used on /hr/recruitment/candidates and /hr/recruitment/job/:jobId/candidates.
 */
export default function CandidateBulkToolbar({
  selectedList,
  selectedCount,
  listFilterParams,
  onClear,
  onFinished,
}) {
  const [bulkInterviewAction, setBulkInterviewAction] = useState(null);

  if (!selectedCount) return null;

  const visible = getVisibleBulkActions(selectedList);
  const { homogeneous } = getSelectionStageContext(selectedList);
  const axiosListConfig = listFilterParams ? { params: listFilterParams } : {};

  const handleFinished = () => {
    setBulkInterviewAction(null);
    onFinished?.();
  };

  async function bulkShortlist() {
    try {
      const { data } = await api.post(
        '/hr/candidates/bulk_shortlist/',
        { candidate_ids: selectedList.map((c) => c.id) },
        axiosListConfig,
      );
      toast.success(data.message);
      handleFinished();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  }

  async function bulkMoveToInterview() {
    try {
      const { data } = await api.post(
        '/hr/candidates/bulk_move_to_interview/',
        { candidate_ids: selectedList.map((c) => c.id) },
        axiosListConfig,
      );
      toast.success(data.message);
      handleFinished();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  }

  async function bulkReject() {
    try {
      const { data } = await api.post(
        '/hr/candidates/bulk_reject/',
        { candidate_ids: selectedList.map((c) => c.id) },
        axiosListConfig,
      );
      toast.success(data.message);
      handleFinished();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  }

  return (
    <>
      <BulkInterviewModal
        open={Boolean(bulkInterviewAction)}
        action={bulkInterviewAction}
        onClose={() => setBulkInterviewAction(null)}
        listFilterParams={listFilterParams}
        candidateIds={selectedList.map((c) => c.id)}
        candidateLabels={selectedList.map((c) => c.name)}
        onFinished={handleFinished}
      />

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-gray-900">{selectedCount} selected</span>
          <span className="hidden text-xs text-gray-500 sm:inline">(current filters)</span>
          {!homogeneous ? (
            <span className="text-xs text-amber-700">
              Select candidates at the same stage for bulk actions
            </span>
          ) : null}
          {(visible.shortlist ||
            visible.reject ||
            visible.moveToInterview ||
            visible.schedule ||
            visible.reschedule ||
            visible.cancel) ? (
            <div className="mx-2 hidden h-6 w-px bg-gray-200 sm:block" />
          ) : null}
          {visible.shortlist ? (
            <button
              type="button"
              onClick={bulkShortlist}
              className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white"
            >
              <UserCheck size={14} /> Shortlist
            </button>
          ) : null}
          {visible.reject ? (
            <button
              type="button"
              onClick={bulkReject}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800"
            >
              <UserX size={14} /> Reject
            </button>
          ) : null}
          {visible.moveToInterview ? (
            <button
              type="button"
              onClick={bulkMoveToInterview}
              className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-2 text-xs font-bold text-white"
            >
              <Video size={14} /> Move to interview
            </button>
          ) : null}
          {visible.schedule ? (
            <button
              type="button"
              onClick={() => setBulkInterviewAction('schedule')}
              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white"
            >
              <Calendar size={14} /> Schedule interview
            </button>
          ) : null}
          {visible.reschedule ? (
            <button
              type="button"
              onClick={() => setBulkInterviewAction('reschedule')}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white"
            >
              Reschedule
            </button>
          ) : null}
          {visible.cancel ? (
            <button
              type="button"
              onClick={() => setBulkInterviewAction('cancel')}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-800"
            >
              Cancel interview
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-xs font-semibold text-violet-700 underline"
          >
            Clear
          </button>
        </div>
      </div>
    </>
  );
}
