import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';
import toast from 'react-hot-toast';
import { AlertTriangle, Fingerprint, RefreshCw, Wifi, WifiOff } from 'lucide-react';

function formatLastSeenAbsolute(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function formatLastSeenRelative(iso, nowMs = Date.now()) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const seconds = Math.max(0, Math.floor((nowMs - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return d.toLocaleString();
}

function getBannerTone({ online, assigned, ok, pendingConflicts }) {
  if (ok && pendingConflicts === 0) {
    return {
      border: 'border-emerald-200 bg-emerald-50',
      titleColor: 'text-emerald-900',
      bodyColor: 'text-emerald-800',
      iconColor: 'text-emerald-700',
      badge: 'bg-emerald-100 text-emerald-800',
    };
  }
  if (online && !assigned) {
    return {
      border: 'border-orange-200 bg-orange-50',
      titleColor: 'text-orange-900',
      bodyColor: 'text-orange-800',
      iconColor: 'text-amber-700',
      badge: 'bg-amber-100 text-amber-800',
    };
  }
  if (!online) {
    return {
      border: 'border-slate-200 bg-slate-50',
      titleColor: 'text-slate-900',
      bodyColor: 'text-slate-600',
      iconColor: 'text-slate-500',
      badge: 'bg-slate-200 text-slate-700',
    };
  }
  return {
    border: 'border-amber-200 bg-amber-50',
    titleColor: 'text-amber-900',
    bodyColor: 'text-amber-800',
    iconColor: 'text-amber-700',
    badge: 'bg-amber-100 text-amber-800',
  };
}

export default function BiometricDeviceStatusBar() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/hr/biometric-devices/connection-status/');
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  const syncAll = async (deviceId) => {
    setSyncing(true);
    try {
      const { data } = await api.post(`/hr/biometric-devices/${deviceId}/sync-all/`);
      await load();
      toast.success(`Queued ${data.employees_queued ?? 0} employee(s) to the device`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to sync employees to device');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        Checking biometric device…
      </div>
    );
  }

  const devices = status?.devices || [];
  const pendingConflicts = status?.pending_unlinked_users ?? 0;
  const rejectedPunches = status?.recent_rejected_punches ?? 0;
  const reviewRows = status?.attendance_rows_requiring_review ?? 0;

  const conflictBanner = pendingConflicts > 0 ? (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong>{pendingConflicts}</strong>
          {' '}
          machine user(s) are not in HR. Their punches will not count until you review conflicts.
        </p>
      </div>
      <Link
        to="/hr/operations/biometric-conflicts"
        className="shrink-0 rounded-lg bg-amber-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-950"
      >
        Review conflicts
      </Link>
    </div>
  ) : null;

  const rejectedBanner = rejectedPunches > 0 ? (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm text-rose-950">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong>{rejectedPunches}</strong>
          {' '}
          biometric punch(es) were rejected in the last 24 hours. Check blocked PINs, eligibility, or device clock.
        </p>
      </div>
      <Link
        to="/hr/operations/biometric-rejected-punches"
        className="shrink-0 rounded-lg bg-rose-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-800"
      >
        Review rejected punches
      </Link>
    </div>
  ) : null;

  const reviewBanner = reviewRows > 0 ? (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
      <strong>{reviewRows}</strong>
      {' '}
      attendance row(s) from today need HR review because of incomplete, conflicting, or protected-day punch activity.
    </div>
  ) : null;

  if (!devices.length) {
    return (
      <div className="space-y-3">
        {conflictBanner}
        {rejectedBanner}
        {reviewBanner}
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <WifiOff className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-900">No biometric device detected</p>
            <p className="text-amber-800 mt-1">
              Point the K90 to <code className="bg-amber-100 px-1 rounded">http://&lt;your-PC-IP&gt;:8000/iclock/</code> and wait ~10s for the first heartbeat.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const ok = status?.setup_ok;

  return (
    <div className="space-y-3">
      {conflictBanner}
      {rejectedBanner}
      {reviewBanner}
      <div className="space-y-3">
        {devices.map((device, index) => {
          const online = device.is_online;
          const assigned = device.hospital_assigned;
          const tone = getBannerTone({ online, assigned, ok, pendingConflicts });
          return (
            <div
              key={device.id || device.serial_number || index}
              className={`rounded-xl border ${tone.border} px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}
            >
              <div className="flex items-start gap-3 min-w-0">
                {online ? (
                  <Wifi className={`w-5 h-5 shrink-0 mt-0.5 ${tone.iconColor}`} />
                ) : (
                  <WifiOff className={`w-5 h-5 shrink-0 mt-0.5 ${tone.iconColor}`} />
                )}
                <div className="text-sm min-w-0">
                  <p className={`font-medium ${tone.titleColor} flex items-center gap-2 flex-wrap`}>
                    <Fingerprint className="w-4 h-4" />
                    Biometric: {device.name || device.serial_number}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tone.badge}`}>
                      {online ? 'Connected' : 'Offline'}
                    </span>
                    {!assigned && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">
                        Unassigned
                      </span>
                    )}
                  </p>
                  <p className={`${tone.bodyColor} mt-1 flex flex-wrap gap-x-2`}>
                    <span>SN {device.serial_number}</span>
                    <span>•</span>
                    <span title={formatLastSeenAbsolute(device.last_seen) || undefined}>
                      Last seen {formatLastSeenRelative(device.last_seen)}
                    </span>
                    {device.ip_address && (
                      <>
                        <span>•</span>
                        <span>Device IP {device.ip_address}</span>
                      </>
                    )}
                    {device.pending_commands > 0 && (
                      <>
                        <span>•</span>
                        <span><strong>{device.pending_commands}</strong> command(s) waiting</span>
                      </>
                    )}
                  </p>
                  {!assigned && (
                    <p className="text-orange-800 mt-1">
                      Device is not linked to your hospital. Assign it in{' '}
                      <Link to="/admin/hr/biometricdevice/" className="underline font-medium" target="_blank" rel="noreferrer">
                        Django admin
                      </Link>
                      {' '}or wait for the next heartbeat if only one hospital exists.
                    </p>
                  )}
                  {assigned && online && device.pending_commands > 0 && (
                    <p className={`${tone.bodyColor} mt-1`}>
                      Employees are queued and will be picked up on the next device poll.
                    </p>
                  )}
                  {Array.isArray(device.health_issues) && device.health_issues.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-amber-900">
                      {device.health_issues.map((issue) => (
                        <li key={issue.code}>• {issue.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {index === 0 && (
                  <button
                    type="button"
                    onClick={load}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white hover:bg-slate-50"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                  </button>
                )}
                {assigned && (
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={() => syncAll(device.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {syncing ? 'Syncing…' : 'Sync all employees'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
