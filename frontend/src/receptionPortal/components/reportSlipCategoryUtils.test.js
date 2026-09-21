import { describe, expect, it } from 'vitest'
import {
  aggregatePaymentSlipsByCategory,
  aggregatePaymentSlipsByItem,
  buildQuickServiceCatalog,
  flattenPaymentSlipItems,
  resolveItemCategory,
  UNCATEGORIZED,
} from './reportSlipCategoryUtils'

const catalog = buildQuickServiceCatalog([
  { label: 'CBC', category: 'Lab', price: 500 },
  { label: 'Chest X-Ray', category: 'X-Ray', price: 350 },
])

describe('resolveItemCategory', () => {
  it('uses stored item.category over catalog', () => {
    const item = { description: 'CBC', unit_price: 500, category: 'Pathology' }
    expect(resolveItemCategory(item, catalog)).toBe('Pathology')
  })

  it('falls back to quick-service catalog by label and price', () => {
    const item = { description: 'CBC', unit_price: 500 }
    expect(resolveItemCategory(item, catalog)).toBe('Lab')
    const xray = { description: 'Chest X-Ray', unit_price: 350 }
    expect(resolveItemCategory(xray, catalog)).toBe('X-Ray')
  })

  it('returns Uncategorized when no match', () => {
    const item = { description: 'Unknown test', unit_price: 100 }
    expect(resolveItemCategory(item, catalog)).toBe(UNCATEGORIZED)
  })
})

describe('aggregatePaymentSlipsByCategory', () => {
  const payments = [
    {
      amount: 850,
      invoice_details: {
        items: [
          { description: 'CBC', unit_price: 500, line_total: 500, category: 'Lab' },
          { description: 'Chest X-Ray', unit_price: 350, line_total: 350 },
        ],
      },
    },
    {
      amount: 500,
      invoice_details: {
        items: [{ description: 'CBC', unit_price: 500, line_total: 500 }],
      },
    },
  ]

  it('aggregates lines into separate categories', () => {
    const result = aggregatePaymentSlipsByCategory(payments, catalog)
    expect(result).toEqual([
      { category: 'Lab', line_count: 2, total: '1000.00' },
      { category: 'X-Ray', line_count: 1, total: '350.00' },
    ])
  })

  it('filters to a single category when categoryFilter is set', () => {
    const result = aggregatePaymentSlipsByCategory(payments, catalog, { categoryFilter: 'Lab' })
    expect(result).toEqual([{ category: 'Lab', line_count: 2, total: '1000.00' }])
  })

  it('treats payments without items as Uncategorized', () => {
    const result = aggregatePaymentSlipsByCategory(
      [{ amount: 200, invoice_details: { items: [] } }],
      catalog,
    )
    expect(result).toEqual([{ category: UNCATEGORIZED, line_count: 1, total: '200.00' }])
  })
})

describe('aggregatePaymentSlipsByItem', () => {
  const payments = [
    {
      amount: 850,
      invoice_details: {
        items: [
          { description: 'CBC', unit_price: 500, line_total: 500, quantity: 2, category: 'Lab' },
          { description: 'Chest X-Ray', unit_price: 350, line_total: 350, quantity: 1 },
        ],
      },
    },
    {
      amount: 500,
      invoice_details: {
        items: [{ description: 'CBC', unit_price: 500, line_total: 500, quantity: 1 }],
      },
    },
  ]

  it('aggregates quantity and amount per item across all slips', () => {
    const result = aggregatePaymentSlipsByItem(payments, catalog)
    expect(result).toEqual([
      { item: 'CBC', total_qty: 3, total: '1000.00' },
      { item: 'Chest X-Ray', total_qty: 1, total: '350.00' },
    ])
  })

  it('filters to a single category when categoryFilter is set', () => {
    const result = aggregatePaymentSlipsByItem(payments, catalog, { categoryFilter: 'Lab' })
    expect(result).toEqual([{ item: 'CBC', total_qty: 3, total: '1000.00' }])
  })

  it('treats payments without items as a single item row', () => {
    const result = aggregatePaymentSlipsByItem(
      [{ amount: 200, description: 'Misc charge', invoice_details: { items: [] } }],
      catalog,
    )
    expect(result).toEqual([{ item: 'Misc charge', total_qty: 1, total: '200.00' }])
  })
})

describe('flattenPaymentSlipItems', () => {
  const payments = [
    {
      paid_at: '2026-06-12T10:00:00Z',
      slip_number: 'PSL-001',
      patient_name: 'Alice',
      patient_uhid: 'UHID-1',
      amount: 850,
      invoice_details: {
        items: [
          { description: 'CBC', unit_price: 500, line_total: 500, quantity: 1, category: 'Lab' },
          { description: 'Chest X-Ray', unit_price: 350, line_total: 350, quantity: 1 },
        ],
      },
    },
    {
      paid_at: '2026-06-12T11:00:00Z',
      slip_number: 'PSL-002',
      patient_name: 'Bob',
      patient_uhid: 'UHID-2',
      amount: 500,
      invoice_details: {
        items: [{ description: 'CBC', unit_price: 500, line_total: 500, quantity: 1 }],
      },
    },
  ]

  it('returns one row per billed item across all slips', () => {
    const rows = flattenPaymentSlipItems(payments, catalog)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      slip_number: 'PSL-001',
      description: 'CBC',
      category: 'Lab',
      amount: 500,
    })
    expect(rows[1]).toMatchObject({
      description: 'Chest X-Ray',
      category: 'X-Ray',
      amount: 350,
    })
    expect(rows[2]).toMatchObject({
      slip_number: 'PSL-002',
      description: 'CBC',
      category: 'Lab',
      amount: 500,
    })
  })

  it('filters to a single category when categoryFilter is set', () => {
    const rows = flattenPaymentSlipItems(payments, catalog, { categoryFilter: 'Lab' })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.category === 'Lab')).toBe(true)
  })

  it('treats payments without items as a single fallback row', () => {
    const rows = flattenPaymentSlipItems(
      [{
        paid_at: '2026-06-12T12:00:00Z',
        slip_number: 'PSL-003',
        patient_name: 'Carol',
        amount: 200,
        description: 'Misc charge',
        invoice_details: { items: [] },
      }],
      catalog,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      slip_number: 'PSL-003',
      description: 'Misc charge',
      category: UNCATEGORIZED,
      quantity: 1,
      amount: 200,
    })
  })
})
