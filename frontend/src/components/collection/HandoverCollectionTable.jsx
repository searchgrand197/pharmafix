import React, { useMemo, useState } from 'react'
import { formatDateTime, useTimeDisplayMode } from '../../utils/dateTimeFormat'
import { SwapHoriz } from '@mui/icons-material'
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { AppButton } from '@/components/AppButton'

const ITEMS_PER_PAGE = 10

function formatDateTimeCell(iso) {
  return formatDateTime(iso, {})
}

function formatAmount(value) {
  const n = parseFloat(String(value || '').replace(/,/g, ''))
  if (!Number.isFinite(n)) return '₹0'
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function HandoverCollectionTable({ handovers = [], emptyMessage = 'No handovers in this period' }) {
  useTimeDisplayMode()
  const [page, setPage] = useState(1)

  const rows = useMemo(() => (handovers || []).filter((h) => h.entry_type === 'handover'), [handovers])

  const totalPages = Math.max(1, Math.ceil(rows.length / ITEMS_PER_PAGE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * ITEMS_PER_PAGE
  const pageRows = rows.slice(start, start + ITEMS_PER_PAGE)

  React.useEffect(() => {
    setPage(1)
  }, [handovers])

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden', mb: 3 }}>
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SwapHoriz color="warning" fontSize="small" />
          <Typography variant="subtitle2" fontWeight={800}>
            Shift handovers
          </Typography>
        </Box>
        <Chip size="small" label={`${rows.length} handover${rows.length === 1 ? '' : 's'}`} />
      </Box>

      <TableContainer sx={{ maxHeight: 420 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase' }}>
                Verified date &amp; time
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase' }}>
                Handover amount
              </TableCell>
              <TableCell sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase' }}>
                Handover from (staff)
              </TableCell>
              <TableCell sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase' }}>
                Status
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary', fontStyle: 'italic' }}>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row) => {
                const isVerified = row.handover_status === 'accepted'
                const verifiedLabel = isVerified
                  ? formatDateTime(row.handover_verified_at || row.entry_time)
                  : '—'
                const requestedHint = !isVerified ? formatDateTime(row.handover_requested_at) : null

                return (
                  <TableRow key={row.id} hover sx={{ bgcolor: isVerified ? 'action.hover' : 'warning.50' }}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>
                        {verifiedLabel}
                      </Typography>
                      {requestedHint ? (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Requested: {requestedHint}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={800}>
                        {formatAmount(row.handover_declared_cash || row.amount)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>
                        {row.handover_from_name || row.created_by_name || '—'}
                      </Typography>
                      {row.handover_to_name ? (
                        <Typography variant="caption" color="text.secondary" display="block">
                          To: {row.handover_to_name}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={isVerified ? 'Verified' : 'Pending'}
                        color={isVerified ? 'success' : 'warning'}
                        variant={isVerified ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {rows.length > 0 ? (
        <Box
          sx={{
            px: 2,
            py: 1.5,
            borderTop: 1,
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {`Showing ${start + 1}–${Math.min(start + ITEMS_PER_PAGE, rows.length)} of ${rows.length}`}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AppButton size="small" variant="outlined" disabled={safePage === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </AppButton>
            <Typography variant="caption" sx={{ px: 0.5 }}>
              Page {safePage} of {totalPages}
            </Typography>
            <AppButton
              size="small"
              variant="contained"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </AppButton>
          </Box>
        </Box>
      ) : null}
    </Paper>
  )
}
