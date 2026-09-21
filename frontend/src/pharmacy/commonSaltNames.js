/**
 * Common generic medicine salts for doctor "Not in pharma" prescribing.
 * Generic names only — no brand names.
 */

const RAW_SALTS = [
  // Analgesics / antipyretics / NSAIDs
  'Paracetamol', 'Ibuprofen', 'Diclofenac', 'Naproxen', 'Aspirin', 'Ketorolac',
  'Tramadol', 'Mefenamic Acid', 'Celecoxib', 'Piroxicam', 'Aceclofenac', 'Nimesulide',
  // Antibiotics
  'Amoxicillin', 'Amoxycillin', 'Azithromycin', 'Ciprofloxacin', 'Ceftriaxone',
  'Metronidazole', 'Doxycycline', 'Clindamycin', 'Ampicillin', 'Trimethoprim',
  'Cephalexin', 'Erythromycin', 'Nitrofurantoin', 'Levofloxacin', 'Ofloxacin',
  'Cefixime', 'Cefpodoxime', 'Clavulanic Acid', 'Linezolid', 'Meropenem',
  // Antacids / GI
  'Omeprazole', 'Pantoprazole', 'Ranitidine', 'Famotidine', 'Metoclopramide',
  'Domperidone', 'Ondansetron', 'Sucralfate', 'Lactulose', 'Bisacodyl',
  'Rabeprazole', 'Esomeprazole', 'Drotaverine', 'Hyoscine Butylbromide',
  // Cardiac / antihypertensives
  'Amlodipine', 'Atenolol', 'Metoprolol', 'Losartan', 'Ramipril', 'Enalapril',
  'Digoxin', 'Furosemide', 'Spironolactone', 'Nitroglycerin', 'Clopidogrel',
  'Warfarin', 'Heparin', 'Atorvastatin', 'Rosuvastatin', 'Simvastatin',
  'Telmisartan', 'Hydrochlorothiazide', 'Isosorbide Mononitrate',
  // Diabetes
  'Metformin', 'Glibenclamide', 'Glipizide', 'Insulin', 'Sitagliptin',
  'Empagliflozin', 'Dapagliflozin', 'Pioglitazone', 'Glimepiride', 'Gliclazide',
  // Respiratory
  'Salbutamol', 'Budesonide', 'Fluticasone', 'Montelukast', 'Theophylline',
  'Ipratropium', 'Tiotropium', 'Salmeterol', 'Formoterol', 'Ambroxol',
  // Vitamins / supplements
  'Calcium', 'Zinc', 'Folic Acid', 'Iron', 'Vitamin B12', 'Vitamin B6',
  'Vitamin D3', 'Magnesium', 'Potassium', 'Multivitamin', 'Vitamin C',
  // Steroids
  'Prednisolone', 'Dexamethasone', 'Hydrocortisone', 'Methylprednisolone', 'Betamethasone',
  // CNS / psych / neuro
  'Diazepam', 'Lorazepam', 'Alprazolam', 'Phenobarbitone', 'Phenytoin',
  'Levetiracetam', 'Gabapentin', 'Pregabalin', 'Amitriptyline', 'Sertraline',
  'Fluoxetine', 'Haloperidol', 'Carbamazepine', 'Sodium Valproate',
  // Antihistamines / antiemetics
  'Cetirizine', 'Levocetirizine', 'Chlorpheniramine', 'Promethazine', 'Hydroxyzine',
  // Antispasmodics / others
  'Dicyclomine', 'Mebeverine', 'Albendazole', 'Metronidazole', 'Fluconazole',
  'Clotrimazole', 'Acyclovir', 'Permethrin',
  // IV fluids
  'Normal Saline', 'Ringer Lactate', 'Dextrose', 'DNS', 'Glucose',
]

function dedupeSalts(names) {
  const seen = new Set()
  const out = []
  for (const raw of names) {
    const name = String(raw || '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

export const COMMON_RX_SALTS = dedupeSalts(RAW_SALTS)

/** Lowercase tokens for AI voice / text extraction (includes multi-word as single tokens). */
export const COMMON_RX_SALTS_LOWER = COMMON_RX_SALTS.map((s) => s.toLowerCase())

/** Legacy alias used by AI extractor in DoctorPortal. */
export const MEDICINE_DB_LOWER = COMMON_RX_SALTS_LOWER

function rankSalt(name, q) {
  const n = name.toLowerCase()
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.includes(q)) return 2
  return 3
}

/**
 * Filter salts by query. extraNames are prepended (e.g. hospital custom salts).
 * Returns deduplicated display names, custom/extra matches first when query empty.
 */
export function filterCommonSalts(query, extraNames = []) {
  const q = String(query || '').trim().toLowerCase()
  const merged = dedupeSalts([
    ...(Array.isArray(extraNames) ? extraNames : []),
    ...COMMON_RX_SALTS,
  ])

  if (!q) {
    return merged.slice(0, 12)
  }

  return merged
    .filter((name) => name.toLowerCase().includes(q))
    .sort((a, b) => rankSalt(a, q) - rankSalt(b, q))
    .slice(0, 12)
}

export function normalizeSaltName(name) {
  return String(name || '').trim().toLowerCase()
}

export function isCommonSaltName(name) {
  const n = normalizeSaltName(name)
  return COMMON_RX_SALTS_LOWER.includes(n)
}
