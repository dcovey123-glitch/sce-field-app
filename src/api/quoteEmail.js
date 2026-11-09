// The standard email that sends a quote's proposal PDF. No sign-off: Outlook
// adds the signature.
import { money } from './format.js'

export const QUOTE_CONTACTS_KEY = 'quote_email_contacts' // { [customerId]: [{ email, name }] } newest first

export function quoteEmailSubject(quote) {
  const title = String((quote && quote.title) || '').trim() || 'Quote'
  const rev = Number(quote && quote.revision) > 0 ? ` (Rev ${quote.revision})` : ''
  return `SCE Electric Quote — ${title}${rev}`
}

export function quoteEmailBody({ quote, name = '', total = 0, includeTotal = true }) {
  const title = String((quote && quote.title) || '').trim()
  const first = String(name || '').trim().split(/\s+/)[0]
  const revised = Number(quote && quote.revision) > 0
  return [
    first ? `Hi ${first},` : 'Hi,',
    '',
    `Please find attached our ${revised ? 'revised ' : ''}quote${title ? ` for ${title}` : ''}.`,
    ...(includeTotal && Number(total) > 0 ? ['', `The total for this work is ${money(total)} + GST.`] : []),
    '',
    'Let me know if you have any questions, or if you\'d like to go ahead and we\'ll get it scheduled.',
  ].join('\n')
}

export const isEmail = s => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(s || '').trim())

// Remember who a customer's quotes go to — newest first, no repeats, up to 6
export function rememberContact(all, customerId, email, name) {
  const book = all && typeof all === 'object' ? all : {}
  if (!customerId || !isEmail(email)) return book
  const e = email.trim().toLowerCase()
  const list = (book[customerId] || []).filter(c => c.email.toLowerCase() !== e)
  return { ...book, [customerId]: [{ email: email.trim(), name: String(name || '').trim() }, ...list].slice(0, 6) }
}
