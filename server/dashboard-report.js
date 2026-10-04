// Administrative counts only; every query retains the caller's member scope.
export async function dashboardReport(db, scope, now = new Date()) {
  const cutoff = new Date(now.getTime() - 7 * 86400000).toISOString();
  const row = await db.prepare(`SELECT COUNT(*) total,
    SUM(CASE WHEN status IN ('pending','flagged') AND created_at < ? THEN 1 ELSE 0 END) overdue_reviews,
    SUM(CASE WHEN TRIM(COALESCE(phone,'')) = '' THEN 1 ELSE 0 END) missing_phone,
    SUM(CASE WHEN TRIM(COALESCE(lga,'')) = '' OR TRIM(COALESCE(ward,'')) = ''
      OR TRIM(COALESCE(polling_unit,'')) = '' THEN 1 ELSE 0 END) missing_location,
    SUM(CASE WHEN TRIM(COALESCE(bank_name,'')) = '' OR TRIM(COALESCE(account_number,'')) = ''
      OR TRIM(COALESCE(account_name,'')) = '' THEN 1 ELSE 0 END) incomplete_payment,
    MIN(CASE WHEN status IN ('pending','flagged') THEN created_at END) oldest_review
    FROM members WHERE (${scope.sql})`).get(cutoff, ...scope.params);
  const statuses = await db.prepare(`SELECT status, COUNT(*) n FROM members
    WHERE (${scope.sql}) GROUP BY status ORDER BY status`).all(...scope.params);
  return {
    ...Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, key === 'oldest_review' ? value : Number(value || 0)])),
    statuses,
    generated_at: now.toISOString(),
  };
}
