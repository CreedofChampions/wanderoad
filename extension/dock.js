/* Wanderoad — the optional in-page dock.
 *
 * This file only ever runs if the user has switched the dock on in options AND granted the
 * youtube.com host permission. See docs/EXTENSION.md for why it is opt-in.
 *
 * The rules it holds itself to, because they are the difference between a panel beside the
 * page and altering the Service:
 *   - it never touches the player, the ads, or any YouTube control
 *   - it never hides, moves, resizes or overlaps anything YouTube drew
 *   - it adds exactly one panel as a sibling of <body>'s content, and one small button
 *   - it reads nothing about the PAGE and sends nothing anywhere. The one exception, added
 *     for the car button: it reads the tab's own URL (never the DOM, never a title, thumbnail
 *     or recommendation) to pick the video id back out of `?v=`, so the button can hand that
 *     id to our own bundled game as a `?video=` param — see currentVideoRequest() below. That
 *     id never leaves this browser; it goes into an iframe pointing at our own
 *     chrome-extension:// resource, nowhere else.
 *   - switching it off removes every trace of it
 *
 * The panel is a resizable flex column pinned to one edge; the page is given a margin equal
 * to its width, so the video simply has less room rather than being covered.
 *
 * NO SEARCH BOX AND NO VIDEO FRAME HERE, deliberately. The 50/50 "the video sits inside the
 * game" layout lives in extension/panel.html — the Side Panel, the shipping default, the one
 * surface where the game is already the whole content and a video half is therefore something
 * the game HOSTS. This file is the opposite case by definition: it only ever runs ON
 * youtube.com, where the video and the search box the player wants are already right there on
 * the page, three centimetres away. Adding our own copy of both inside a dock that is sitting
 * on top of the real ones would be a second search box competing with YouTube's own, in a
 * surface whose entire licence to exist is that it adds one panel and changes nothing. It
 * would also be the only thing in this extension that reads like altering the Service.
 */

const ID = 'wanderoad-dock';
const BTN = 'wanderoad-btn';
const MIN = 280;
const MAX_FRACTION = 0.62;

let state = { open: false, width: 460, side: 'left', video: null };

/* ── what is currently playing, read only from the page's own URL ──────────────────────────
 *
 * The operator's ask: click the car button on a video and the game opens already showing
 * THAT video, large, inside itself (src/ui/musicPanel.js's J-window, handed the id via
 * `?video=` on the exact same game/index.html this dock already loads — see that file's own
 * header for the other half of this hand-off). Getting the id costs nothing extra to read:
 * it is already sitting in `location.href` on every YouTube watch page, the same place a
 * human would copy it from. No DOM is scraped, no title or thumbnail or channel is read —
 * only the URL, which is not "content", it is where the tab already is. */
const VIDEO_ID_RE = /^[\w-]{11}$/;
const LIST_ID_RE = /^[\w-]{10,64}$/;

function currentVideoRequest() {
  let url;
  try {
    url = new URL(location.href);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
  let id = url.searchParams.get('v');
  // youtube.com/shorts/<id> and /live/<id> carry the id in the path, not `?v=`.
  if (!id) {
    const m = /\/(?:shorts|live)\/([\w-]{11})/.exec(url.pathname);
    if (m) id = m[1];
  }
  if (!id || !VIDEO_ID_RE.test(id)) return null;
  const listRaw = url.searchParams.get('list');
  const list = listRaw && LIST_ID_RE.test(listRaw) ? listRaw : null;
  const indexRaw = url.searchParams.get('index');
  const index = list && indexRaw && /^\d{1,4}$/.test(indexRaw) ? indexRaw : null;
  return { id, list, index };
}

/** Same three defaults every dock load has always carried, plus `video=`/`list=`/`index=`
 *  when the car button has captured one for this session. Built with URLSearchParams rather
 *  than string-glued, so a video id can never accidentally break the query string. */
function frameSrc() {
  const p = new URLSearchParams();
  p.set('offline', '');
  p.set('car', 'estate');
  p.set('terrain', 'meadow');
  if (state.video) {
    p.set('video', state.video.id);
    if (state.video.list) p.set('list', state.video.list);
    if (state.video.index) p.set('index', state.video.index);
  }
  return `${chrome.runtime.getURL('game/index.html')}?${p.toString()}`;
}

/* ── the panel ───────────────────────────────────────────────────────────── */

function build() {
  if (document.getElementById(ID)) return document.getElementById(ID);

  const dock = document.createElement('aside');
  dock.id = ID;
  dock.dataset.side = state.side;
  /* `car=estate`, not the old `feel=cruiser`: the car and its feel merged into one choice
   * (src/game/garage.js FLEET) after this dock was first wired up, and `?feel=` is now kept
   * only so old links still resolve to something — it no longer selects the driving physics,
   * only a car does. `estate` is the calm, forgiving starter car FEELS.cruiser used to point
   * at, named explicitly so this stays correct even if the fleet is ever reordered (an absent
   * `car=` falls back to the fleet's first entry, which is `estate` today but is not a
   * contract). `terrain=meadow` is untouched by that change and still the right calm land. */
  dock.innerHTML = `
    <div class="wr-bar">
      <span class="wr-title">Cozy Driver</span>
      <button class="wr-flip" title="Move to the other side">&#8646;</button>
      <button class="wr-close" title="Close">&#215;</button>
    </div>
    <iframe class="wr-frame" title="Cozy Driver"
            src="${frameSrc()}"
            allow="gamepad *; autoplay"></iframe>
    <div class="wr-grip" title="Drag to resize"></div>`;
  document.body.appendChild(dock);

  dock.querySelector('.wr-close').addEventListener('click', () => setOpen(false));
  dock.querySelector('.wr-flip').addEventListener('click', () => {
    state.side = state.side === 'left' ? 'right' : 'left';
    chrome.storage.sync.set({ side: state.side });
    apply();
  });
  wireResize(dock);
  return dock;
}

/* Dragging the grip resizes the panel. The iframe swallows pointer events while a drag is in
 * progress, otherwise the game captures the pointer and the drag dies on the first pixel. */
function wireResize(dock) {
  const grip = dock.querySelector('.wr-grip');
  const frame = dock.querySelector('.wr-frame');
  let dragging = false;

  const move = (e) => {
    if (!dragging) return;
    const raw = state.side === 'left' ? e.clientX : innerWidth - e.clientX;
    state.width = Math.max(MIN, Math.min(raw, innerWidth * MAX_FRACTION));
    apply();
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    frame.style.pointerEvents = '';
    document.body.classList.remove('wr-dragging');
    chrome.storage.sync.set({ width: Math.round(state.width) });
  };

  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    frame.style.pointerEvents = 'none';
    document.body.classList.add('wr-dragging');
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
  addEventListener('resize', () => {
    if (state.open) apply();
  });
}

/** Push the page over rather than covering it. One margin, nothing else touched. */
function apply() {
  const dock = document.getElementById(ID);
  if (!dock) return;
  dock.dataset.side = state.side;
  dock.style.width = `${state.width}px`;
  dock.hidden = !state.open;
  const px = state.open ? `${state.width}px` : '';
  document.documentElement.style.setProperty('--wr-pad', px || '0px');
  document.body.style.marginLeft = state.open && state.side === 'left' ? px : '';
  document.body.style.marginRight = state.open && state.side === 'right' ? px : '';
  const btn = document.getElementById(BTN);
  if (btn) btn.classList.toggle('wr-on', state.open);
}

/** Point the already-built game iframe at a different video. Only ever called with a request
 *  that actually changed (see the click handler), so this never restarts a video that is
 *  already playing just because the button was clicked again. If the dock has not been built
 *  yet, `state.video` alone is enough — `build()` reads it via `frameSrc()` when it runs. */
function loadVideo(req) {
  state.video = req;
  const frame = document.querySelector(`#${ID} .wr-frame`);
  if (frame) frame.src = frameSrc();
}

function setOpen(v) {
  state.open = v;
  if (v) build();
  apply();
  chrome.storage.sync.set({ open: v });
}

/* ── the button next to Subscribe ────────────────────────────────────────────
 * Appended as the last child of the row that holds Subscribe, never inserted between
 * YouTube's own controls and never replacing one. If the row is not found — a layout change,
 * a different page type — nothing happens and the side panel still works. */
function placeButton() {
  if (document.getElementById(BTN)) return;
  const anchor =
    document.querySelector('#subscribe-button') ||
    document.querySelector('ytd-subscribe-button-renderer') ||
    // Third tier: if YouTube ever restructures the id and the custom element away, the
    // accessible name has stayed "…Subscribe…" (and "Unsubscribe" still contains that
    // substring, so this matches in either subscription state) across every redesign this
    // has been checked against. A different signal — semantic, not structural — so a
    // redesign that breaks the two above does not also break this one. English UI only; a
    // missed match here still just means the button does not appear, same as any other miss.
    document.querySelector('[aria-label*="subscribe" i]') ||
    null;
  const row = anchor ? anchor.parentElement : null;
  if (!row) return;

  const btn = document.createElement('button');
  btn.id = BTN;
  btn.type = 'button';
  btn.title = 'Cozy Driver — drive while you watch';
  btn.setAttribute('aria-label', 'Open Cozy Driver');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<path fill="currentColor" d="M5 15.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0m11 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0"/>' +
    '<path fill="currentColor" d="M3.4 14.2 4.6 9.9A2.5 2.5 0 0 1 7 8h10a2.5 2.5 0 0 1 2.4 1.9l1.2 4.3a1 1 0 0 1-1 1.3h-.8a2.9 2.9 0 0 0-5.6 0H8.8a2.9 2.9 0 0 0-5.6 0h-.8a1 1 0 0 1-1-1.3Zm2.3-.7h12.6l-.9-3.1a.9.9 0 0 0-.8-.6H7.4a.9.9 0 0 0-.8.6Z"/>' +
    '</svg><span>Drive</span>';
  /* One click: capture whatever video the row it just came from belongs to, and open the
   * game already showing it — "reload the same video ... inside a large, expandable window"
   * is the operator's ask, verbatim. A second click on the SAME video closes the panel again
   * (the plain open/close toggle this button always had); a click while a DIFFERENT video is
   * on screen — YouTube is a single-page app, so this can happen without a page load in
   * between — swaps the game's video without the player needing to close and reopen. */
  btn.addEventListener('click', () => {
    const req = currentVideoRequest();
    const changed = req && (!state.video || req.id !== state.video.id);
    if (state.open && !changed) {
      setOpen(false);
      return;
    }
    if (changed) loadVideo(req);
    setOpen(true);
  });
  row.appendChild(btn);
}

/* YouTube is a single-page app, so the Subscribe row is rebuilt on every navigation. Watch
 * for it rather than polling, and only ever ADD — never remove or reorder what is there. */
const observer = new MutationObserver(() => placeButton());

async function boot() {
  const s = await chrome.storage.sync.get({ open: false, width: 460, side: 'left' });
  // `video` is never read from storage — which video the button last captured is a fact about
  // the PAGE this content script is running on, not a setting to carry across tabs or restore
  // on the next visit, so every fresh load starts with none captured, same as before this
  // feature existed.
  state = { open: s.open, width: s.width, side: s.side, video: null };
  placeButton();
  observer.observe(document.body, { childList: true, subtree: true });
  if (state.open) {
    build();
    apply();
  }
}

/** Remove every trace of ourselves — called when the user switches the dock off. */
function teardown() {
  observer.disconnect();
  document.getElementById(ID)?.remove();
  document.getElementById(BTN)?.remove();
  document.body.style.marginLeft = '';
  document.body.style.marginRight = '';
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.dock && changes.dock.newValue === false) teardown();
  if (changes.side) {
    state.side = changes.side.newValue;
    apply();
  }
});

boot();
