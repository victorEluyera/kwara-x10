import React, { useEffect, useState } from 'react';
import { api, num } from '../lib/api.js';
import { Card, Alert, Field, Empty } from './ui.jsx';
import SheetImport from './SheetImport.jsx';

/**
 * Loading a nominee or project list on somebody else's behalf.
 *
 * Lists arrive on paper and in other people's spreadsheets, and it is usually
 * the programme office holding them rather than the candidate. Pick whose list
 * it is and the rest behaves exactly as if they had uploaded it: the same
 * template, scoped to their wards; the same duplicate and register checks; the
 * same quota flagging. The rows are filed under them, and the audit entry
 * records who actually did it.
 *
 * Stakeholders and the Deputy Governor are candidate accounts, so they appear
 * in the same list.
 */
export default function UploadForCandidate() {
  const [candidates, setCandidates] = useState(null);
  const [chosen, setChosen] = useState('');
  const [search, setSearch] = useState('');
  const [opening, setOpening] = useState(null);   // 'nominees' | 'projects'
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    api.get('/nominations')
      .then((d) => setCandidates(d.candidates || d.rows || []))
      .catch((e) => setError(e.message));
  }, []);

  if (error && !candidates) return <Alert type="error">{error}</Alert>;
  if (!candidates) return null;

  const who = candidates.find((c) => String(c.id) === String(chosen));
  const normalizeSearch = (value) => String(value || '').toLocaleLowerCase()
    .replace(/ogbomoso/g, 'ogbomosho');
  const queryText = normalizeSearch(search.trim());
  const matches = candidates.filter((c) => normalizeSearch([
    c.full_name, c.username, c.office, c.scope_value, ...(c.lgas || []),
  ].filter(Boolean).join(' ')).includes(queryText));
  const query = '?candidate_id=' + encodeURIComponent(chosen);
  const label = who ? (who.full_name || who.username) : '';

  return (
    <Card title="Upload a list for someone"
          note="Nominees or projects, filed under the candidate or stakeholder they belong to.">
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
      {done && <Alert type="success" onClose={() => setDone('')}>{done}</Alert>}

      {candidates.length === 0 ? (
        <Empty title="No candidates yet">
          Create candidate accounts first — a list has to belong to someone.
        </Empty>
      ) : (
        <>
          <Field label="Search by name, constituency, or LGA" required
                 hint="The rows are checked against this person's wards and counted towards their quota.">
            <input type="search" value={search}
                   onChange={(e) => setSearch(e.target.value)}
                   placeholder="e.g. Asa, Kwara Central, or a name" />
          </Field>

          <div role="radiogroup" aria-label="Choose candidate or stakeholder"
               style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--ink-200)', borderRadius: 4 }}>
            {matches.length ? matches.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9,
                padding: '9px 10px', margin: 0, borderBottom: '1px solid var(--ink-200)',
                cursor: 'pointer', background: String(c.id) === chosen ? 'var(--green-50)' : 'transparent' }}>
                <input type="radio" name="upload-candidate" value={c.id}
                       checked={String(c.id) === chosen}
                       onChange={() => setChosen(String(c.id))} />
                <span>
                  <strong>{c.full_name || c.username}</strong>
                  <span className="muted"> · {c.office || 'Candidate'}
                    {c.scope_value ? ' · ' + c.scope_value : ''}
                    {c.lgas?.length ? ' · ' + c.lgas.join(', ') : ''}
                  </span>
                </span>
              </label>
            )) : <div className="muted" style={{ padding: 12 }}>No matching people.</div>}
          </div>

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" disabled={!chosen} onClick={() => setOpening('nominees')}>
              Upload nominees
            </button>
            <button className="btn secondary" disabled={!chosen}
                    onClick={() => setOpening('projects')}>
              Upload projects
            </button>
          </div>

          {!chosen && (
            <p className="hint" style={{ marginTop: 10 }}>
              Choose someone first — the template is built from their wards, so it is
              different for every candidate.
            </p>
          )}
        </>
      )}

      {opening === 'nominees' && (
        <SheetImport
          title={'Nominees for ' + label}
          noun="nominee"
          endpoint={'/members/import' + query}
          templatePath={'/members/template.xlsx' + query}
          templateName={'nominees-' + (label || 'candidate').replace(/[^A-Za-z0-9]+/g, '-') + '.xlsx'}
          onClose={() => setOpening(null)}
          onSaved={() => setDone('Nominees added to ' + label + '.')}
          duplicateHint="If one of them really is a different person, change what makes them different — their phone, or their polling unit — and upload again."
          guidance={
            <>
              <p className="hint">
                Built from <strong>{label}</strong>'s own wards and polling units, so the
                spellings match. One row per person; add the name and any details you
                have. Phone and location can be corrected after saving.
              </p>
              <p className="hint">
                Anyone past their allowance is still added, just marked. Anyone already
                on the list, or whose PVC is not in the INEC register, is not.
              </p>
            </>
          }
          describe={(r) => r.nominee && (
            <>
              <strong>{r.nominee.first_name} {r.nominee.last_name}</strong>
              {r.duplicate && <span className="badge red" style={{ marginLeft: 6 }}>duplicate</span>}
              {r.unverified && <span className="badge amber" style={{ marginLeft: 6 }}>PVC to verify</span>}
              {r.over_quota && <span className="badge amber" style={{ marginLeft: 6 }}>over</span>}
              <div className="muted" style={{ fontSize: 11 }}>
                {r.nominee.phone} · {r.nominee.polling_unit}
              </div>
            </>
          )}
          afterSave={(out) => out.logins?.length > 0 && (
            <>
              <div className="section-title">Their logins</div>
              <p className="hint">
                Shown once and never again. Copy them now and pass each person their own.
              </p>
              <button className="btn sm secondary" onClick={() => navigator.clipboard.writeText(
                out.logins.map((l) => [l.name, l.username, l.password].join('\t')).join('\n'))}>
                Copy all {num(out.logins.length)} logins
              </button>
            </>
          )}
        />
      )}

      {opening === 'projects' && (
        <SheetImport
          title={'Projects for ' + label}
          noun="project"
          endpoint={'/projects/import' + query}
          templatePath={'/projects/template.xlsx' + query}
          templateName={'projects-' + (label || 'candidate').replace(/[^A-Za-z0-9]+/g, '-') + '.xlsx'}
          onClose={() => setOpening(null)}
          onSaved={() => setDone('Projects added to ' + label + '.')}
          duplicateHint="To promise more of the same thing in the same place, edit the quantity on the one that is already there rather than adding it twice."
          guidance={
            <>
              <p className="hint">
                Built from <strong>{label}</strong>'s own wards, with the item column as a
                dropdown. One row for each item, in each place — a ward getting a borehole
                and fifty street lights is two rows.
              </p>
              <p className="hint">Only LGA, Ward and Item have to be filled in.</p>
            </>
          }
          describe={(r) => r.project && (
            <>
              <strong>{r.project.project_name}</strong>
              {r.project.quantity > 1 && ' × ' + num(r.project.quantity)}
              {r.duplicate && <span className="badge red" style={{ marginLeft: 6 }}>duplicate</span>}
              <div className="muted" style={{ fontSize: 11 }}>
                {r.project.community ? r.project.community + ', ' : ''}{r.project.ward}
              </div>
            </>
          )}
        />
      )}
    </Card>
  );
}
