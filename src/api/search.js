// One search rule for the whole app: every word you type has to be in there
// somewhere, in any order, and punctuation / spaces don't matter —
// "emt 3/4" finds 3/4" EMT, "wphh1086" finds WPHH 1086, "10150" finds PO #10150.
const lc = s => String(s == null ? '' : s).toLowerCase()
const compact = s => lc(s).replace(/[^a-z0-9]/g, '')

export function searchWords(q) {
  return lc(q).split(/[\s,]+/).map(w => w.trim()).filter(Boolean)
}

// text: a string or an array of strings/values
export function hit(text, q) {
  const words = Array.isArray(q) ? q : searchWords(q)
  if (!words.length) return true
  const hay = lc(Array.isArray(text) ? text.filter(v => v != null).join(' ') : text)
  const hayC = compact(hay)
  return words.every(w => hay.includes(w) || (compact(w) && hayC.includes(compact(w))))
}
