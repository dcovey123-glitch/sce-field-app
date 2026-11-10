import { useLocalStore } from './useLocalStore.js'
import { useOrdersFeed, useOrdersPrevious } from './orders.js'
import { buildPurchases, needsYou } from './purchases.js'

// Purchases that need you, worked out the same way Materials does
const arr = v => Array.isArray(v) ? v : []
export function usePurchaseAttention() {
  const [orders] = useLocalStore('material_orders', [])
  const [requests] = useLocalStore('material_requests', [])
  const [marks] = useLocalStore('purchase_marks', {})
  const feed = useOrdersFeed()
  const prev = useOrdersPrevious()
  return needsYou(buildPurchases({ slips: arr(orders), feed: arr(feed), previous: arr(prev), marks: marks || {}, requests: arr(requests) }))
}
