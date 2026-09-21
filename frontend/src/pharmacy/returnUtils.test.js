import { describe, it, expect } from 'vitest'
import {
  calcLineRefund,
  calcPreviewTotals,
  buildReturnPayload,
  validateReturn,
  isFullBillReturn,
  groupReturnHistoryRows,
} from './returnUtils'

const makeItem = (overrides = {}) => ({
  id: 'item-1',
  medicine: 'med-1',
  batch: 'batch-1',
  qty: '10',
  free_qty: '2',
  mrp: '15.00',
  rate: '10.00',
  cgst_rate: '6',
  sgst_rate: '6',
  amount: '100.00',
  medicine_name: 'Paracetamol',
  ...overrides,
})

describe('calcLineRefund', () => {
  it('returns 0 when return qty is 0', () => {
    expect(calcLineRefund(makeItem(), 0, true)).toBe(0)
  })

  it('calculates correctly with GST enabled', () => {
    // base = 3 * 10 = 30; cgst = 30*0.06=1.8; sgst=1.8; total=33.6
    expect(calcLineRefund(makeItem(), 3, true)).toBeCloseTo(33.6, 5)
  })

  it('calculates without GST when gstEnabled is false', () => {
    // base only = 3 * 10 = 30
    expect(calcLineRefund(makeItem(), 3, false)).toBeCloseTo(30, 5)
  })

  it('handles zero rate', () => {
    expect(calcLineRefund(makeItem({ rate: '0' }), 5, true)).toBe(0)
  })
})

describe('calcPreviewTotals', () => {
  it('returns correct refund for a partial return', () => {
    const items = [makeItem({ qty: '10', rate: '10.00', cgst_rate: '0', sgst_rate: '0' })]
    const { totalRefund, newGrandTotal } = calcPreviewTotals(items, { 'item-1': 4 }, false)
    // refund = 4 * 10 = 40; remaining = 6*10 = 60
    expect(totalRefund).toBeCloseTo(40, 5)
    expect(newGrandTotal).toBeCloseTo(60, 5)
  })

  it('returns 0 totalRefund when no return qty set', () => {
    const items = [makeItem()]
    const { totalRefund } = calcPreviewTotals(items, {}, true)
    expect(totalRefund).toBe(0)
  })

  it('accounts for gst in refund when gstEnabled', () => {
    const items = [makeItem({ qty: '10', rate: '10.00', cgst_rate: '6', sgst_rate: '6' })]
    const { totalRefund } = calcPreviewTotals(items, { 'item-1': 2 }, true)
    // base=20; cgst=1.2; sgst=1.2; refund=22.4
    expect(totalRefund).toBeCloseTo(22.4, 5)
  })
})

describe('buildReturnPayload', () => {
  const baseInvoice = {
    id: 'inv-1',
    invoice_no: 'PH-001',
    gst_enabled: false,
    payment_method: 'cash',
    paid_amount: '100.00',
    total_discount: '5.00',
    remarks: 'test',
    patient_details: {
      first_name: 'John',
      last_name: 'Doe',
      phone: '9876543210',
      gender: 'male',
    },
    items: [makeItem({ qty: '10', free_qty: '0', rate: '10.00' })],
  }

  it('reduces qty by return qty and excludes zero-qty lines', () => {
    const payload = buildReturnPayload(baseInvoice, { 'item-1': 10 }, 0, 0)
    expect(payload.items).toHaveLength(0)
  })

  it('keeps lines with remaining qty', () => {
    const payload = buildReturnPayload(baseInvoice, { 'item-1': 4 }, 60, 60)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].qty).toBe(6)
  })

  it('preserves free_qty unchanged', () => {
    const invWithFreeQty = { ...baseInvoice, items: [makeItem({ qty: '10', free_qty: '3', rate: '10.00' })] }
    const payload = buildReturnPayload(invWithFreeQty, { 'item-1': 4 }, 60, 60)
    expect(payload.items[0].free_qty).toBe(3)
  })

  it('caps paid_amount at new grand total', () => {
    const payload = buildReturnPayload(baseInvoice, { 'item-1': 4 }, 60, 60)
    // paid was 100, new grand total is 60 → should cap at 60
    expect(payload.invoice.paid_amount).toBe(60)
  })

  it('sets paid_amount to 0 for credit invoices', () => {
    const creditInv = { ...baseInvoice, payment_method: 'credit', paid_amount: '0' }
    const payload = buildReturnPayload(creditInv, { 'item-1': 4 }, 60, 60)
    expect(payload.invoice.paid_amount).toBe(0)
  })

  it('caps total_discount at new subtotal+tax', () => {
    // discount=5, but new total=3 → discount should cap at 3
    const payload = buildReturnPayload(baseInvoice, { 'item-1': 4 }, 60, 3)
    expect(payload.invoice.total_discount).toBe(3)
  })
})

describe('validateReturn', () => {
  const invoice = {
    items: [
      makeItem({ id: 'item-1', qty: '10' }),
      makeItem({ id: 'item-2', qty: '5' }),
    ],
  }

  it('returns error when no qty selected', () => {
    const err = validateReturn(invoice, {})
    expect(err).toBeTruthy()
  })

  it('passes when at least one item has returnQty > 0', () => {
    const err = validateReturn(invoice, { 'item-1': 3 })
    expect(err).toBeNull()
  })

  it('allows returning all items (full return triggers cancel flow in caller)', () => {
    const err = validateReturn(invoice, { 'item-1': 10, 'item-2': 5 })
    expect(err).toBeNull()
  })

  it('blocks returnQty exceeding soldQty', () => {
    const err = validateReturn(invoice, { 'item-1': 11 })
    expect(err).toBeTruthy()
    expect(err).toContain('exceeds')
  })

  it('passes when only one of two lines is fully returned', () => {
    // 1 item returned fully but 1 remains → valid
    const err = validateReturn(invoice, { 'item-1': 10 })
    expect(err).toBeNull()
  })
})

describe('isFullBillReturn', () => {
  const invoice = {
    items: [
      makeItem({ id: 'item-1', qty: '10' }),
      makeItem({ id: 'item-2', qty: '5' }),
    ],
  }

  it('returns false when no qty set', () => {
    expect(isFullBillReturn(invoice, {})).toBe(false)
  })

  it('returns false when only one item is fully returned', () => {
    expect(isFullBillReturn(invoice, { 'item-1': 10 })).toBe(false)
  })

  it('returns false for a partial return', () => {
    expect(isFullBillReturn(invoice, { 'item-1': 5, 'item-2': 5 })).toBe(false)
  })

  it('returns true when all items are fully returned', () => {
    expect(isFullBillReturn(invoice, { 'item-1': 10, 'item-2': 5 })).toBe(true)
  })

  it('returns false for empty invoice', () => {
    expect(isFullBillReturn({ items: [] }, { 'item-1': 10 })).toBe(false)
  })
})

describe('groupReturnHistoryRows', () => {
  it('returns empty array for empty input', () => {
    expect(groupReturnHistoryRows([])).toEqual([])
  })

  it('groups rows with same invoice, type, and second', () => {
    const rows = [
      {
        id: '1',
        reference_id: 'inv-a',
        reference_type: 'pharmacy_edit',
        created_at: '2026-06-19T10:30:45.123Z',
        invoice_no: 'INV260',
        customer_name: 'John Doe',
        medicine_name: 'Paracetamol',
        batch_no: 'B001',
        qty_change: 7,
        line_refund: '70.00',
      },
      {
        id: '2',
        reference_id: 'inv-a',
        reference_type: 'pharmacy_edit',
        created_at: '2026-06-19T10:30:45.456Z',
        invoice_no: 'INV260',
        customer_name: 'John Doe',
        medicine_name: 'Crocin',
        batch_no: 'B002',
        qty_change: 3,
        line_refund: '30.50',
      },
    ]
    const groups = groupReturnHistoryRows(rows)
    expect(groups).toHaveLength(1)
    expect(groups[0].invoiceNo).toBe('INV260')
    expect(groups[0].customerName).toBe('John Doe')
    expect(groups[0].items).toHaveLength(2)
    expect(groups[0].refundAmount).toBeCloseTo(100.5, 5)
  })

  it('splits groups by different return sessions on same invoice', () => {
    const rows = [
      {
        id: '1',
        reference_id: 'inv-a',
        reference_type: 'pharmacy_edit',
        created_at: '2026-06-19T10:30:45Z',
        medicine_name: 'A',
        qty_change: 1,
      },
      {
        id: '2',
        reference_id: 'inv-a',
        reference_type: 'pharmacy_edit',
        created_at: '2026-06-19T11:00:00Z',
        medicine_name: 'B',
        qty_change: 2,
      },
    ]
    expect(groupReturnHistoryRows(rows)).toHaveLength(2)
  })

  it('keeps pharmacy_edit and pharmacy_cancel separate', () => {
    const rows = [
      {
        id: '1',
        reference_id: 'inv-a',
        reference_type: 'pharmacy_edit',
        created_at: '2026-06-19T10:30:45Z',
        medicine_name: 'A',
        qty_change: 1,
      },
      {
        id: '2',
        reference_id: 'inv-a',
        reference_type: 'pharmacy_cancel',
        created_at: '2026-06-19T10:30:45Z',
        medicine_name: 'B',
        qty_change: 2,
      },
    ]
    expect(groupReturnHistoryRows(rows)).toHaveLength(2)
  })

  it('sorts groups newest first', () => {
    const rows = [
      {
        id: '1',
        reference_id: 'inv-old',
        reference_type: 'pharmacy_edit',
        created_at: '2026-06-18T10:00:00Z',
        medicine_name: 'Old',
        qty_change: 1,
      },
      {
        id: '2',
        reference_id: 'inv-new',
        reference_type: 'pharmacy_edit',
        created_at: '2026-06-19T10:00:00Z',
        medicine_name: 'New',
        qty_change: 1,
      },
    ]
    const groups = groupReturnHistoryRows(rows)
    expect(groups[0].referenceId).toBe('inv-new')
    expect(groups[1].referenceId).toBe('inv-old')
  })
})
