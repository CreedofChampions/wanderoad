/* Wanderoad — the seed control in the Garage, checked without a browser.
 *
 * The operator's item: "Need to be able to change seed value." `?seed=` already worked; the
 * gap was that nothing in the running game let you set it.
 *
 * The rule this file is written under is gotcha 3 — a flag set is not a thing visible — so it
 * does not assert that a function exists. It stands up a stub DOM, builds the REAL `Menu` from
 * `src/ui/menu.js` (the same class main.js constructs, with the same hooks shape), and then
 * reads back the actual elements that Menu put in the document and the actual query string its
 * own `applySeed()` produced. `location` is a stub object, so the "reload" is captured as a
 * value and asserted on instead of navigating.
 *
 * What it CANNOT prove, stated plainly: that the field is legible on screen. Its size, contrast
 * and position are a screenshot question. What is proved here is that the input element exists
 * in the Garage sheet with the right attributes, that it is pre-filled with the seed the world
 * is actually running, that typing into it and pressing the button produces the exact URL that
 * loads that seed, and that Roll produces a different, in-range, deterministic-looking number.
 *
 *   node tools/diag-seedui.mjs
 *
 * Exits non-zero if any check fails.
 */

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};

/* ── a stub DOM, just enough for a Garage ────────────────────────────────── */

const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.id = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this.children = [];
    this.parentNode = null;
    this._listeners = {};
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (...cs) => cs.forEach((c) => set.delete(c)),
      contains: (c) => set.has(c),
      toggle: (c, on) =>
        on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : on ? set.add(c) : set.delete(c),
      get list() {
        return [...set];
      },
    };
    this._classSet = set;
  }
  get className() {
    return [...this._classSet].join(' ');
  }
  set className(v) {
    this._classSet.clear();
    String(v || '')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this._classSet.add(c));
  }
  setAttribute(k, v) {
    if (k === 'class') this.className = v;
    else if (k === 'id') this.id = v;
    else if (k.startsWith('data-')) {
      this.attrs[k] = v;
      this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    } else if (k === 'style') {
      this.attrs[k] = v;
      for (const decl of String(v).split(';')) {
        const i = decl.indexOf(':');
        if (i > 0) this.style[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
      }
    } else {
      this.attrs[k] = v;
      if (k === 'value') this.value = v;
    }
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  appendChild(n) {
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n, ref) {
    n.parentNode = this;
    const i = this.children.indexOf(ref);
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    return n;
  }
  addEventListener(type, fn) {
    (this._listeners[type] ||= []).push(fn);
  }
  dispatch(type, ev) {
    for (const fn of this._listeners[type] || []) fn(ev);
    if (this.parentNode && !ev?._stopped) this.parentNode.dispatch(type, ev);
  }
  get all() {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  matches(sel) {
    // supports: tag, .class, [attr], [attr="v"], and any concatenation of those
    const parts = sel.match(/^[a-zA-Z][\w-]*|\.[\w-]+|\[[^\]]+\]/g) || [];
    for (const p of parts) {
      if (p.startsWith('.')) {
        if (!this._classSet.has(p.slice(1))) return false;
      } else if (p.startsWith('[')) {
        const m = p.slice(1, -1).match(/^([^=]+?)(?:=["']?([^"']*)["']?)?$/);
        if (!m) return false;
        const have = m[1] === 'id' ? this.id : this.attrs[m[1]];
        if (have === undefined || have === null) return false;
        if (m[2] !== undefined && String(have) !== m[2]) return false;
      } else if (this.tagName !== p.toUpperCase()) return false;
    }
    return parts.length > 0;
  }
  querySelector(sel) {
    return this.all.find((n) => n.matches(sel)) || null;
  }
  querySelectorAll(sel) {
    return this.all.filter((n) => n.matches(sel));
  }
  closest(sel) {
    let n = this;
    while (n) {
      if (n.matches && n.matches(sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
  set innerHTML(html) {
    this.children = [];
    parseInto(this, String(html));
  }
  get innerHTML() {
    return this.children.map((c) => c.tagName).join(',');
  }
}

/** Tiny tag/text parser — enough for the literal markup menu.js writes. */
function parseInto(root, html) {
  const stack = [root];
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    const text = html.slice(last, m.index).trim();
    if (text) stack[stack.length - 1].textContent += text;
    last = re.lastIndex;
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new El(tag);
    const attrRe = /([^\s=]+)\s*=\s*"([^"]*)"|([^\s=]+)(?=\s|$)/g;
    let a;
    while ((a = attrRe.exec(m[2] || ''))) {
      if (a[1] !== undefined) el.setAttribute(a[1], a[2]);
      else el.setAttribute(a[3], '');
    }
    stack[stack.length - 1].appendChild(el);
    if (!VOID_TAGS.has(tag) && !m[0].endsWith('/>')) stack.push(el);
  }
  const tail = html.slice(last).trim();
  if (tail) stack[stack.length - 1].textContent += tail;
}

const body = new El('div');
globalThis.document = { createElement: (t) => new El(t), body };
globalThis.localStorage = {
  _d: {},
  getItem(k) {
    return this._d[k] ?? null;
  },
  setItem(k, v) {
    this._d[k] = String(v);
  },
  removeItem(k) {
    delete this._d[k];
  },
};
const globalKeys = [];
globalThis.addEventListener = (t, fn) => globalKeys.push([t, fn]);
globalThis.location = { search: '', href: 'http://localhost:5173/' };

const { Menu, normaliseSeed, rollSeed, seedSearch, currentSeed } = await import('../src/ui/menu.js');

/* ── 1. the field is really in the Garage ────────────────────────────────── */

globalThis.WANDEROAD = { SEED: 22873996 };
const menu = new Menu({ camera: () => 'chase', bestStreak: () => 0 });
menu.setCurrent({ car: 'coupe', feel: 'road', terrain: 'rolling' });

const field = menu.root.querySelector('[data-seed]');
check('the Garage contains a seed input element', !!field && field.tagName === 'INPUT', field ? field.tagName : 'absent');
check(
  'it is a real text field the player can type into',
  !!field && field.getAttribute('type') === 'text' && field.getAttribute('inputmode') === 'numeric',
  field ? `type=${field.getAttribute('type')} inputmode=${field.getAttribute('inputmode')}` : '',
);
check(
  'it is labelled for a reader who cannot see the heading',
  !!field && !!field.getAttribute('aria-label'),
  field ? `aria-label="${field.getAttribute('aria-label')}"` : '',
);
const roll = menu.root.querySelector('[data-act="seedRoll"]');
const go = menu.root.querySelector('[data-act="seedGo"]');
check('there is a roll button and an apply button', !!roll && !!go, `${roll?.textContent} / ${go?.textContent}`);
check(
  'the heading says it reloads, so the button cannot lie about what it did',
  menu.root.all.some((n) => n.tagName === 'H3' && /seed/i.test(n.textContent)) &&
    menu.root.all.some((n) => n.tagName === 'SMALL' && /reload/i.test(n.textContent)),
  menu.root.all.filter((n) => n.tagName === 'SMALL').map((n) => n.textContent).join(' | ').slice(0, 90),
);
check(
  'nothing else in the Garage was displaced by it',
  !!menu.root.querySelector('[data-group="terrain"]') &&
    !!menu.root.querySelector('[data-group="car"]') &&
    !!menu.root.querySelector('[data-act="close"]'),
);

/* ── 2. it shows the seed the world is ACTUALLY running ──────────────────── */

menu.show();
check(
  'opening the Garage fills the field with the live seed',
  field.value === '22873996',
  `field "${field.value}"  window.WANDEROAD.SEED ${globalThis.WANDEROAD.SEED}`,
);

globalThis.location.search = '?seed=1234567&terrain=dunes';
menu.show();
check(
  'a ?seed= in the URL wins over the default, and is shown',
  field.value === '1234567',
  `field "${field.value}" from ${globalThis.location.search}`,
);
check('currentSeed() agrees', currentSeed() === 1234567, String(currentSeed()));

/* ── 3. typing a seed produces the URL that loads it ─────────────────────── */

globalThis.location.search = '?terrain=dunes&feel=road&car=coupe';
menu.setCurrent({ car: 'wagon', feel: 'rally', terrain: 'alpine' });
field.value = '4242';
const q = menu.applySeed();
const p = new URLSearchParams(q);
check('applying a typed seed navigates', typeof q === 'string' && q.length > 0, q || 'null');
check('the URL carries the seed the player typed', p.get('seed') === '4242', `seed=${p.get('seed')}`);
check(
  'and carries the rest of the configuration so nothing is lost',
  p.get('terrain') === 'alpine' && p.get('feel') === 'rally' && p.get('car') === 'wagon',
  `terrain=${p.get('terrain')} feel=${p.get('feel')} car=${p.get('car')}`,
);
check(
  'the stub location was really assigned — this is a reload, not a no-op',
  globalThis.location.search === q,
  globalThis.location.search,
);
check(
  'main.js would read exactly that seed back',
  // src/main.js: (parseInt(params.get('seed') ?? '', 10) || 22873996) >>> 0
  ((parseInt(new URLSearchParams(globalThis.location.search).get('seed') ?? '', 10) || 22873996) >>> 0) === 4242,
);

/* the button path and the Enter path must agree */
globalThis.location.search = '';
field.value = '777';
const viaButton = menu.applySeed();
globalThis.location.search = '';
field.value = '777';
let stopped = false;
field.dispatch('keydown', { key: 'Enter', stopPropagation: () => (stopped = true) });
check('Enter in the field does what the button does', globalThis.location.search === viaButton, globalThis.location.search);
check('and the keystroke never reaches the game (M would open the Garage)', stopped === true);

/* ── 4. rubbish in the field does not navigate anywhere ──────────────────── */

globalThis.location.search = '?seed=99';
field.value = '   ';
const bad = menu.applySeed();
check(
  'an empty field is refused rather than reloading the same world',
  bad === null && globalThis.location.search === '?seed=99',
  `returned ${bad}, location still ${globalThis.location.search}`,
);
check('and the field is put back to the live seed rather than left blank', field.value === '99', `"${field.value}"`);

check('letters are stripped, not rejected outright', normaliseSeed('abc123def') === 123, String(normaliseSeed('abc123def')));
check('a seed too large for the world wraps into range', (() => {
  const v = normaliseSeed('99999999999999');
  return v !== null && v >= 1 && v <= 4294967295;
})(), String(normaliseSeed('99999999999999')));
check('zero never survives (main.js treats 0 as absent)', normaliseSeed('0') === 1, String(normaliseSeed('0')));
check('nothing usable returns null', normaliseSeed('') === null && normaliseSeed('---') === null);

/* ── 5. roll ─────────────────────────────────────────────────────────────── */

const before = (field.value = '5');
roll.dispatch('click', { target: roll });
const rolled = field.value;
check('Roll writes a new number into the field', rolled !== before && /^\d+$/.test(rolled), `"${before}" -> "${rolled}"`);
check(
  'Roll does not navigate on its own — you still have to press Use',
  globalThis.location.search === '?seed=99',
  globalThis.location.search,
);
const many = Array.from({ length: 500 }, () => rollSeed());
check(
  '500 rolls are all in range and not all the same',
  many.every((v) => v >= 1 && v <= 4294967295) && new Set(many).size > 400,
  `distinct ${new Set(many).size}/500, min ${Math.min(...many)}, max ${Math.max(...many)}`,
);

/* rolling and applying end to end */
globalThis.location.search = '';
roll.dispatch('click', { target: roll });
const rolledSeed = field.value;
go.dispatch('click', { target: go });
check(
  'roll then Use lands on the rolled world',
  new URLSearchParams(globalThis.location.search).get('seed') === rolledSeed,
  `rolled ${rolledSeed} -> ${globalThis.location.search}`,
);

/* ── 6. seedSearch is pure, so nobody has to trust the click path ────────── */

check(
  'seedSearch keeps unrelated parameters (a seat, a shared link)',
  new URLSearchParams(seedSearch(7, {}, '?seat=2&x=1')).get('seat') === '2',
  seedSearch(7, {}, '?seat=2&x=1'),
);
check(
  'seedSearch replaces an existing seed rather than appending a second one',
  (seedSearch(7, {}, '?seed=1').match(/seed=/g) || []).length === 1,
  seedSearch(7, {}, '?seed=1'),
);

console.log(`\n${failed === 0 ? 'all seed-control checks passed' : `${failed} FAILED`}`);
process.exitCode = failed === 0 ? 0 : 1;
