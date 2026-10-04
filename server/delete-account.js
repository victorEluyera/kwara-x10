/** Remove the login while retaining submitted records and their attribution. */
export async function deleteAccount(db, target, deletedAt) {
  await db.transaction(async tx => {
    await tx.prepare('SELECT id FROM users WHERE id = ? FOR UPDATE').get(target.id);
    for (const [table,column] of [
      ['users','upline_id'],['members','upline_user_id'],['members','reviewed_by'],
      ['submissions','user_id'],['submissions','reviewed_by'],['tasks','created_by'],
      ['points_ledger','user_id'],['audit_log','user_id'],['disparity_reports','reviewed_by'],
      ['password_reset_requests','resolved_by'],['project_status_events','changed_by'],
      ['project_photos','uploaded_by'],
    ]) await tx.prepare(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`).run(target.id);
    // These records remain available to administration after the owner login is gone.
    for (const table of ['projects','disparity_reports']) {
      await tx.prepare(`UPDATE ${table} SET former_candidate_name = ?, former_candidate_office = ?, former_candidate_scope = ?, former_candidate_username = ?, candidate_id = NULL WHERE candidate_id = ?`)
        .run(target.full_name,target.office || null,target.scope_value || null,target.username,target.id);
    }
    await tx.prepare('UPDATE api_keys SET created_by = NULL, revoked_at = COALESCE(revoked_at, ?) WHERE created_by = ?').run(deletedAt,target.id);
    await tx.prepare('DELETE FROM password_reset_requests WHERE user_id = ?').run(target.id);
    await tx.prepare('DELETE FROM registration_drafts WHERE creator_user_id = ?').run(target.id);
    await tx.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  });
}
