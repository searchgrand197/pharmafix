import React, { useEffect, useState } from 'react'

const STORAGE_KEY = 'pharmacy_bill_display'
const POLL_MS = 2000

function readBill() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export default function PharmacySalesDisplay() {
  const [bill, setBill] = useState(() => readBill())

  useEffect(() => {
    function onStorage(e) {
      if (e.key === STORAGE_KEY) setBill(readBill())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setBill(readBill()), POLL_MS)
    return () => clearInterval(id)
  }, [])

  const fmt = (n) =>
    Number.isFinite(Number(n)) ? `₹${Number(n).toFixed(2)}` : '—'
  const customerDetails = bill?.customerDetails || null
  const infoBits = []
  if (customerDetails?.uhid) infoBits.push(`UHID: ${customerDetails.uhid}`)
  if (customerDetails?.phone) infoBits.push(`Phone: ${customerDetails.phone}`)
  if (customerDetails?.age !== '' && customerDetails?.age !== null && customerDetails?.age !== undefined) {
    infoBits.push(`Age: ${customerDetails.age}`)
  }
  if (customerDetails?.gender) infoBits.push(`Gender: ${customerDetails.gender}`)

  if (!bill || !bill.lines?.length) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center select-none">
        <div className="text-center space-y-5 px-8">
          <div className="text-8xl font-black tracking-tight text-slate-200">Rx</div>
          <p className="text-4xl font-semibold text-slate-400 tracking-wide">
            Waiting for next sale…
          </p>
          <p className="text-xl text-slate-400">This screen will update automatically</p>
        </div>
      </div>
    )
  }

  const totalGst = (Number(bill.cgst) || 0) + (Number(bill.sgst) || 0)

  return (
    <div className="min-h-screen bg-white text-slate-800 flex flex-col select-none">
      {/* Header */}
      <header className="shrink-0 px-10 py-7 border-b-2 border-slate-200 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900">
            {bill.pharmacyName || 'Pharmacy'}
          </h1>
          {bill.customerName ? (
            <p className="text-xl text-blue-600 font-semibold mt-1.5">
              Customer: {bill.customerName}
            </p>
          ) : (
            <p className="text-xl text-slate-400 mt-1.5">Walk-in customer</p>
          )}
          {infoBits.length > 0 ? (
            <p className="text-sm text-slate-500 mt-1">
              {infoBits.join(' | ')}
            </p>
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-400 uppercase tracking-widest font-bold">Bill total</p>
          <p className="text-6xl font-black tabular-nums text-emerald-600 mt-1">
            {fmt(bill.grandTotal)}
          </p>
        </div>
      </header>

      {/* Items table */}
      <div className="flex-1 overflow-auto px-10 py-7">
        <table className="w-full text-lg">
          <thead>
            <tr className="text-sm font-bold uppercase tracking-widest text-slate-400 border-b-2 border-slate-200">
              <th className="pb-4 text-left pr-4 w-10">#</th>
              <th className="pb-4 text-left">Medicine</th>
              <th className="pb-4 text-right px-5">Qty</th>
              <th className="pb-4 text-right px-5">MRP</th>
              <th className="pb-4 text-right px-5">Rate</th>
              <th className="pb-4 text-right px-5">Discount</th>
              <th className="pb-4 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((line, i) => (
              <tr
                key={i}
                className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
              >
                <td className="py-4 pr-4 text-slate-400 text-base">{i + 1}</td>
                <td className="py-4 font-semibold text-slate-900">{line.name}</td>
                <td className="py-4 text-right px-5 tabular-nums text-slate-600">
                  {line.qtyLabel || line.qty}
                </td>
                <td className="py-4 text-right px-5 tabular-nums text-slate-500">
                  {line.mrp ? fmt(line.mrp) : '—'}
                </td>
                <td className="py-4 text-right px-5 tabular-nums text-slate-600">
                  {fmt(line.rate)}
                </td>
                <td className="py-4 text-right px-5 tabular-nums text-emerald-600 font-medium">
                  {Number(line.discountPct) > 0 ? `${Number(line.discountPct).toFixed(2)}%` : '—'}
                </td>
                <td className="py-4 text-right tabular-nums font-bold text-slate-900">
                  {fmt(line.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer totals */}
      <footer className="shrink-0 border-t-2 border-slate-200 px-10 py-7 bg-slate-50">
        <div className="max-w-sm ml-auto space-y-2.5 text-lg">
          <div className="flex justify-between text-slate-500">
            <span>Subtotal</span>
            <span className="tabular-nums">{fmt(bill.subtotal)}</span>
          </div>
          {totalGst > 0 && (
            <div className="flex justify-between text-slate-500">
              <span>GST</span>
              <span className="tabular-nums">{fmt(totalGst)}</span>
            </div>
          )}
          {Number(bill.discount) > 0 && (
            <div className="flex justify-between text-emerald-600 font-semibold">
              <span>Discount</span>
              <span className="tabular-nums">- {fmt(bill.discount)}</span>
            </div>
          )}
          {Number(bill.roundOff) !== 0 && (
            <div className="flex justify-between text-slate-500">
              <span>Round off</span>
              <span className="tabular-nums">
                {Number(bill.roundOff) > 0 ? '+ ' : '− '}{fmt(Math.abs(Number(bill.roundOff)))}
              </span>
            </div>
          )}
          <div className="flex justify-between text-3xl font-black pt-3 border-t-2 border-slate-300 text-emerald-600">
            <span>Total</span>
            <span className="tabular-nums">{fmt(bill.grandTotal)}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
