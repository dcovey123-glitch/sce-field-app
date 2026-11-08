import { weekKeyOf } from './weekStart.js'
// The timesheet's "Material received" export list. Slips in Materials are on
// it by their received date; "Push to export" (Orders → Done) puts a PO on
// this week's list on purpose — its slips, or, when it has no slips, one
// line for the PO itself (kept in timesheet_export_extra).
export const EXPORT_EXTRA_KEY = 'timesheet_export_extra'
export function exportWeekKey(date = new Date()) { return weekKeyOf(date) }
export const normPoKeyTs = s => String(s || '').toLowerCase().replace(/^po\s*#?\s*/, '').replace(/[^0-9a-z]/g, '')
