import React, { useEffect, useRef } from 'react';

// Adds consistent tools to existing report tables without changing their row links or actions.
export default function DashboardTables({ children }) {
  const root = useRef(null);
  useEffect(() => {
    const attached = new Map();
    const setup = () => {
      for (const [table, controls] of attached) if (!root.current.contains(table)) { controls.remove(); attached.delete(table); }
      root.current.querySelectorAll('table').forEach(table => {
        if (table.dataset.nativeTools) return;
        if (attached.has(table)) { attached.get(table).refreshRows(); return; }
        const controls = document.createElement('div'); controls.className = 'toolbar dashboard-table-tools';
        const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search this table'; search.setAttribute('aria-label', 'Search this table');
        const button = document.createElement('button'); button.className = 'btn secondary sm'; button.textContent = 'Export CSV'; button.type = 'button';
        const count = document.createElement('span'); count.className = 'muted';
        const rows = () => [...table.tBodies].flatMap(body => [...body.rows]);
        const matches = row => row.textContent.toLowerCase().includes(search.value.trim().toLowerCase());
        const filter = () => { const all = rows(); all.forEach(row => { row.hidden = !matches(row); }); const label = `${all.filter(matches).length} loaded rows`; if (count.textContent !== label) count.textContent = label; };
        controls.refreshRows = filter;
        let timer;
        search.oninput = () => { clearTimeout(timer); timer = setTimeout(filter, 150); };
        button.onclick = () => {
          const cell = value => '"' + String(value).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
          const all = [...(table.tHead ? [...table.tHead.rows] : []), ...rows().filter(matches)];
          const csv = '\uFEFF' + all.map(row => [...row.cells].map(td => cell(td.innerText.replace(/\s+/g,' ').trim())).join(',')).join('\r\n');
          const url = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
          const link = document.createElement('a'); link.href = url; link.download = 'kwarax10-report.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        controls.append(search, button, count); table.parentElement.insertBefore(controls, table); attached.set(table, controls); filter();
      });
    };
    const observer = new MutationObserver(setup); observer.observe(root.current, {childList:true, subtree:true}); setup();
    return () => { observer.disconnect(); attached.forEach(controls => controls.remove()); };
  }, []);
  return <div ref={root}>{children}</div>;
}
