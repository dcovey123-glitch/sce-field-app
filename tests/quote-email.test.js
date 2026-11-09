// The standard quote email
import { describe, it, expect } from 'vitest'
import { quoteEmailSubject, quoteEmailBody, isEmail, rememberContact } from '../src/api/quoteEmail.js'

const q = { title: 'B208 Lighting Addition', revision: 0 }

describe('quote email', () => {
  it('subject names the quote, and the revision when there is one', () => {
    expect(quoteEmailSubject(q)).toBe('SCE Electric Quote — B208 Lighting Addition')
    expect(quoteEmailSubject({ ...q, revision: 2 })).toBe('SCE Electric Quote — B208 Lighting Addition (Rev 2)')
    expect(quoteEmailSubject({})).toBe('SCE Electric Quote — Quote')
  })
  it('greets by first name, gives the total before GST, and has no sign-off (Outlook adds it)', () => {
    const body = quoteEmailBody({ quote: q, name: 'Edwin Medina', total: 4250 })
    expect(body).toBe([
      'Hi Edwin,', '',
      'Please find attached our quote for B208 Lighting Addition.', '',
      'The total for this work is $4,250.00 + GST.', '',
      'Let me know if you have any questions, or if you\'d like to go ahead and we\'ll get it scheduled.',
    ].join('\n'))
    expect(body).not.toMatch(/Thanks|Regards|Dustin/)
  })
  it('no name → "Hi,"; total left out when unticked or $0; a revision says "revised"', () => {
    const b = quoteEmailBody({ quote: { ...q, revision: 1 }, total: 4250, includeTotal: false })
    expect(b.startsWith('Hi,\n')).toBe(true)
    expect(b).toContain('our revised quote for')
    expect(b).not.toContain('$')
    expect(quoteEmailBody({ quote: q, total: 0 })).not.toContain('total for this work')
  })
  it('checks the address, and remembers who each customer\'s quotes go to (newest first, no repeats)', () => {
    expect(isEmail('edwin@rdpolytech.ca')).toBe(true)
    expect(isEmail('edwin@')).toBe(false)
    expect(isEmail('a@b.ca, c@d.ca')).toBe(false)
    let book = rememberContact({}, 'c1', 'edwin@rdp.ca', 'Edwin')
    book = rememberContact(book, 'c1', 'lana@rdp.ca', 'Lana')
    book = rememberContact(book, 'c1', 'EDWIN@rdp.ca', 'Edwin M')
    expect(book.c1).toEqual([{ email: 'EDWIN@rdp.ca', name: 'Edwin M' }, { email: 'lana@rdp.ca', name: 'Lana' }])
    expect(rememberContact(book, 'c1', 'bad', 'x')).toBe(book)
  })
})
