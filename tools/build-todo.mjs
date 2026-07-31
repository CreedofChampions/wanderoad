/* THE TODO LIST, AS ONE PAGE ON THE WEB.
 *
 * Operator: "please add a list of all the things to do (link to it) in the agents > Sniperbot area in
 * the discord". A Discord message cannot hold the register — it is twenty-odd rows with evidence
 * attached — so the message carries a LINK and this builds what it links to.
 *
 * Generated from the brain's own register rather than retyped, because a hand-copied list is out of
 * date the first time anything ships. Parses the two markdown tables in BUGS-AND-FEATURES.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC =
  'D:/OpenClaw/G-Brain/Databases/Actual Databases/Games/Wanderoad/Working directory/projects/Wanderoad/BUGS-AND-FEATURES.md';
const md = readFileSync(SRC, 'utf8');

/** Rows of a markdown table whose id column matches `re`, as objects. */
function rows(re) {
  const out = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4 || !re.test(cells[0])) continue;
    out.push({ id: cells[0], what: cells[1], who: cells[2], state: cells[3], where: cells[4] || '' });
  }
  return out;
}

const bugs = rows(/^B\d+$/);
const feats = rows(/^F\d+$/);
const open = (r) => !/FIXED|SHIPPED|CLOSED/i.test(r.state);
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

const card = (r) => `
  <div class="item ${open(r) ? 'open' : 'done'}">
    <div class="id">${esc(r.id)}</div>
    <div class="body">
      <div class="what">${esc(r.what)}</div>
      <div class="meta"><span class="state">${esc(r.state)}</span> <span class="who">${esc(r.who)}</span></div>
      ${r.where ? `<div class="where">${esc(r.where)}</div>` : ''}
    </div>
  </div>`;

const NEW = [
  ['N1', 'Ford F150 in the game', 'operator, 30 Jul', 'IN PROGRESS', 'a full-size pickup in the fleet'],
  [
    'N2',
    'Walk-in showrooms, separate from petrol stations (walkable mode)',
    'operator, 30 Jul',
    'QUEUED',
    'standalone showroom buildings off the forecourt, and getting out of the car to walk around one',
  ],
].map(([id, what, who, state, where]) => ({ id, what, who, state, where }));

const openBugs = bugs.filter(open);
const openFeats = feats.filter(open);
const doneCount = bugs.filter((r) => !open(r)).length + feats.filter((r) => !open(r)).length;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cozy Driver — everything still to do</title>
<style>
  :root { color-scheme: dark; --ink:#e9e3d6; --dim:#9a948a; --bg:#14161a; --card:#1c1f25; --line:#2b2f37;
          --open:#e0a63f; --done:#5aa17a; }
  * { box-sizing:border-box }
  body { margin:0; padding:2rem 1rem 5rem; background:var(--bg); color:var(--ink);
         font:16px/1.55 ui-serif, Georgia, "Times New Roman", serif; }
  .wrap { max-width:56rem; margin:0 auto }
  h1 { font-weight:400; font-size:clamp(1.7rem,4.5vw,2.5rem); margin:0 0 .2rem; letter-spacing:.02em }
  .sub { color:var(--dim); font-size:.9rem; margin:0 0 1.6rem }
  .sub a { color:var(--open); text-decoration:none; border-bottom:1px solid #4a3f22 }
  .tally { display:flex; gap:1.4rem; flex-wrap:wrap; margin:0 0 2rem; padding:.9rem 1.1rem;
           background:var(--card); border:1px solid var(--line); border-radius:12px }
  .tally div { display:flex; flex-direction:column; line-height:1.1 }
  .tally b { font-size:1.7rem; font-weight:400 }
  .tally span { font-size:.66rem; letter-spacing:.16em; text-transform:uppercase; color:var(--dim) }
  h2 { font-size:.72rem; letter-spacing:.22em; text-transform:uppercase; color:var(--dim);
       font-weight:600; margin:2.2rem 0 .7rem }
  .item { display:flex; gap:.9rem; padding:.85rem 1rem; margin-bottom:.5rem; background:var(--card);
          border:1px solid var(--line); border-left:3px solid var(--open); border-radius:10px }
  .item.done { border-left-color:var(--done); opacity:.62 }
  .id { font-size:.78rem; color:var(--dim); min-width:2.4rem; padding-top:.15rem }
  .what { font-size:1.02rem }
  .meta { font-size:.74rem; color:var(--dim); margin-top:.15rem }
  .state { color:var(--open) }
  .item.done .state { color:var(--done) }
  .where { font-size:.82rem; color:#b8b2a6; margin-top:.4rem; padding-top:.4rem; border-top:1px solid var(--line) }
  code { font:0.86em ui-monospace, Consolas, monospace; background:#0f1114; padding:.06em .34em; border-radius:4px }
  footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line); color:var(--dim); font-size:.78rem }
</style></head><body><div class="wrap">
<h1>Cozy Driver — everything still to do</h1>
<p class="sub">Live beta: <a href="https://cozydriver.com/beta/">cozydriver.com/beta</a> ·
  all work ships to <b>/beta</b>, never to the bare domain · generated from the project register</p>

<div class="tally">
  <div><b>${openBugs.length + openFeats.length + NEW.length}</b><span>still to do</span></div>
  <div><b>${openBugs.length}</b><span>open bugs</span></div>
  <div><b>${openFeats.length + NEW.length}</b><span>open features</span></div>
  <div><b>${doneCount}</b><span>closed with evidence</span></div>
</div>

<h2>Asked for, not built yet</h2>
${NEW.map(card).join('')}

<h2>Open features</h2>
${openFeats.map(card).join('')}

<h2>Open bugs — worst first</h2>
${openBugs.map(card).join('')}

<h2>Closed, with the evidence</h2>
${[...feats, ...bugs].filter((r) => !open(r)).map(card).join('')}

<footer>
  Register: <code>G-Brain / Games / Wanderoad / Working directory / projects / Wanderoad / BUGS-AND-FEATURES.md</code><br>
  Nothing here is marked done without a number, a screenshot or a passing check behind it.
</footer>
</div></body></html>`;

writeFileSync(process.argv[2], html, 'utf8');
console.log(
  JSON.stringify({
    out: process.argv[2],
    openBugs: openBugs.length,
    openFeats: openFeats.length + NEW.length,
    closed: doneCount,
    bytes: html.length,
  })
);
