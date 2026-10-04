import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, num, timeAgo, LEVEL_LABEL } from '../lib/api.js';
import { Card, Status, Loading, Empty, Alert, Stat, Modal } from '../components/ui.jsx';
import { GoldRule } from '../components/Brand.jsx';
import { useAuth } from '../App.jsx';

const FLAG_LABEL = {
  duplicate: 'Duplicate identity',
  format: 'Invalid format',
  nuban_invalid: 'Impossible account number',
  account_name_mismatch: 'Account name mismatch',
  bank_confirmed_mismatch: 'Bank paid a different person',
  bank_name_mismatch: 'Bank name mismatch',
  nin_name_mismatch: 'NIN belongs to someone else',
  voter_roll: 'Voter register problem',
  geo_outside: 'Registered outside Kwara State',
  geo_missing: 'No GPS captured',
  surname_cluster: 'Surname clustering',
  shared_account: 'Shared bank account',
  rapid_entry: 'Bulk entry pattern',
};

const KEYLESS = new Set(['duplicate', 'format', 'nuban_invalid', 'account_name_mismatch',
  'geo_outside', 'geo_missing', 'surname_cluster', 'shared_account', 'rapid_entry',
  'voter_roll', 'bank_confirmed_mismatch']);

function riskTone(score) {
  return score >= 50 ? 'red' : score >= 20 ? 'amber' : 'green';
}

export default function Verification({ compact = false }) {
  const { me } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [flagFilter, setFlagFilter] = useState('');

  const load = () => api.get('/verification/queue').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const runBulk = async () => {
    setRunning(true); setError('');
    try {
      const r = await api.post('/admin/verify-bulk', { limit: 1000 });
      setResult(r);
      await load();
    } catch (e) { setError(e.message); }
    finally { setRunning(false); }
  };

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loading label="Loading verification queue" />;

  const { spread, rows } = data;
  const counts = {};
  for (const r of rows) for (const f of r.flags) counts[f.code] = (counts[f.code] || 0) + 1;

  const shown = flagFilter
    ? rows.filter((r) => r.flags.some((f) => f.code === flagFilter))
    : rows;

  if (compact) {
    const preview = shown.slice(0, 6);
    return (
      <>
        {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
        {data.simulated && (
          <Alert type="warn" title="Simulation mode is on. ">
            NIN and bank-name checks are simulated for demo use.
          </Alert>
        )}
        <div className="grid grid-2" style={{ gap: 10, marginBottom: 12 }}>
          <Stat label="Verified" value={num(spread.clean)} />
          <Stat label="Flagged" value={num(spread.high)} />
        </div>
        {preview.length === 0 ? (
          <Empty title="No people flagged" icon="✓">
            The people you added are passing verification checks.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Level</th><th>Issue</th><th>Risk</th></tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.first_name} {r.last_name}</td>
                    <td><span className="badge">{LEVEL_LABEL[r.level] || r.level}</span></td>
                    <td>{r.flags[0] ? (FLAG_LABEL[r.flags[0].code] || r.flags[0].code) : 'Review required'}</td>
                    <td><span className={'badge ' + riskTone(r.risk_score)}>{r.risk_score}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}

      {result && (
        <Modal title="Verification run complete" onClose={() => setResult(null)}>
          <div className="grid grid-3" style={{ gap: 10, marginBottom: 14 }}>
            <Stat label="Checked" value={num(result.checked)} />
            <Stat label="Clean" value={num(result.clean)} accent />
            <Stat label="High risk" value={num(result.flagged)} />
          </div>
          <div className="section-title">Issues found</div>
          {Object.keys(result.by_flag).length === 0
            ? <Empty title="No issues raised" icon="✓" />
            : Object.entries(result.by_flag)
                .sort((a, b) => b[1] - a[1])
                .map(([code, n]) => (
                  <div key={code} className="check-row">
                    <div className={'check-icon ' + (KEYLESS.has(code) ? 'warn' : 'fail')}>!</div>
                    <div style={{ flex: 1 }}>
                      <div className="check-label">{FLAG_LABEL[code] || code}</div>
                      <div className="check-detail">
                        {KEYLESS.has(code) ? 'Detected with no external provider' : 'External check'}
                      </div>
                    </div>
                    <span className="badge">{num(n)}</span>
                  </div>
                ))}
        </Modal>
      )}

      {data.simulated && (
        <Alert type="warn" title="Simulation mode is on. ">
          NIN and bank-name results are <strong>simulated for demonstration</strong> and
          are not real identity checks. Unset <code>VERIFY_MODE=simulate</code> to
          disable. The keyless checks below are real in every mode.
        </Alert>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Records checked" value={num(spread.total)} accent
              foot="Every registration runs the full pipeline" />
        <Stat label="Clean" value={num(spread.clean)}
              foot="No issue raised"
              progress={spread.total ? (spread.clean / spread.total) * 100 : 0} />
        <Stat label="Watch list" value={num(spread.watch)}
              foot="Risk 1–49, verify with care" />
        <Stat label="High risk" value={num(spread.high)}
              foot="Risk 50+, held until reviewed" />
      </div>

      <Card
        title="What is checked, and what it costs"
        note="Everything marked free runs with no API key and no provider account"
      >
        <div className="grid grid-2" style={{ gap: 20 }}>
          <div>
            <div className="eyebrow">Free · running now</div>
            <GoldRule width={140} />
            {[
              ['Duplicate identity', 'Phone, NIN, VIN and bank account matched across every record'],
              ['NUBAN check digit', 'The CBN checksum proves an account number is well-formed'],
              ['Account name match', 'Typed account name compared with the registered name'],
              ['Format validation', '11-digit NIN, 19-character VIN, Nigerian mobile'],
              ['GPS boundary', 'Capture position compared with the Kwara State boundary'],
              ['Surname clustering', 'Three or more of one surname at a polling unit'],
              ['Shared bank accounts', 'One account reused across members'],
              ['Bulk-entry pattern', 'More than 15 registrations in ten minutes'],
              ['INEC register match', 'VIN and polling unit matched against a loaded extract'],
              ['Bank reconciliation', 'Real beneficiary names from your bank payment file'],
            ].map(([name, detail]) => (
              <div className="check-row" key={name}>
                <div className="check-icon pass">✓</div>
                <div style={{ flex: 1 }}>
                  <div className="check-label">{name}</div>
                  <div className="check-detail">{detail}</div>
                </div>
              </div>
            ))}
          </div>

          <div>
            <div className="eyebrow">Needs a provider key</div>
            <GoldRule width={140} />
            <div className="check-row">
              <div className="check-icon none">–</div>
              <div style={{ flex: 1 }}>
                <div className="check-label">Bank account → registered name</div>
                <div className="check-detail">
                  Only NIBSS holds this, reachable through a licensed provider.
                  Paystack charges nothing per lookup, but a live key needs a
                  CAC-registered business.
                </div>
              </div>
            </div>
            <div className="check-row">
              <div className="check-icon none">–</div>
              <div style={{ flex: 1 }}>
                <div className="check-label">NIN → NIMC identity</div>
                <div className="check-detail">
                  Through Dojah, Prembly, VerifyMe or Youverify. Charged per lookup.
                </div>
              </div>
            </div>

            <Alert type="info" title="Getting bank names without a key. ">
              When you actually pay people, your bank's payment-confirmation file
              lists the <strong>real beneficiary name</strong> for every account it
              paid. An administrator can use that file to confirm names from the
              bank itself — the same answer a paid API gives, for nothing.
            </Alert>
          </div>
        </div>
      </Card>

      <div className="toolbar" style={{ marginTop: 16 }}>
        <div className="pill-row">
          <button className={'pill' + (flagFilter === '' ? ' active' : '')}
                  onClick={() => setFlagFilter('')}>
            All flagged ({num(rows.length)})
          </button>
          {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([code, n]) => (
            <button key={code} className={'pill' + (flagFilter === code ? ' active' : '')}
                    onClick={() => setFlagFilter(code)}>
              {FLAG_LABEL[code] || code} ({n})
            </button>
          ))}
        </div>
        <div className="spacer" />
        {me.permissions.is_admin && (
          <button className="btn sm" onClick={runBulk} disabled={running}>
            {running && <span className="spinner" />}
            {running ? 'Running checks' : 'Re-run all checks'}
          </button>
        )}
      </div>

      <Card title="Flagged registrations"
            note="Highest risk first. Open a record to see every check and decide."
            bodyClass="">
        {shown.length === 0 ? (
          <Empty title="Nothing flagged" icon="✓">
            Every record in your scope passed all checks.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">Risk</th><th>Member</th><th>Level</th>
                  <th>LGA / Ward</th><th>Issues raised</th><th>Status</th><th>Added</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 200).map((r) => (
                  <tr key={r.id}>
                    <td className="num">
                      <span className={'badge ' + riskTone(r.risk_score)}>{r.risk_score}</span>
                    </td>
                    <td>
                      <Link to={'/members/' + r.id} style={{ fontWeight: 600 }}>
                        {r.first_name} {r.last_name}
                      </Link>
                      <div className="muted mono" style={{ fontSize: 12 }}>{r.code}</div>
                    </td>
                    <td><span className="badge">{LEVEL_LABEL[r.level] || r.level}</span></td>
                    <td>
                      <div>{r.lga}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{r.polling_unit}</div>
                    </td>
                    <td>
                      {r.flags.map((f, i) => (
                        <div key={i} style={{ fontSize: 12, marginBottom: 2 }}>
                          <span className={'badge ' + (f.weight >= 40 ? 'red' : 'amber')}>
                            {FLAG_LABEL[f.code] || f.code}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td><Status value={r.status} /></td>
                    <td className="muted nowrap">{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 200 && (
              <div className="card-body muted">
                Showing the 200 highest-risk records of {num(shown.length)}.
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
