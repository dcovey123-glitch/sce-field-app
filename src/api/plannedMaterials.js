// A quote's material lines, converted into a job's editable "planned
// materials" list. Planned lines are NOT part of the job's actual cost — they
// only count once moved to Materials Actual.
export function quotePlannedMaterials(quote) {
  const out = []
  ;(quote.scopes || []).forEach(sc => {
    ;(sc.materials || []).forEach(m => {
      out.push({
        id: Math.random().toString(36).slice(2, 10),
        kind: 'quoted', sourceQuoteId: quote.id, sourceLineId: m.id || '',
        partNo: m.partNo || '', item: m.desc || '', uom: m.uom || '',
        qty: Number(m.qty) || 0, price: Number(m.rate) || 0,
      })
    })
  })
  return out
}
