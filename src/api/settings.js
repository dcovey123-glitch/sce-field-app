// Every piece of data the app keeps, by name, with what it holds. A name not
// listed here is a typo or a forgotten list — a check (tests/settings.test.js)
// reads the whole app and fails if any name used isn't on this list.
// file: true = kept in its own file in "App Data" (see fileStore.js).

export const STORE = {
  // Materials
  material_orders: { file: true, what: 'Packing slips, invoices and quotes read into the app' },
  material_catalog: { file: true, what: 'The Catalog — parts, nicknames, prices' },
  material_stock: { file: true, what: 'Shop Stock — what\'s on the shelf' },
  material_requests: { file: true, what: 'Orders and pricing requests sent to suppliers' },
  materials_order_list: { file: true, what: 'The Material Order List being put together' },
  materials_catalog_pending: { what: 'Catalog prices waiting for approval' },
  materials_pending_slips: { what: 'Slips read but not filed yet' },
  materials_used_pending: { what: 'Material used, sent from the phone, waiting for approval' },
  material_category_paths: { what: 'Catalog categories' },
  material_parts_stock_only: { what: 'Parts always kept as Stock' },
  materials_email_slips_seen: { what: 'Emailed slips already looked at' },
  materials_feed_quotes_checked: { what: 'Email-run quotes already checked' },
  materials_loose_seen: { what: 'Loose slips already looked at' },
  materials_po_split_v1: { what: 'One-time fix marker for split POs' },
  purchase_marks: { what: 'Purchases you closed or marked by hand' },
  quote_price_references: { what: 'Pricing quotes used as Catalog price references' },
  stock_count: { what: 'The stock count in progress' },
  stock_count_history: { what: 'Past stock counts' },
  // Materials screen layout
  materials_order_sections: { what: 'Which Orders sections are open', view: true },
  materials_orders_detailed: { what: 'Orders detail view on/off', view: true },
  materials_orders_groups: { what: 'Which Orders groups are open', view: true },
  materials_orders_sort: { what: 'Orders sort order', view: true },
  materials_overview_sections: { what: 'Which Overview sections are open', view: true },
  orders_view: { what: 'Orders window tab', view: true },
  // Time
  timesheets: { file: true, what: 'Weekly timesheets' },
  time_nonjob_log: { file: true, what: 'Clocked time not on a job (admin, shop, quoting)' },
  time_pending: { what: 'Clocked time from the phone waiting for review' },
  time_crew_days: { what: 'Crew days confirmed' },
  time_workers: { what: 'Workers on the clock' },
  time_rounding: { what: 'Time rounding setting' },
  time_send_to_timesheet: { what: 'Send confirmed time to the timesheet automatically' },
  time_workday_hours: { what: 'Normal workday hours' },
  timesheets_include_received_material: { what: 'Add received material to the timesheet export' },
  timesheets_pending_expenses: { what: 'Receipts waiting to go on a timesheet' },
  timesheet_export_extra: { what: 'POs pushed onto a week\'s export by hand' },
  week_start_day: { what: 'Day the week starts (0 = Sunday)' },
  crew_roster: { what: 'Crew list and rates' },
  // Notes, tasks, flags
  general_notes: { file: true, what: 'General Notes' },
  daily_notes: { file: true, what: 'Daily Notes' },
  note_groups_open: { what: 'Manual / Assistant note groups open', view: true },
  todos: { what: 'To-do list' },
  task_templates: { what: 'Task templates' },
  flagged_items: { what: 'Flags from the Snapshot' },
  flag_jump: { what: 'Where a flag click should open', view: true },
  // Jobs and quotes (the records themselves are files in the data folder)
  job_customers: { what: 'Job customers (copy of the folder list)' },
  job_projects: { what: 'Jobs (copy of the folder list)' },
  quote_customers: { what: 'Quote customers (copy of the folder list)' },
  quote_quotes: { what: 'Quotes (copy of the folder list)' },
  quote_email_contacts: { what: 'Who each customer\'s quotes are emailed to' },
  quote_sections_open: { what: 'Which quote sections are open', view: true },
  cable_tracker_sections: { what: 'Cable tracker sections', view: true },
  // Home, Today, Snapshot
  today_snoozed: { what: 'Needs-you items snoozed' },
  today_tab: { what: 'Today tab', view: true },
  snapshot_dismissed: { what: 'Snapshot checks dismissed' },
  snapshot_export_opts: { what: 'Snapshot export options', view: true },
  // Trash
  trash_bin_items: { file: true, what: 'Trash' },
  // Connections (never copied into backups)
  anthropic_api_key: { what: 'AI key', secret: true },
  cloud_sync_upload_key: { what: 'Phone sync key', secret: true },
  cloud_sync_worker_url: { what: 'Phone sync address' },
  cloud_sync_last: { what: 'Last phone sync' },
  cloud_sync_proposals: { what: 'Changes from the phone waiting for review' },
}

export const FILE_KEYS = Object.keys(STORE).filter(k => STORE[k].file)
export const SECRET_KEYS = Object.keys(STORE).filter(k => STORE[k].secret)
export const isKnownKey = k => Object.prototype.hasOwnProperty.call(STORE, k)
