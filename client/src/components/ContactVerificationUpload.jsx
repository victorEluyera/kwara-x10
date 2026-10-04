import React, {useState} from 'react';
import {Modal, Alert} from './ui.jsx';
import {api,downloadCsv,num} from '../lib/api.js';
export default function ContactVerificationUpload({filters,onClose,onSaved}) {
  const [file,setFile]=useState(null),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const upload=async commit=>{
    setBusy(true);setError('');
    try{
      const body=new FormData();body.append('file',file);body.append('commit',commit?'1':'0');
      const result=await api.form('/members/contact-verification-upload',body);
      if(commit){await onSaved(result);onClose();}else setPreview(result);
    }catch(error){setError(error.message);}finally{setBusy(false);}
  };
  return <Modal title="Upload contact centre verification" onClose={()=>{if(!busy)onClose();}}>
    {error&&<Alert type="error">{error}</Alert>}
    <p>Keep the member <strong>id</strong> or <strong>code</strong> in the returned CSV/XLSX. Add or fill <strong>contact_verification_status</strong> with one of: verified, unreachable, incorrect_details, declined, pending.</p>
    <p>Update the exported member columns to correct their details: name, phone, VIN, NIN, bank, account name, account number, LGA, ward and polling unit. You can also add <strong>corrected_account_number</strong>, <strong>corrected_lga</strong>, <strong>corrected_ward</strong> or <strong>corrected_polling_unit</strong> columns; these take priority. Blank corrections leave existing details unchanged.</p>
    <p>Keep account numbers as <strong>Text</strong> in Excel to preserve all 10 digits. Polling units must match a real unit in the selected ward. Changed VINs or locations will need a fresh voter-register check.</p>
    <p>Optional call details: <strong>contact_verification_notes</strong>, <strong>contact_verified_by</strong> (caller name), <strong>contact_verified_at</strong> (for example 2026-10-03T10:30:00+01:00).</p>
    <button className="btn secondary sm" disabled={busy} onClick={async()=>{try{await downloadCsv('/export/members.csv?'+new URLSearchParams(Object.entries(filters).filter(([,value])=>value)),'contact-centre-members.csv');}catch(error){setError(error.message);}}}>Download member file with call-result columns</button>
    <p><input type="file" accept=".csv,.xlsx" disabled={busy} onChange={event=>{setFile(event.target.files?.[0]||null);setPreview(null);setError('');}}/></p>
    {preview&&<>
      <p><strong>{num(preview.ready)} ready</strong> of {num(preview.total)} rows. {num(preview.corrected)} members with detail corrections. {num(preview.errors.length)} issues. Preview shows the first 100 rows.</p>
      {preview.errors.length>0&&<Alert type="error">Fix the listed rows and upload again. No results have been saved.</Alert>}
      <div className="table-wrap" style={{maxHeight:300,overflow:'auto'}}><table><thead><tr><th>File row</th><th>Code / ID</th><th>Name</th><th>Call result</th><th>Detail changes</th><th>Notes / issue</th></tr></thead><tbody>
        {(preview.errors.length?preview.errors:preview.preview).map(row=><tr key={row.row}><td>{row.row}</td><td>{row.code||row.id}</td><td>{row.name||'--'}</td><td>{row.status}</td><td>{row.changes?.length?row.changes.map(change=><div key={change.field}><strong>{change.field.replaceAll('_',' ')}</strong>: {change.before||'--'} → {change.after}</div>):'No detail changes'}</td><td>{row.error||row.notes||'--'}</td></tr>)}
      </tbody></table></div>
    </>}
    <div className="btn-row" style={{marginTop:16}}>
      <button className="btn secondary" disabled={!file||busy} onClick={()=>upload(false)}>{busy?'Processing...':'Preview file'}</button>
      {preview&&<button className="btn" disabled={busy||preview.errors.length>0||!preview.ready} onClick={()=>upload(true)}>Save {num(preview.ready)} call results</button>}
      <button className="btn secondary" disabled={busy} onClick={onClose}>Cancel</button>
    </div>
  </Modal>;
}
