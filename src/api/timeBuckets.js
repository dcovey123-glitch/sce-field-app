// Non-job time: where clocked time goes when it isn't on-site work for a job.
// The ids are stored on every entry — never rename an id, only its label.
// 'admin' used to be "Admin / quoting"; it's now quoting only, with ordering /
// prep and general admin split out (re-sort older entries in Time Tracking).
export const TIME_BUCKETS = {
  planning: 'Project planning / helping',
  admin: 'Quoting / estimating',
  prep: 'Ordering / prep',
  office: 'General admin',
  shop: 'Shop / yard',
  travel: 'Travel / pickup',
}
export const bucketLabel = (id, fallback = '') => TIME_BUCKETS[id] || fallback || id || 'Non-job'
