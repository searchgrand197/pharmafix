import { describe, expect, it } from 'vitest'
import {
  computeBillingTotals,
  computeInvoiceRoundOff,
  computeMargGstOnBase,
  computeMargPurchaseLineAmounts,
  computePurchaseLineAmounts,
  computeSaleGstTotals,
  DEFAULT_OUTLET_GST_PERCENT,
  formatStockDual,
  formatStripsAndTablets,
  lineDiscountRupeesFromPercent,
  lineSellingRateDisplay,
  parseOutletDefaultGstPercent,
  resolveEffectiveGstPercent,
  splitGstEqually,
} from './pharmacyCalculations'

describe('lineSellingRateDisplay', () => {
  it('returns unit rate × qty for line display', () => {
    expect(lineSellingRateDisplay({ qty: 3, rate: 10.5 })).toBe(31.5)
    expect(lineSellingRateDisplay({ qty: 2, rate: 61.43 })).toBe(122.86)
  })
  it('returns unit rate when qty is zero', () => {
    expect(lineSellingRateDisplay({ qty: 0, rate: 12 })).toBe(12)
  })
})

describe('computeInvoiceRoundOff', () => {
  it('rounds down and reports the deducted paise', () => {
    expect(computeInvoiceRoundOff(120.4)).toEqual({ payable: 120, roundOff: -0.4 })
  })
  it('rounds up at half a rupee', () => {
    expect(computeInvoiceRoundOff(120.5)).toEqual({ payable: 121, roundOff: 0.5 })
    expect(computeInvoiceRoundOff(120.6)).toEqual({ payable: 121, roundOff: 0.4 })
  })
  it('leaves whole rupees and zero untouched', () => {
    expect(computeInvoiceRoundOff(120)).toEqual({ payable: 120, roundOff: 0 })
    expect(computeInvoiceRoundOff(0)).toEqual({ payable: 0, roundOff: 0 })
  })
})

describe('computeBillingTotals', () => {
  it('sums rows with GST', () => {
    const rows = [
      { medicine: { id: 1 }, amount: 100 },
      { medicine: null, amount: 0 },
    ]
    const t = computeBillingTotals(rows, 12)
    expect(t.subtotal).toBe(100)
    expect(t.gst).toBe(12)
    expect(t.grandTotal).toBe(112)
  })
})

describe('parseOutletDefaultGstPercent', () => {
  it('keeps 0% from settings (does not fall back)', () => {
    expect(parseOutletDefaultGstPercent(0)).toBe(0)
    expect(parseOutletDefaultGstPercent('0')).toBe(0)
  })
  it('uses fallback when unset', () => {
    expect(parseOutletDefaultGstPercent(undefined)).toBe(DEFAULT_OUTLET_GST_PERCENT)
    expect(parseOutletDefaultGstPercent('')).toBe(DEFAULT_OUTLET_GST_PERCENT)
  })
})

describe('resolveEffectiveGstPercent', () => {
  it('uses row over product over default', () => {
    expect(
      resolveEffectiveGstPercent({
        rowGst: 12,
        productGst: 5,
        defaultGst: 5,
        noGst: false,
      }),
    ).toBe(12)
    expect(
      resolveEffectiveGstPercent({
        rowGst: '',
        productGst: 5,
        defaultGst: 8,
        noGst: false,
      }),
    ).toBe(5)
    expect(
      resolveEffectiveGstPercent({
        rowGst: null,
        productGst: null,
        defaultGst: 7,
        noGst: false,
      }),
    ).toBe(7)
  })
  it('noGst forces zero', () => {
    expect(
      resolveEffectiveGstPercent({
        rowGst: 18,
        productGst: 5,
        defaultGst: 5,
        noGst: true,
      }),
    ).toBe(0)
  })
})

describe('computeMargGstOnBase', () => {
  it('exclusive: tax then discount', () => {
    const r = computeMargGstOnBase({
      baseAmount: 100,
      discount: 5,
      gstType: 'exclusive',
      gstPercent: 12,
      noGst: false,
    })
    expect(r.taxableAmount).toBe(100)
    expect(r.gstAmount).toBe(12)
    expect(r.finalAmount).toBe(107)
    expect(r.cgst + r.sgst).toBe(12)
  })
  it('inclusive: discount after base', () => {
    const r = computeMargGstOnBase({
      baseAmount: 112,
      discount: 10,
      gstType: 'inclusive',
      gstPercent: 12,
      noGst: false,
    })
    expect(r.taxableAmount).toBe(100)
    expect(r.gstAmount).toBe(12)
    expect(r.finalAmount).toBe(102)
  })
  it('noGst clears tax', () => {
    const r = computeMargGstOnBase({
      baseAmount: 200,
      discount: 0,
      gstType: 'exclusive',
      gstPercent: 12,
      noGst: true,
    })
    expect(r.gstAmount).toBe(0)
    expect(r.finalAmount).toBe(200)
  })
})

describe('splitGstEqually', () => {
  it('sums to total', () => {
    const { cgst, sgst } = splitGstEqually(12)
    expect(cgst + sgst).toBe(12)
  })
})

describe('lineDiscountRupeesFromPercent', () => {
  it('converts percent of line base to rupees when no batch MRP', () => {
    expect(lineDiscountRupeesFromPercent({ qty: 1, rate: 100, line_discount: 5 })).toBe(5)
    expect(lineDiscountRupeesFromPercent({ qty: 2, rate: 100, line_discount: 5 })).toBe(10)
    expect(lineDiscountRupeesFromPercent({ qty: 1, rate: 100, line_discount: 0 })).toBe(0)
    expect(lineDiscountRupeesFromPercent({ qty: 1, rate: 100, line_discount: 100 })).toBe(100)
  })
  it('returns 0 when batch MRP exists (rate already includes discount)', () => {
    expect(
      lineDiscountRupeesFromPercent({ qty: 3, rate: 2.5, batch: { mrp: 3 }, line_discount: 16 }),
    ).toBe(0)
  })
})

describe('computeSaleGstTotals', () => {
  it('uses product GST when row blank', () => {
    const t = computeSaleGstTotals(
      [{ medicine: { id: 1, gst_percent: 5 }, qty: 2, rate: 100, gst_percent: '', gst_type: 'exclusive', no_gst: false, line_discount: 0 }],
      8,
    )
    expect(t.taxableSubtotal).toBe(200)
    expect(t.gst).toBe(10)
    expect(t.grandTotal).toBe(210)
  })
  it('invoice non-GST mode ignores product GST', () => {
    const t = computeSaleGstTotals(
      [{ medicine: { id: 1, gst_percent: 18 }, qty: 1, rate: 100, gst_percent: '12', gst_type: 'exclusive', no_gst: false, line_discount: 5 }],
      5,
      false,
    )
    expect(t.gst).toBe(0)
    expect(t.cgst).toBe(0)
    expect(t.sgst).toBe(0)
    expect(t.grandTotal).toBe(95)
    expect(t.taxableSubtotal).toBe(95)
  })
  it('non-GST: no MRP row — % off qty×rate (3×2.5, 16%) → 6.30', () => {
    const t = computeSaleGstTotals(
      [{ medicine: { id: 1 }, qty: 3, rate: 2.5, gst_type: 'exclusive', no_gst: true, line_discount: 16 }],
      5,
      false,
    )
    expect(t.grandTotal).toBe(6.3)
    expect(t.taxableSubtotal).toBe(6.3)
  })
  it('non-GST: batch MRP present uses selling base without double discount', () => {
    const t = computeSaleGstTotals(
      [
        {
          medicine: { id: 1 },
          batch: { mrp: 3 },
          qty: 3,
          rate: 2.5,
          gst_type: 'exclusive',
          no_gst: true,
          line_discount: 16,
        },
      ],
      5,
      false,
    )
    expect(t.grandTotal).toBe(7.5)
    expect(t.taxableSubtotal).toBe(7.5)
  })
})

describe('computeMargPurchaseLineAmounts', () => {
  it('strip vs tablet rate same line gross', () => {
    const strip = computeMargPurchaseLineAmounts({
      qty: 2,
      conversion: 10,
      rateType: 'STRIP',
      purchaseRate: 100,
      discount: 0,
      gstType: 'exclusive',
      gstPercent: 12,
      skipGst: false,
    })
    const tab = computeMargPurchaseLineAmounts({
      qty: 2,
      conversion: 10,
      rateType: 'TABLET',
      purchaseRate: 10,
      discount: 0,
      gstType: 'exclusive',
      gstPercent: 12,
      skipGst: false,
    })
    expect(strip.taxableAmount).toBe(200)
    expect(tab.taxableAmount).toBe(200)
    expect(strip.totalQty).toBe(20)
  })
  it('row GST overrides product and default', () => {
    const a = computeMargPurchaseLineAmounts({
      qty: 1,
      conversion: 10,
      rateType: 'STRIP',
      purchaseRate: 100,
      discount: 0,
      gstType: 'exclusive',
      rowGstPercent: 18,
      productGstPercent: 5,
      defaultGstPercent: 5,
      skipGst: false,
    })
    expect(a.gstAmount).toBe(18)
    const b = computeMargPurchaseLineAmounts({
      qty: 1,
      conversion: 10,
      rateType: 'STRIP',
      purchaseRate: 100,
      discount: 0,
      gstType: 'exclusive',
      rowGstPercent: '',
      productGstPercent: 5,
      defaultGstPercent: 8,
      skipGst: false,
    })
    expect(b.gstAmount).toBe(5)
  })
  it('challanGstEnabled false forces no tax', () => {
    const r = computeMargPurchaseLineAmounts({
      qty: 1,
      conversion: 10,
      rateType: 'STRIP',
      purchaseRate: 100,
      discount: 0,
      gstType: 'exclusive',
      rowGstPercent: 18,
      productGstPercent: 12,
      defaultGstPercent: 5,
      skipGst: false,
      challanGstEnabled: false,
    })
    expect(r.gstAmount).toBe(0)
    expect(r.finalAmount).toBe(100)
  })
})

describe('computePurchaseLineAmounts', () => {
  it('exclusive', () => {
    const r = computePurchaseLineAmounts({
      qtyPacks: 2,
      purchaseRate: 100,
      discount: 0,
      gstType: 'exclusive',
      gstPercent: 12,
      skipGst: false,
    })
    expect(r.taxableAmount).toBe(200)
    expect(r.gstAmount).toBe(24)
    expect(r.finalAmount).toBe(224)
  })
})

describe('formatStripsAndTablets', () => {
  it('splits strips and remainder tabs', () => {
    expect(formatStripsAndTablets(25, 10, 'tab')).toBe('2 strips + 5 tab')
    expect(formatStripsAndTablets(20, 10, 'tab')).toBe('2 strips')
  })
})

describe('formatStockDual', () => {
  it('shows base and strips', () => {
    const s = formatStockDual(100, { strip: 10 }, 'tablets')
    expect(s).toContain('100')
    expect(s).toContain('strip')
  })
})
