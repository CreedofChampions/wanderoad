// created by AI
/* Wanderoad — a stub DOM, just enough for a Garage.
 *
 * Lifted verbatim out of tools/diag-seedui.mjs, which wrote it and states the rule it exists to
 * serve: gotcha 3, a flag set is not a thing visible. A diagnostic that asserts a function exists
 * has proved nothing about a panel; standing up enough of a document to build the REAL `Menu` from
 * src/ui/menu.js and then reading back the elements it actually wrote is a different kind of claim.
 *
 * It moved here the moment a SECOND tool needed it (tools/diag-switchers.mjs, for the Water and
 * Driving rows). Two copies of a DOM shim is exactly the sort of duplication that ends with one of
 * them quietly not supporting the selector the panel has started using. There is one, and both
 * tools exercise it, so a gap in it fails somewhere rather than being papered over locally.
 *
 * What it supports, and no more: element creation, appendChild/insertBefore, innerHTML written from
 * a template literal, dataset/attributes, classList, bubbling dispatch, and the selector shapes
 * menu.js actually uses (tag, .class, [attr], [attr="value"], and concatenations of those).
 *
 * What it CANNOT prove, stated plainly: that anything is legible on screen. Size, contrast and
 * position are a screenshot question and are answered by the browser tools, not by this.
 */

export const VOID_TAGS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);

export class El {
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
  /* ── selector matching ───────────────────────────────────────────────────────
   * Three shapes, and the last two were added the day a tool tried to drive the pad.
   *
   * `_matchesSimple` is what this stub always had: tag, .class, [attr], [attr="v"], concatenated.
   *
   * `matches` now also takes COMMA LISTS and DESCENDANT COMBINATORS, because src/ui/menu.js has
   * always used both — `padNav` opens with `querySelectorAll('.sheet .row, .sheet .foot')` and
   * `show()` focuses `'.sheet .row button, .sheet .row .btn'`. Against the old single-element
   * matcher those returned nothing at all, so `padNav` bailed on `if (!rows.length) return` and a
   * tool could conclude the pad "worked" having navigated an empty list. That is precisely the
   * failure this repository names gotcha 3 — a flag set is not a thing visible — dressed up as a
   * passing test, and it is why tools/diag-switchers.mjs section 6 exists.
   *
   * Matching runs right to left, like a real engine: the element itself must satisfy the last
   * simple selector, then each ancestor selector must be satisfied by SOME ancestor, in order. */
  matches(sel) {
    return String(sel)
      .split(',')
      .some((one) => this._matchesDescendant(one.trim()));
  }
  _matchesDescendant(sel) {
    const parts = sel.split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    if (!this._matchesSimple(parts[parts.length - 1])) return false;
    let n = this.parentNode;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (n && !(n._matchesSimple && n._matchesSimple(parts[i]))) n = n.parentNode;
      if (!n) return false;
      n = n.parentNode;
    }
    return true;
  }
  _matchesSimple(sel) {
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
  /* ── the four a GAMEPAD needs, and nothing more ─────────────────────────────
   * Menu.padNav() drives the browser's OWN focus rather than a private index — see its comment,
   * which explains why — so a stub that cannot hold a focus cannot exercise the pad path at all.
   * These four are what it touches: `contains` to find which row the focus is in, `focus` to move
   * it, `scrollIntoView` because it always follows a focus, and `click` because that is how padNav
   * presses a button.
   *
   * `click()` DISPATCHES rather than calling a handler directly, because the panel binds ONE click
   * listener on its root and relies on the event bubbling up to it (`el.addEventListener('click',
   * ...)` in the Menu constructor). A stub that called a handler on the button itself would prove
   * nothing about that arrangement, which is the arrangement the game ships. */
  contains(n) {
    for (let p = n; p; p = p.parentNode) if (p === this) return true;
    return false;
  }
  focus() {
    if (globalThis.document) globalThis.document.activeElement = this;
  }
  scrollIntoView() {}
  click() {
    this.dispatch('click', { target: this });
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
export function parseInto(root, html) {
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

/**
 * Put the stub in place of the globals a browser would have provided.
 *
 * Call this BEFORE importing anything under src/ that reads them at module scope —
 * car/drivingModels.js resolves its stored choice at load, for instance — which is why it is a
 * function you call rather than a side effect of importing this file: the order is then written
 * down at the call site instead of depending on the order of two import statements.
 *
 * @param {{search?: string, href?: string}} [where] the URL the "page" was opened at
 * @returns {{body: El, globalKeys: Array, storage: object}} the document body, the listeners
 *          registered on `globalThis`, and the localStorage stub — which is per-call, so one tool
 *          cannot leave a stored preference behind for the next.
 */
export function installStubDom({ search = '', href = 'http://localhost:5173/' } = {}) {
  const body = new El('div');
  const storage = {
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
  /* `activeElement` starts null exactly as a real document's does, and El.focus() moves it. That is
   * what lets a tool drive Menu.padNav(), which navigates by the document's focus. */
  globalThis.document = { createElement: (t) => new El(t), body, activeElement: null };
  globalThis.localStorage = storage;
  globalThis.addEventListener = (t, fn) => globalKeys.push([t, fn]);
  globalThis.location = { search, href };
  return { body, globalKeys, storage };
}
