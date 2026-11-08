// Taking material out of Stock for a job, and putting it back.
//
// A job material entry that came out of Stock remembers how much it drew
// (stockQty), how much of that was the "already paid for" portion that costs
// the job nothing (stockFree), and the stock cost per unit (stockUnit). That
// way changing the qty on the job, or deleting the line, moves the
// difference back in or out of Stock instead of leaving the count wrong.

const num = v => Number(v) || 0

// T&M jobs are billed to the customer at cost + materials: the shop's own
// stock isn't theirs, so "already paid for" stock is still charged in full.
export const chargesFullStock = job => !!job && job.type === 'tm'
// The price per unit for a stock draw on this job
export function stockLinePrice(job, qty, free, unit) {
  const q = num(qty)
  if (chargesFullStock(job)) return round(num(unit))
  return q > 0 ? round(((q - num(free)) * num(unit)) / q) : 0
}
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d

function priceFor(qty, free, unit) {
  return qty > 0 ? round(((qty - free) * unit) / qty) : 0
}

// Draw `qty` from a stock item. Returns the new stock list and the fields to
// put on the job entry (stockId, stockQty, stockFree, stockUnit, price).
export function drawFromStock(stockList, stockId, qty) {
  const s = (stockList || []).find(x => x.id === stockId)
  if (!s) return { list: stockList, fields: null, remaining: null }
  const want = Math.max(0, num(qty))
  const drawn = Math.min(want, Math.max(0, num(s.qty)))
  const free = Math.min(drawn, Math.max(0, num(s.paidForQty)))
  const unit = num(s.cost)
  const remaining = round(num(s.qty) - drawn, 3)
  const list = stockList.map(x => x.id !== stockId ? x : {
    ...x, qty: remaining, paidForQty: round(Math.max(0, num(x.paidForQty) - free), 3),
  })
  return {
    list, remaining,
    fields: { stockId, stockQty: drawn, stockFree: free, stockUnit: unit, price: priceFor(want, free, unit) },
  }
}

// The job entry's qty changed (or it's being deleted → newQty 0). Moves the
// difference in or out of Stock. Returns { list, patch } — patch is what to
// merge into the entry (qty, the stock fields, and the re-figured price).
export function adjustStockDraw(stockList, entry, newQty) {
  const qty = Math.max(0, num(newQty))
  if (!entry || !entry.stockId) return { list: stockList, patch: { qty } }
  const s = (stockList || []).find(x => x.id === entry.stockId)
  let drawn = num(entry.stockQty)
  let free = num(entry.stockFree)
  let list = stockList
  if (qty > drawn && s) {
    // Using more — take it from the shelf (paid-for first)
    const take = Math.min(qty - drawn, Math.max(0, num(s.qty)))
    const takeFree = Math.min(take, Math.max(0, num(s.paidForQty)))
    list = stockList.map(x => x.id !== s.id ? x : { ...x, qty: round(num(x.qty) - take, 3), paidForQty: round(num(x.paidForQty) - takeFree, 3) })
    drawn += take; free += takeFree
  } else if (qty < drawn) {
    // Using less — put the extra back on the shelf
    const back = drawn - qty
    const backFree = Math.max(0, free - qty)
    if (s) list = stockList.map(x => x.id !== s.id ? x : { ...x, qty: round(num(x.qty) + back, 3), paidForQty: round(num(x.paidForQty) + backFree, 3) })
    drawn -= back; free -= backFree
  }
  const patch = { qty, stockQty: round(drawn, 3), stockFree: round(free, 3) }
  if (entry.stockUnit != null && (free > 0 || num(entry.stockFree) > 0)) patch.price = priceFor(qty, free, num(entry.stockUnit))
  return { list, patch }
}
