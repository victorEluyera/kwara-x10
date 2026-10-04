import {memberScope} from './scope.js';
import {isUnitPromoterRole,isGrassrootRole} from './auth.js';
import {duplicateMergeReason} from './network-report.js';
export async function mergeNetworkDuplicates(db,user,ids,keepId) {
  const scope=memberScope(user),marks=ids.map(()=>'?').join(',');
    await db.transaction(async tx=>{
      const rows=await tx.prepare('SELECT * FROM members WHERE id IN ('+marks+') AND ('+scope.sql+') ORDER BY id FOR UPDATE').all(...ids,...scope.params);
      if(rows.length!==ids.length) throw Object.assign(new Error('You can only consolidate records in your own network'),{status:403});
      const reason=duplicateMergeReason(rows);if(reason)throw Object.assign(new Error(reason),{status:409});
      const removeIds=ids.filter(id=>id!==keepId),removeMarks=removeIds.map(()=>'?').join(',');
      const outside=await tx.prepare('SELECT id FROM members WHERE upline_member_id IN ('+removeMarks+') AND NOT ('+scope.sql+') LIMIT 1').get(...removeIds,...scope.params);
      if(outside)throw Object.assign(new Error('A linked downline belongs to another network; administrator review required'),{status:409});
      const accounts=await tx.prepare('SELECT id,role FROM users WHERE member_id IN ('+removeMarks+') FOR UPDATE').all(...removeIds);
      if(accounts.some(a=>!isUnitPromoterRole(a.role)&&!isGrassrootRole(a.role)))throw Object.assign(new Error('A record is linked to a leadership account; administrator review required'),{status:409});
      const tasks=await tx.prepare('SELECT task_id FROM submissions WHERE member_id IN ('+marks+') GROUP BY task_id HAVING COUNT(*) > 1 LIMIT 1').get(...ids);
      if(tasks)throw Object.assign(new Error('These records have overlapping task submissions; administrator review required'),{status:409});
      await tx.prepare('UPDATE members SET upline_member_id = ? WHERE upline_member_id IN ('+removeMarks+')').run(keepId,...removeIds);
      await tx.prepare('UPDATE users SET member_id = ? WHERE member_id IN ('+removeMarks+')').run(keepId,...removeIds);
      for(const table of ['submissions','points_ledger'])await tx.prepare('UPDATE '+table+' SET member_id = ? WHERE member_id IN ('+removeMarks+')').run(keepId,...removeIds);
      await tx.prepare('DELETE FROM members WHERE id IN ('+removeMarks+')').run(...removeIds);
    });
}
