// Wholesaler pricing units → the units you actually order and use.
//
// Wholesalers price some lines per a bundle of units: wire per KM (1000 m),
// EMT per 1000 ft (MF / KF), connectors per 100 (C), per 100 ft (CF)... while
// the quantity on the same line is already in metres / feet / each. Taking
// that price as "per unit" makes a 300 m wire line look like $450 a metre.
// Everything is brought back to a price per EA / M / FT here.

const r4 = v => Math.round(v * 10000) / 10000
const num = v => Number(v) || 0

// Printed pricing unit → how many base units it covers, and the base unit
export const PRICE_UNITS = {
  KM: { per: 1000, base: 'M', label: 'per 1000 m' },
  CM: { per: 100, base: 'M', label: 'per 100 m' },
  KF: { per: 1000, base: 'FT', label: 'per 1000 ft' },
  MF: { per: 1000, base: 'FT', label: 'per 1000 ft' },
  MFT: { per: 1000, base: 'FT', label: 'per 1000 ft' },
  CF: { per: 100, base: 'FT', label: 'per 100 ft' },
  CFT: { per: 100, base: 'FT', label: 'per 100 ft' },
  C: { per: 100, base: 'EA', label: 'per 100' },
  CEA: { per: 100, base: 'EA', label: 'per 100' },
  MEA: { per: 1000, base: 'EA', label: 'per 1000' },
}
const BASE_ALIASES = { EACH: 'EA', E: 'EA', PC: 'EA', PCS: 'EA', METER: 'M', METRE: 'M', METERS: 'M', METRES: 'M', MTR: 'M', FEET: 'FT', FOOT: 'FT', F: 'FT', LF: 'FT' }
const clean = u => String(u || '').trim().toUpperCase().replace(/\.$/, '')

export function isBundleUnit(uom) { return !!PRICE_UNITS[clean(uom)] }

// One slip / quote line → { qty, uom, cost, totalPrice, priceUom?, pricePer? }
// Uses the printed line total ÷ qty when there is one (that's always right),
// and the printed unit price to work out what the pricing unit was.
export function normalizeLine(li) {
  const u = clean(li.uom)
  const qty = num(li.qty)
  const total = li.totalPrice != null && li.totalPrice !== '' ? num(li.totalPrice) : null
  const cost = li.cost != null && li.cost !== '' ? num(li.cost) : null
  const pu = PRICE_UNITS[u]
  const out = { ...li }
  if (BASE_ALIASES[u]) out.uom = BASE_ALIASES[u]

  if (qty > 0 && total > 0) {
    const perUnit = total / qty
    const ratio = cost ? cost / perUnit : 1
    const near = (r, t) => Math.abs(r - t) / t < 0.02
    if (pu) {
      if (near(ratio, pu.per) || !cost) {
        // qty already in m / ft / each; price was per bundle
        return { ...out, uom: pu.base, cost: r4(perUnit), priceUom: u, pricePer: cost || r4(perUnit * pu.per) }
      }
      if (near(ratio, 1)) {
        // qty counted in bundles (e.g. 0.3 KM) — turn it into base units
        return { ...out, qty: r4(qty * pu.per), uom: pu.base, cost: r4(perUnit / pu.per), priceUom: u, pricePer: cost }
      }
      return { ...out, uom: pu.base, cost: r4(perUnit), priceUom: u }
    }
    // A plain unit, but the unit price is 100× / 1000× the line math (per-C or
    // per-M pricing not labelled as such)
    if (cost && (near(ratio, 100) || near(ratio, 1000))) return { ...out, cost: r4(perUnit), pricePer: cost, priceUom: near(ratio, 100) ? 'C' : 'M' }
    return { ...out, cost: cost != null && near(ratio, 1) ? cost : r4(perUnit) }
  }
  if (pu && cost != null) return { ...out, uom: pu.base, cost: r4(cost / pu.per), priceUom: u, pricePer: cost }
  return out
}

export function normalizeLines(lines) { return (lines || []).map(normalizeLine) }

// Existing Catalog / Stock items saved with a bundle unit → proposed fix
// ({ item, from: {uom, price}, to: {uom, price, qty?} }). Items whose price
// would fall below a cent are left unticked — they were probably already
// per metre/foot and just labelled with the bundle unit.
export function proposeUnitFixes(list, priceKey) {
  return (list || []).filter(i => isBundleUnit(i.uom)).map(i => {
    const pu = PRICE_UNITS[clean(i.uom)]
    const price = num(i[priceKey])
    const to = { uom: pu.base, price: r4(price / pu.per) }
    if (i.qty != null && i.qty !== '' && priceKey === 'cost') to.qty = num(i.qty) // on-hand count stays (it was counted in m / ft / ea)
    return { item: i, from: { uom: i.uom, price }, to, label: pu.label, likely: price > 0 ? to.price >= 0.01 : true }
  })
}
