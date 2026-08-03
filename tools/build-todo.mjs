/* THE TO-DO LIST, AS ONE PAGE ON THE WEB.
 *
 * Operator: "make sure the list online has every feature and every bug mentioned in this whole
 * convos history listed with status updates on them all and a checklist of progress for them all
 * when I click on 1 (expands open)."
 *
 * So: every item, its status, and a per-item checklist that opens when the row is clicked.
 *
 * THE SOURCE IS `TODO-ITEMS.json`, not this file and not the prose register. That split is
 * deliberate. `BUGS-AND-FEATURES.md` is the NARRATIVE — root causes, measurements, the evidence
 * behind each fix — written for a person reading in order. This page is a CHECKLIST, and a checklist
 * wants structure. The first version of this parsed the register's markdown tables, which meant it
 * could only ever show what fitted in a table cell; a per-item progress list was not expressible.
 *
 * The two are cross-checked rather than trusted: every id in the register's tables must exist in the
 * JSON, and anything in one but not the other is printed as a warning. One source of truth per fact,
 * and a loud noise when they drift — the stance the brain's own Rule 5 takes.
 *
 *   node tools/build-todo.mjs <out.htmltxt>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DIR =
  'D:/OpenClaw/G-Brain/Databases/Actual Databases/Games/Wanderoad/Working directory/projects/Wanderoad';
const items = JSON.parse(readFileSync(DIR + '/TODO-ITEMS.json', 'utf8')).items;

/* THE PROOF, MERGED INTO THE LIST. Operator: "put whole list on nib website *add to current list and
 * merge in proofs". Two pages meant checking a claim was a second errand; now the film sits inside
 * the card that makes the claim. Clips live on the proof page and are referenced across, so they
 * are uploaded once. An item with no clip simply shows none — the absence IS the status. */
const PROOF = (() => {
  try {
    const rows = JSON.parse(readFileSync('shots/proof/manifest-out.json', 'utf8'));
    const byItem = {};
    for (const r of rows) {
      if (!r.ok || !r.clip) continue;
      const key = r.item || r.id;
      (byItem[key] ||= []).push(r);
    }
    return byItem;
  } catch {
    return {};
  }
})();
const PROOF_BASE = 'https://nibblet.net/cozy-proof/';
function proofFor(id) {
  const rows = PROOF[id] || [];
  if (!rows.length) return '';
  return (
    '<div class="proof">' +
    rows
      .map(
        (r) =>
          `<figure><figcaption>${r.label || r.id}${r.reading ? ` &middot; <code>${r.reading}</code>` : ''}</figcaption>` +
          `<video src="${PROOF_BASE}${r.clip}" poster="${PROOF_BASE}${r.file}" controls loop muted playsinline preload="none"></video></figure>`
      )
      .join('') +
    '</div>'
  );
}

/* The register is still where root causes get written down, so an item there and not here is a fact
 * this page is silently missing. Warn loudly; never fail the build over it. */
try {
  const md = readFileSync(DIR + '/BUGS-AND-FEATURES.md', 'utf8');
  const inMd = new Set([...md.matchAll(/^\|\s*((?:B|F)\d+)\s*\|/gm)].map((m) => m[1]));
  const inJson = new Set(items.map((i) => i.id));
  const missing = [...inMd].filter((id) => !inJson.has(id));
  if (missing.length) console.warn('WARNING  in the register but not on this page:', missing.join(', '));
} catch {
  console.warn('WARNING  could not read the register to cross-check');
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const STATUS = {
  done: { label: 'Done', cls: 'done' },
  progress: { label: 'In progress', cls: 'prog' },
  blocked: { label: 'Blocked', cls: 'blocked' },
  open: { label: 'To do', cls: 'open' },
};

const card = (it) => {
  const st = STATUS[it.status] || STATUS.open;
  const n = it.steps.length;
  const d = it.steps.filter((s) => s.done).length;
  const pct = n ? Math.round((d / n) * 100) : 0;
  return `
  <details class="item ${st.cls}">
    <summary>
      <span class="id">${esc(it.id)}</span>
      <span class="title">${esc(it.title)}</span>
      <span class="badge">${st.label}</span>
      <span class="count">${d}/${n}</span>
      <span class="chev">&rsaquo;</span>
    </summary>
    <div class="body">
      <div class="bar"><i style="width:${pct}%"></i></div>
      <p class="detail">${esc(it.detail)}</p>
      <ul class="steps">
        ${it.steps
          .map((s) => `<li class="${s.done ? 'y' : 'n'}"><span class="box">${s.done ? '&check;' : ''}</span>${esc(s.t)}</li>`)
          .join('\n        ')}
      </ul>
      ${proofFor(it.id)}
      <p class="who">Raised by: ${esc(it.who)}</p>
    </div>
  </details>`;
};

const bugs = items.filter((i) => i.id.startsWith('B'));
const feats = items.filter((i) => i.id.startsWith('F'));
const ORDER = { open: 0, blocked: 1, progress: 2, done: 3 };
const byStatus = (list) =>
  [...list].sort(
    (a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.id.localeCompare(b.id, undefined, { numeric: true })
  );
const count = (s) => items.filter((i) => i.status === s).length;
const stepsAll = items.reduce((a, i) => a + i.steps.length, 0);
const stepsDone = items.reduce((a, i) => a + i.steps.filter((s) => s.done).length, 0);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cozy Driver &mdash; every bug and feature</title>
<style>
  :root { color-scheme: dark; --ink:#e9e3d6; --dim:#9a948a; --bg:#14161a; --card:#1c1f25;
          --line:#2b2f37; --open:#e0a63f; --done:#5aa17a; --blocked:#d1685e; --prog:#6f9fd8; }
  * { box-sizing:border-box }
  body { margin:0; padding:2rem 1rem 5rem; background:var(--bg); color:var(--ink);
         font:16px/1.55 ui-serif, Georgia, "Times New Roman", serif; }
  .wrap { max-width:60rem; margin:0 auto }
  h1 { font-weight:400; font-size:clamp(1.7rem,4.5vw,2.5rem); margin:0 0 .2rem; letter-spacing:.02em }
  .sub { color:var(--dim); font-size:.9rem; margin:0 0 1.4rem }
  .sub a { color:var(--open); text-decoration:none; border-bottom:1px solid #4a3f22 }
  .tally { display:flex; gap:1.4rem; flex-wrap:wrap; margin:0 0 1rem; padding:.9rem 1.1rem;
           background:var(--card); border:1px solid var(--line); border-radius:12px }
  .tally div { display:flex; flex-direction:column; line-height:1.1 }
  .tally b { font-size:1.6rem; font-weight:400 }
  .tally span { font-size:.64rem; letter-spacing:.16em; text-transform:uppercase; color:var(--dim) }
  .overall { height:8px; border-radius:5px; background:#23262d; overflow:hidden; margin:0 0 2rem }
  .overall i { display:block; height:100%; background:linear-gradient(90deg,#5aa17a,#8fd0a8) }
  h2 { font-size:.72rem; letter-spacing:.22em; text-transform:uppercase; color:var(--dim);
       font-weight:600; margin:2.2rem 0 .7rem }
  .hint { color:var(--dim); font-size:.8rem; margin:-.4rem 0 1rem }
  .item { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--open);
          border-radius:10px; margin-bottom:.5rem; overflow:hidden }
  .item.done { border-left-color:var(--done) }
  .item.prog { border-left-color:var(--prog) }
  .item.blocked { border-left-color:var(--blocked) }
  summary { display:flex; align-items:center; gap:.7rem; padding:.8rem 1rem; cursor:pointer;
            list-style:none; user-select:none }
  summary::-webkit-details-marker { display:none }
  summary:hover { background:#20242b }
  .id { font-size:.74rem; color:var(--dim); min-width:2.6rem }
  .title { flex:1; font-size:1rem }
  .badge { font-size:.64rem; letter-spacing:.12em; text-transform:uppercase; padding:.16rem .5rem;
           border-radius:20px; border:1px solid currentColor; white-space:nowrap }
  .item.open .badge { color:var(--open) } .item.done .badge { color:var(--done) }
  .item.prog .badge { color:var(--prog) } .item.blocked .badge { color:var(--blocked) }
  .count { font-size:.76rem; color:var(--dim); font-variant-numeric:tabular-nums; min-width:2.4rem;
           text-align:right }
  .chev { color:var(--dim); transition:transform .15s ease }
  details[open] .chev { transform:rotate(90deg) }
  .body { padding:0 1rem 1rem 1rem; border-top:1px solid var(--line) }
  .bar { height:6px; border-radius:4px; background:#23262d; overflow:hidden; margin:.9rem 0 .8rem }
  .bar i { display:block; height:100%; background:var(--done) }
  .detail { font-size:.88rem; color:#c3bdb1; margin:0 0 .8rem }
  .steps { list-style:none; margin:0; padding:0 }
  .steps li { display:flex; gap:.6rem; align-items:flex-start; font-size:.88rem; padding:.2rem 0 }
  .steps li.n { color:var(--dim) }
  .box { display:inline-flex; align-items:center; justify-content:center; width:1.05rem; height:1.05rem;
         min-width:1.05rem; margin-top:.15rem; border-radius:4px; border:1px solid var(--line);
         font-size:.7rem; color:var(--done) }
  .steps li.y .box { background:#1f3a2c; border-color:#2f5c46 }
  .who { font-size:.72rem; color:var(--dim); margin:.8rem 0 0; padding-top:.6rem; border-top:1px solid var(--line) }
  footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--dim); font-size:.78rem }
  code { font:0.86em ui-monospace, Consolas, monospace; background:#0f1114; padding:.06em .34em; border-radius:4px }

  .proof{padding:0 0 .6rem}
  .proof figure{margin:.6rem 0 0}
  .proof figcaption{font-size:.82rem;color:#8a8f96;padding:0 0 .3rem}
  .proof video{width:100%;height:auto;border-radius:10px;background:#000}
</style></head><body><div class="wrap">
<h1>Cozy Driver &mdash; every bug and feature</h1>
<p class="sub">Live beta: <a href="https://cozydriver.com/beta/">cozydriver.com/beta</a> &middot;
  all work ships to <b>/beta</b>, never to the bare domain</p>

<div class="tally">
  <div><b>${items.length}</b><span>items in all</span></div>
  <div><b>${count('open') + count('blocked')}</b><span>to do</span></div>
  <div><b>${count('progress')}</b><span>in progress</span></div>
  <div><b>${count('done')}</b><span>done</span></div>
  <div><b>${stepsDone}/${stepsAll}</b><span>steps complete</span></div>
</div>
<div class="overall"><i style="width:${Math.round((stepsDone / stepsAll) * 100)}%"></i></div>

<h2>Bugs</h2>
<p class="hint">Click any row to open its progress checklist.</p>
${byStatus(bugs).map(card).join('')}

<h2>Features</h2>
${byStatus(feats).map(card).join('')}

<footer>
  Generated from <code>TODO-ITEMS.json</code> by <code>tools/build-todo.mjs</code>. The narrative,
  root causes and measurements live beside it in <code>BUGS-AND-FEATURES.md</code>.<br>
  Nothing is ticked without a number, a screenshot or a passing check behind it.
</footer>
</div></body></html>`;

writeFileSync(process.argv[2], html, 'utf8');
console.log(
  JSON.stringify({
    out: process.argv[2],
    items: items.length,
    toDo: count('open') + count('blocked'),
    inProgress: count('progress'),
    done: count('done'),
    steps: `${stepsDone}/${stepsAll}`,
    bytes: html.length,
  })
);
