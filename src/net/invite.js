/* Wanderoad — how a second person joins.
 *
 * Multiplayer worked and nobody could find it. Everyone is already in one world and you see
 * whoever is within a few kilometres, so joining a stranger needs no invite at all — but
 * playing WITH someone you know needs two things nobody could have guessed:
 *
 *   1. a second window on the same computer must ask for its own seat, because identity is
 *      one secret in localStorage and every tab of a profile shares it. Without a seat the
 *      second window is the same player, and the server correctly refuses to show you
 *      yourself. That is the whole of the "2 cars in the same place don't see each other"
 *      bug, and its fix was an undocumented URL parameter.
 *   2. a friend on another computer needs the address of the world you are in, which is just
 *      this page's address — the `?seed=` and `?terrain=` you are using ride along with it.
 *
 * So this panel is two links and one sentence each, and it lives in the Garage, which is
 * where the game already says "everything here is also a URL parameter". It is not on the
 * driving screen: a permanent "invite a friend" badge over a quiet road is exactly the kind
 * of nagging this game is meant to be a rest from.
 *
 * Everything is built with createElement and textContent rather than innerHTML, so nothing
 * here can ever interpolate a name or a URL into markup, and so the whole thing can be
 * mounted against a stub document in tools/net-test.mjs.
 */

import { currentSeat } from './identity.js';

/**
 * The address of this exact world, optionally at a different seat.
 * Pure so it can be tested without a DOM.
 *
 * @param {string|number|null} seat  seat to ask for, or null for "no seat" (a fresh machine)
 * @param {string} href              the page to base it on
 */
export function joinUrl(seat, href) {
  const url = new URL(href);
  if (seat === null || seat === undefined || seat === '') url.searchParams.delete('seat');
  else url.searchParams.set('seat', String(seat));
  return url.href;
}

/** The seat a new window on this machine should take: one past whichever one we are. */
export function nextSeat(seat = currentSeat()) {
  const n = parseInt(String(seat || '1'), 10);
  return String((Number.isFinite(n) ? n : 1) + 1);
}

/**
 * Add the "Drive together" block to an open container — the Garage sheet.
 *
 * @param {object} host  element to append to; nothing happens if it is missing
 * @param {object} [env] injectable for tests: { doc, href, seat, open, clipboard }
 * @returns {object|null} the section element
 */
export function mountInvite(host, env = {}) {
  if (!host || typeof host.appendChild !== 'function') return null;
  const doc = env.doc ?? globalThis.document;
  const href = env.href ?? globalThis.location?.href ?? 'http://localhost:5173/';
  // ?? not ||: seat '' is the default player and a perfectly good answer.
  const seat = env.seat ?? currentSeat();
  if (!doc) return null;

  const el = (tag, text, style) => {
    const n = doc.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = text;
    if (style) Object.assign(n.style, style);
    return n;
  };

  const section = el('div');
  section.id = 'invite';
  // Inline, because this module owns its own look and must not depend on a rule in
  // style.css that another change could rename out from under it.
  Object.assign(section.style, { marginTop: '1rem' });

  const h = el('h3', 'Drive together');
  const small = el('small', seat ? `you are seat ${seat}` : 'two windows on one computer are two drivers');
  h.appendChild(small);
  section.appendChild(h);

  const p = el(
    'p',
    'Every window on this computer shares one driver, so a second one would be your own car — ' +
      'and you are never in your own mirror. Give the new window a seat and it becomes someone else.',
    { opacity: '0.72', fontSize: '0.82rem', lineHeight: '1.45', margin: '0.2rem 0 0.5rem' }
  );
  section.appendChild(p);

  const mine = nextSeat(seat);
  const secondUrl = joinUrl(mine, href);
  const friendUrl = joinUrl(null, href);

  section.appendChild(linkRow(doc, el, `Second window here (seat ${mine})`, secondUrl, env));
  section.appendChild(
    linkRow(doc, el, 'Someone on another computer', friendUrl, env, 'their machine has its own driver, so no seat')
  );

  const note = el(
    'p',
    'One world, one map. You will see each other once you are within a few kilometres of the same place.',
    { opacity: '0.6', fontSize: '0.78rem', margin: '0.5rem 0 0' }
  );
  section.appendChild(note);

  host.appendChild(section);
  return section;
}

/* ── one row: what it is, the address, and two ways to take it ─────────────*/

function linkRow(doc, el, label, url, env, hint) {
  const row = el('div', null, { margin: '0.35rem 0' });

  const title = el('div', hint ? `${label} — ${hint}` : label, {
    fontSize: '0.8rem',
    opacity: '0.85',
    marginBottom: '0.2rem',
  });
  row.appendChild(title);

  const line = el('div', null, {
    display: 'flex',
    gap: '0.4rem',
    alignItems: 'center',
    flexWrap: 'wrap',
  });

  /* The address is shown in full and is selectable. On a phone or a LAN address over plain
   * http there is no clipboard API at all (it needs a secure context — and testing on a
   * phone over http is exactly when you want this), so being able to read it and type it is
   * the floor, and the Copy button is the convenience on top. */
  const addr = el('span', url, {
    flex: '1 1 12rem',
    minWidth: '0',
    fontSize: '0.74rem',
    opacity: '0.75',
    wordBreak: 'break-all',
    userSelect: 'all',
  });
  line.appendChild(addr);

  const copy = el('button', 'Copy');
  copy.setAttribute('type', 'button');
  copy.addEventListener?.('click', async () => {
    let ok = false;
    try {
      const clip = env.clipboard ?? globalThis.navigator?.clipboard;
      if (clip?.writeText) {
        await clip.writeText(url);
        ok = true;
      }
    } catch {
      /* insecure context, or the user said no — fall through to selecting it */
    }
    /* SECOND CHANCE BEFORE THE ONE THAT MOVES THE PAGE.
     *
     * Operator: "drive togetheer buttons seem to push u to top of screen and do nothing else".
     *
     * Both halves of that are this line. `navigator.clipboard.writeText` needs a secure context AND
     * a focused document, and it fails silently when it does not have them — so the button fell
     * straight through to SELECTING the address, and selecting text makes the browser scroll the
     * selection into view, which inside the Garage's scrolling sheet is the jump he is describing.
     * Nothing was copied and the view moved: "does nothing" and "pushes you to the top", from one
     * fallback.
     *
     * `execCommand('copy')` on an off-screen textarea is the old way and it still works where the
     * async API will not: no permission prompt, no secure-context requirement, and — because the
     * textarea is fixed at the top-left with an empty size — nothing to scroll to. It is only
     * reached when the modern path has already failed. */
    if (!ok) {
      try {
        const ta = doc.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
        doc.body.appendChild(ta);
        ta.select();
        ok = doc.execCommand?.('copy') === true;
        ta.remove();
      } catch {
        /* no execCommand either — the address is still on screen to read */
      }
    }
    // Only now, having tried both, fall back to the one that moves the view.
    if (!ok) selectText(doc, addr);
    copy.textContent = ok ? 'Copied' : 'Select and copy';
    setTimeout(() => {
      copy.textContent = 'Copy';
    }, 2200);
  });
  line.appendChild(copy);

  const open = el('button', 'Open');
  open.setAttribute('type', 'button');
  open.addEventListener?.('click', () => {
    // Inside a click handler, so this is a user gesture and not a blocked pop-up.
    const opener = env.open ?? globalThis.open;
    try {
      opener?.(url, '_blank', 'noopener');
    } catch {
      /* blocked anyway — the address is right there to copy */
    }
  });
  line.appendChild(open);

  row.appendChild(line);
  return row;
}

/** Put the caret round the address so Ctrl-C works where the clipboard API does not. */
function selectText(doc, node) {
  try {
    const range = doc.createRange();
    range.selectNodeContents(node);
    const sel = globalThis.getSelection?.();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* no selection API — the text is still on screen to read */
  }
}
