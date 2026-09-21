import { useEffect, useMemo, useState } from 'react';
import { format, startOfMonth } from 'date-fns';
import { formatDateTime, useTimeDisplayMode } from '@/utils/dateTimeFormat';

function formatHandoverDateTime(iso) {
  return formatDateTime(iso, {});
}
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import api from '@/api';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import CreditCardOutlinedIcon from '@mui/icons-material/CreditCardOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import { useAuth } from '@admin/context/AuthContext';
import { useToast } from '@admin/context/ToastContext';
import { AppButton } from '@/components/AppButton';
import CollectionTransactionList from '@/components/collection/CollectionTransactionList';
import HandoverCollectionTable from '@/components/collection/HandoverCollectionTable';
import {
  useHospitalCollectionQuery,
  useVerifyHandoverMutation,
} from '@/hooks/useHandoverQuery';
import { getApiErrorMessage } from '@/utils/apiError';

function todayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

function monthStartStr() {
  return format(startOfMonth(new Date()), 'yyyy-MM-dd');
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN')}`;
}

function SummaryCard({ label, value, icon: Icon, accent }) {
  return (
    <Card variant="outlined" sx={{ height: '100%', borderColor: accent ? 'primary.light' : 'divider' }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          {Icon ? <Icon sx={{ fontSize: 18, color: accent || 'text.secondary' }} /> : null}
          <Typography variant="caption" fontWeight={800} textTransform="uppercase" color="text.secondary">
            {label}
          </Typography>
        </Stack>
        <Typography variant="h5" fontWeight={800}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" fontWeight={700} textTransform="uppercase">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={700} sx={{ mt: 0.25 }}>
        {value}
      </Typography>
    </Box>
  );
}

function PendingHandoverCard({ handover, onVerify, verifyingId }) {
  const isBusy = verifyingId === handover.id;
  const requestedAt = handover.created_at;

  return (
    <Card variant="outlined" sx={{ borderColor: 'warning.light', bgcolor: 'warning.50' }}>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
            <Typography variant="subtitle1" fontWeight={700}>
              Shift handover — action required
            </Typography>
            <Chip size="small" label="Pending" color="warning" />
          </Stack>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <DetailRow label="Date & time" value={formatHandoverDateTime(requestedAt)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <DetailRow label="From (staff)" value={handover.from_user_name || '—'} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <DetailRow label="Declared cash" value={formatMoney(handover.declared_cash_amount)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <DetailRow label="To (you)" value={handover.to_user_name || '—'} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <DetailRow label="System cash" value={formatMoney(handover.system_cash_amount)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <DetailRow label="System UPI" value={formatMoney(handover.system_upi_amount)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <DetailRow label="System other" value={formatMoney(handover.system_other_amount)} />
            </Grid>
          </Grid>

          {handover.from_user_email ? (
            <Typography variant="caption" color="text.secondary">
              Staff email: {handover.from_user_email}
            </Typography>
          ) : null}
          {handover.notes ? (
            <Typography variant="body2" color="text.secondary">
              Note: {handover.notes}
            </Typography>
          ) : null}
          <Stack direction="row" spacing={1} flexWrap="wrap">
            <AppButton
              variant="contained"
              color="primary"
              disabled={isBusy}
              onClick={() => onVerify(handover.id, 'accept')}
            >
              {isBusy ? 'Processing…' : 'Verify & Accept'}
            </AppButton>
            <AppButton
              variant="outlined"
              color="error"
              disabled={isBusy}
              onClick={() => onVerify(handover.id, 'reject')}
            >
              Reject
            </AppButton>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function CashCollectionPage() {
  useTimeDisplayMode();
  const { user } = useAuth();
  const { showToast } = useToast();
  const hasHospital = Boolean(user?.hospital_id);

  const [dateFrom, setDateFrom] = useState(monthStartStr);
  const [dateTo, setDateTo] = useState(todayStr);
  const [appliedRange, setAppliedRange] = useState({ from: monthStartStr(), to: todayStr() });
  const [receptionCollectionEnabled, setReceptionCollectionEnabled] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/settings/reception-portal/');
        const row = data?.data || data || {};
        if (!cancelled) {
          setReceptionCollectionEnabled(row.reception_collection_enabled !== false);
        }
      } catch {
        // keep default enabled
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    data: collectionPayload,
    isLoading,
    isError,
    error,
    refetch,
  } = useHospitalCollectionQuery(
    { dateFrom: appliedRange.from, dateTo: appliedRange.to },
    { enabled: hasHospital },
  );

  async function handleReceptionCollectionToggle(checked) {
    setSettingsSaving(true);
    try {
      await api.patch('/settings/reception-portal/', { reception_collection_enabled: checked });
      setReceptionCollectionEnabled(checked);
      showToast({
        type: 'success',
        message: checked
          ? 'Reception shift collection and handover enabled'
          : 'Reception collection disabled — admin panel shows hospital totals only',
      });
      refetch();
    } catch (err) {
      showToast({
        type: 'error',
        message: getApiErrorMessage(err, 'Could not save collection setting'),
      });
    } finally {
      setSettingsSaving(false);
    }
  }

  const verifyMutation = useVerifyHandoverMutation();
  const verifyingId = verifyMutation.isPending ? verifyMutation.variables?.handoverId : null;

  const collection = collectionPayload?.collection || {};
  const collectionEntries = useMemo(
    () =>
      Array.isArray(collectionPayload?.collection_entries) ? collectionPayload.collection_entries : [],
    [collectionPayload?.collection_entries],
  );
  const collectionEnabledFromApi = collectionPayload?.reception_collection_enabled;
  const receptionCollectionOn =
    collectionEnabledFromApi !== undefined
      ? collectionEnabledFromApi !== false
      : receptionCollectionEnabled;

  const pendingHandovers = useMemo(
    () =>
      receptionCollectionOn && Array.isArray(collectionPayload?.pending_received)
        ? collectionPayload.pending_received
        : [],
    [collectionPayload?.pending_received, receptionCollectionOn],
  );

  const handoverTableRows = useMemo(
    () => (receptionCollectionOn ? collectionEntries.filter((e) => e.entry_type === 'handover') : []),
    [collectionEntries, receptionCollectionOn],
  );

  const paymentEntries = useMemo(
    () => collectionEntries.filter((e) => e.entry_type !== 'handover'),
    [collectionEntries],
  );

  const stats = useMemo(
    () => ({
      cash: parseFloat(collection.cash_total) || 0,
      upi: parseFloat(collection.upi_total) || 0,
      other: parseFloat(collection.other_total) || 0,
      total: parseFloat(collection.grand_total) || 0,
    }),
    [collection],
  );

  const periodLabel = useMemo(() => {
    try {
      const from = format(new Date(appliedRange.from), 'd MMM yyyy');
      const to = format(new Date(appliedRange.to), 'd MMM yyyy');
      return `${from} – ${to}`;
    } catch {
      return `${appliedRange.from} – ${appliedRange.to}`;
    }
  }, [appliedRange]);

  function applyDateFilter() {
    if (!dateFrom || !dateTo) {
      showToast({ type: 'error', message: 'Select both from and to dates' });
      return;
    }
    if (dateFrom > dateTo) {
      showToast({ type: 'error', message: 'From date cannot be after to date' });
      return;
    }
    setAppliedRange({ from: dateFrom, to: dateTo });
  }

  function resetToCurrentMonth() {
    const from = monthStartStr();
    const to = todayStr();
    setDateFrom(from);
    setDateTo(to);
    setAppliedRange({ from, to });
  }

  async function handleVerify(handoverId, action) {
    try {
      await verifyMutation.mutateAsync({ handoverId, action });
      showToast({
        type: action === 'accept' ? 'success' : 'info',
        message:
          action === 'accept'
            ? 'Handover accepted. Cash is now in your shift.'
            : 'Handover rejected.',
      });
      refetch();
    } catch (err) {
      showToast({ type: 'error', message: getApiErrorMessage(err, 'Failed to process handover') });
    }
  }

  if (!hasHospital) {
    return (
      <Box>
        <Typography variant="h5" sx={{ mb: 2 }}>
          Cash collection
        </Typography>
        <Alert severity="warning">
          Your account is not linked to a hospital. Cash collection is only available for hospital admins with a
          hospital assigned.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ mb: 3 }}>
        <AccountBalanceWalletOutlinedIcon color="primary" sx={{ fontSize: 36, mt: 0.5 }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" fontWeight={700}>
            Cash collection
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            {receptionCollectionOn
              ? 'Hospital-wide reception collections for the selected period. Verify shift handovers from staff below.'
              : 'Hospital-wide reception collections for the selected period. Reception shift handover is disabled — totals are managed here only.'}
          </Typography>
        </Box>
      </Stack>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <FormControlLabel
            control={
              <Switch
                checked={receptionCollectionOn}
                onChange={(e) => handleReceptionCollectionToggle(e.target.checked)}
                disabled={settingsLoading || settingsSaving}
              />
            }
            label={
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  Reception shift collection
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  When on, reception staff see collection summary and can hand over shifts. When off, collection is
                  viewed only on this admin page (no handover).
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'flex-start', m: 0 }}
          />
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', sm: 'flex-end' }}
            flexWrap="wrap"
          >
            <TextField
              label="From"
              type="date"
              size="small"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 160 }}
            />
            <TextField
              label="To"
              type="date"
              size="small"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 160 }}
            />
            <AppButton variant="contained" onClick={applyDateFilter}>
              Apply
            </AppButton>
            <AppButton variant="outlined" onClick={resetToCurrentMonth}>
              This month
            </AppButton>
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
            Showing collections for {periodLabel} (all reception staff)
          </Typography>
        </CardContent>
      </Card>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : null}

      {isError ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {getApiErrorMessage(error, 'Could not load collection data')}
        </Alert>
      ) : null}

      {!isLoading && !isError ? (
        <>
          {receptionCollectionOn ? (
            <>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <PendingActionsOutlinedIcon color="warning" fontSize="small" />
                <Typography variant="subtitle1" fontWeight={700}>
                  Pending verification
                </Typography>
                {pendingHandovers.length > 0 ? (
                  <Chip size="small" label={pendingHandovers.length} color="warning" />
                ) : null}
              </Stack>

              {pendingHandovers.length === 0 ? (
                <Alert severity="info" icon={false} sx={{ mb: 3 }}>
                  No pending handovers. When staff send you a shift handover, it will appear here.
                </Alert>
              ) : (
                <Stack spacing={2} sx={{ mb: 3 }}>
                  {pendingHandovers.map((h) => (
                    <PendingHandoverCard
                      key={h.id}
                      handover={h}
                      onVerify={handleVerify}
                      verifyingId={verifyingId}
                    />
                  ))}
                </Stack>
              )}
            </>
          ) : null}

          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, md: 4 }}>
              <SummaryCard label="Cash total" value={formatMoney(stats.cash)} icon={CreditCardOutlinedIcon} accent="success.main" />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <SummaryCard label="UPI total" value={formatMoney(stats.upi)} icon={PaymentsOutlinedIcon} accent="info.main" />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <SummaryCard label="Other total" value={formatMoney(stats.other)} icon={LocalOfferOutlinedIcon} />
            </Grid>
          </Grid>

          {receptionCollectionOn ? (
            <HandoverCollectionTable
              handovers={handoverTableRows}
              emptyMessage="No handovers in this period"
            />
          ) : null}

          <CollectionTransactionList
            entries={paymentEntries}
            stats={stats}
            showOpeningCash={false}
            showDateTimeColumn
            listCountLabel={`${paymentEntries.length} collections`}
            emptyMessage="No OPD or payment slip collections in this period"
          />

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            Totals represent all reception collections in the selected date range.
          </Typography>
        </>
      ) : null}
    </Box>
  );
}
