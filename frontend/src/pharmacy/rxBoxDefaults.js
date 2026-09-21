/** Default prescription print area on OPD A4 template (canvas px). */
export const DEFAULT_RX_BOX = {
  x: 50,
  y: 580,
  width: 924,
  height: 580,
  fontSize: 10,
  showRx: true,
  showChiefComplaint: true,
  showNotes: true,
  showFollowUp: true,
  showQty: true,
  showTiming: true,
}

export function normalizeRxBox(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    x: typeof raw.x === 'number' ? raw.x : DEFAULT_RX_BOX.x,
    y: typeof raw.y === 'number' ? raw.y : DEFAULT_RX_BOX.y,
    width: typeof raw.width === 'number' ? raw.width : DEFAULT_RX_BOX.width,
    height: typeof raw.height === 'number' ? raw.height : DEFAULT_RX_BOX.height,
    fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : DEFAULT_RX_BOX.fontSize,
    showRx: raw.showRx !== false,
    showChiefComplaint: raw.showChiefComplaint !== false,
    showNotes: raw.showNotes !== false,
    showFollowUp: raw.showFollowUp !== false,
    showQty: raw.showQty !== false,
    showTiming: raw.showTiming !== false,
  }
}

export function getRxPrintDefaultsFromLayout(layout) {
  const box = normalizeRxBox(layout?.rx_box)
  if (!box) {
    return {
      showRx: true,
      showChiefComplaint: true,
      showNotes: true,
      showFollowUp: true,
    }
  }
  return {
    showRx: box.showRx,
    showChiefComplaint: box.showChiefComplaint,
    showNotes: box.showNotes,
    showFollowUp: box.showFollowUp,
  }
}
