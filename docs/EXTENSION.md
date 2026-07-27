<!-- created by AI -->
# Wanderoad beside YouTube — the legal position, and what we built because of it

The ask: a Chrome extension so you can drive while watching YouTube. Game on one side, video
on the other, a car button next to Subscribe, resizable, movable left or right.

The instruction attached to it was "check legal". Here is what checking found, and how the
design changed as a result. Read this before touching `extension/`.

---

## What YouTube's Terms of Service actually say

The Permissions and Restrictions section of the YouTube Terms of Service prohibits, in its
own words, agreeing not to:

- "circumvent, disable, fraudulently engage with, or otherwise interfere with any part of the
  Service"
- "alter, modify or otherwise use any part of the Service or any Content except: (a) as
  expressly authorized"
- "use the Service to (a) sell any advertising, sponsorships, or promotions placed on, around,
  or within the Service or Content, other than those allowed in the Advertising on YouTube
  policies"

Three things follow from that, and none of them are ambiguous:

1. **Injecting our UI into YouTube's own page is, on the plain wording, altering the
   Service.** Plenty of well-known extensions do exactly this and are on the Chrome Web
   Store. It is tolerated in practice; it is not permitted in writing. That is a risk taken by
   the person who installs it, and it is not a risk we should take on their behalf by default.
2. **Never touch the player, the ads, or anything around them.** Placing our panel over an ad,
   resizing the player, or selling anything against YouTube's content is the line that turns a
   tolerated extension into a straightforward breach.
3. **Nothing automated.** No scraping, no reading video data, no API calls. The extension has
   no reason to know what you are watching, so it never asks.

## What Chrome Web Store policy adds

- **Single purpose.** The extension does one thing: it shows our game beside your browser. It
  does not also block ads, or change YouTube, or collect anything.
- **No remotely hosted code.** Manifest V3 forbids an extension executing code it fetched at
  runtime. So the game is **bundled inside the extension**, not loaded in an iframe pointing
  at crumbtown.org. That is also better: it works offline and on a plane.
- **Permissions must be the minimum that works, and must be justified.** Ours are `sidePanel`
  and `storage`. Notably NOT `tabs`, NOT `<all_urls>`, NOT `scripting` — the default build
  cannot read a single page you visit.
- **No surprises.** Everything the extension does is visible and switched on by the user.

## The design that came out of it

**Default surface: Chrome's own Side Panel.** It is a browser feature built for exactly this,
it sits beside any page including YouTube, the user drags its edge to resize it, and it
touches nothing on the page. Zero modification of the Service, zero injected DOM, zero host
permissions. Click the toolbar icon, the game opens beside the video. This is the shipping
default and it is the one that is unambiguously fine.

**Optional surface: the in-page dock.** The side panel is right-hand-side only, and the brief
asked for the game on the LEFT and for a button next to Subscribe. That needs the page. So it
exists, it is **off by default**, and turning it on is a deliberate act in the extension's own
options with the position above written next to the switch. When it is on, it:

- inserts exactly one element as a sibling of the page content and sets a margin on `<body>`
- **never** modifies, hides, moves, resizes or overlaps the player, the ads, or any YouTube
  control — the game sits beside the page, not on it
- adds one small car button next to Subscribe whose only job is to open and close our own
  panel
- reads nothing, sends nothing, and removes itself completely when switched off

## Why the game is bundled, not framed

An iframe to crumbtown.org would have been three lines. Bundling is better on every axis that
matters: it satisfies the remote-code rule outright rather than arguing about it, it needs no
host permission, it works with no connection, and the extension cannot silently change under
the user because updates go through the store like everything else.

The multiplayer backend is the one thing that stays remote, and it is opt-in: the bundled
build starts in solo mode.

## If this ever ships to the Chrome Web Store

- Justify `sidePanel` and `storage` in the listing, in one sentence each.
- State plainly that the extension does not read, alter or interact with YouTube content, and
  that the in-page dock is off by default.
- Ship a privacy policy that says the truthful thing: no data is collected, because none is.
- Do not use YouTube's name or logo in the extension's name, icon or promotional images.

---

## Verified against the current build, 27 July 2026

Checked after several rounds of unrelated game changes (junction/road work, the YouTube music
window, gas-station/fuel-can findability, the milestone bar, and the car-becomes-the-feel FLEET
refactor) to confirm the extension itself still works and is still simple to install. Three real
issues found and fixed, all inside `extension/` and `tools/pack-extension.mjs` — nothing in
`src/` needed to change.

1. **`tools/pack-extension.mjs` was zipping the wrong thing.** Its PowerShell `-Path` argument
   was built as a JS template literal ending `${extDir}\*`; inside a template literal `\*` is an
   unrecognized escape and JS silently drops the backslash, collapsing the path to
   `...\extension*` — a glob that matches the `extension` FOLDER itself, not its contents.
   `Compress-Archive` then zipped the whole folder as one nested entry, so `manifest.json` landed
   at `extension\manifest.json` inside the archive instead of at the zip root. The script still
   printed `packed …zip` and exited clean — it never threw, so the bug was invisible unless
   someone opened the archive. A zip shaped that way fails the Chrome Web Store dashboard's
   upload (which requires `manifest.json` at the zip root) and silently mis-installs for anyone
   who unzips it and points "Load unpacked" at the outer folder instead of drilling into
   `extension/`. Fixed by building the glob with `node:path`'s `join()` instead of a template
   literal, which inserts a real separator character rather than one a source-level escape can
   eat. Verified after the fix: `manifest.json` is at the zip's top level alongside
   `background.js`, `dock.js`, `options.html`, `panel.html`, `icons/` and `game/`.
2. **The dock's and panel's default query params had gone stale.** `?feel=cruiser` was how the
   old direct feel-preset system picked the calm driving feel; car and feel merged into one
   choice (`src/game/garage.js`'s FLEET) in a later round, and `src/game/presets.js` now keeps
   `feel=` only so old links resolve to *something* — it is no longer read for physics, only
   `car=` is. The extension's iframe carried no `car=` param, so the calm feel it actually got
   came from an unlabelled coincidence: `carFromUrl()`'s fallback-when-absent is the fleet's
   first entry, which today happens to be `estate` — the same car the old `cruiser` preset
   pointed at. Correct today, but an implicit accident rather than a contract: reordering `FLEET`
   in a future round would silently change what "drive while you watch" defaults to, with
   nothing in `extension/` needing to change for that to happen unnoticed. Both
   `extension/dock.js`'s built iframe and `extension/panel.html`'s (the shipping default surface
   — see above) now say `car=estate` explicitly. `terrain=meadow` and `offline` were re-checked
   against the current `src/main.js` and `src/game/presets.js` and are both still read exactly as
   this document assumes — untouched by the FLEET refactor.
3. **The options page's control list was missing the newest control.** `extension/options.html`
   listed `N` for the radio — correct, and still a live, separate feature
   (`src/audio/engine.js`'s synthesised station-cycling, unrelated to the item below) — but had
   never been updated for the YouTube music window (`J`) that shipped in the round immediately
   before this check. Added.

**Button-injection selector, re-read rather than assumed.** `#subscribe-button` and
`ytd-subscribe-button-renderer` are still the right SHAPE of selector for this — a long-lived id
and a custom-element tag name, generally the two most durable things to key off in a
frequently-restyled single-page app — used as alternatives so one drifting does not take out the
other. That said, this cannot be confirmed by loading youtube.com from this environment, and
YouTube's own front end has been migrating buttons toward newer "view-model" components on a
schedule outside this project's control. `placeButton()` already failed silently before this
pass if neither matched (no exception, no page disruption — the side panel keeps working
regardless), but it had no third attempt beyond those two structural selectors. Added one:
`[aria-label*="subscribe" i]`, a semantic rather than structural signal (accessible names tend to
survive DOM restructuring better than ids or classes), which also matches the already-subscribed
state because "Unsubscribe" contains "subscribe" as a substring. Still silently gives up if that
misses too — never throws, never touches anything YouTube drew.

Everything above this line in this document is still accurate as written: the Side Panel is
still the shipping default and still the unambiguously-fine surface, the in-page dock is still
off by default and still opt-in through `extension/options.html`, and none of this round's game
features change the legal reasoning.

---

## 27 July 2026 — the side panel is now 50/50, with a search box

The operator: *"The browser extention should open the video inside the game in a windows that's
50/50 so the video is inside the game and not the other way around — search bar included."*

That is an inversion, and it lands on **`extension/panel.html`** — the Side Panel, the shipping
default, the one surface where the game is already the entire content and a video is therefore
something the game **hosts**. The in-page dock is the opposite case by construction (there the
game is the guest on YouTube's page) and it is **unchanged**: adding our own video frame and our
own search box *on top of youtube.com's own* would be a second search box competing with theirs,
inside a surface whose whole licence to exist is that it adds one panel and changes nothing.
`extension/dock.js` now carries that reasoning in its header so it does not get "fixed" later.

### The layout, precisely

`#split` is a flex container at `height: 100%` holding two `.half` children, each
`flex: 1 1 0` with `min-height: 0; min-width: 0` — so each is **exactly half the panel**
whatever is inside it (without the `min-*: 0`, an iframe's intrinsic size wins and the split
drifts). The **game half is first**, because the game is the host: it takes the top of a tall
panel and the left of a wide one.

- Default `flex-direction: column` — a Chrome side panel is tall and narrow, so the game is the
  **top half** and the watch pane is the **bottom half**.
- `@media (min-aspect-ratio: 1/1)` flips it to `row` — drag the panel wide enough to be
  landscape and it becomes **game left / video right**, still exactly 50/50, which is the only
  sensible thing to do with a 16:9 video in a wide panel.
- The watch half is itself a column: a fixed-height search bar (`flex: none`) above a stage that
  takes the rest. So the split is 50% game / 50% (search bar + video), not 50% of a leftover.
- One extra control: **fold**. It sets `#split.solo`, which `display: none`s the watch half and
  gives the game the whole panel. Under a class this file owns outright — never the `hidden`
  attribute, for the reason recorded on `#menu[hidden]` in `src/ui/style.css`.

### How the search box works, and why it is not scraping

All of it is `extension/panel.js`, and the whole file is a **URL builder**. It makes no network
request of any kind. It never calls a YouTube API, never holds a key, and never sees a result,
a title, a thumbnail, a duration or a recommendation.

- **A link (or a bare id) → plays in the panel.** The text is matched against a few local
  regexes (`youtu.be/<id>`, `/watch?v=`, `/embed/`, `/shorts/`, `/live/`, `/v/`, a bare 11-char
  id, and `list=` for playlists). String parsing only — nothing is fetched to find out. On a
  match the stage's iframe is pointed at youtube.com's **own public embed endpoint**,
  `https://www.youtube.com/embed/<id>?playsinline=1&autoplay=1&mute=1&rel=0`, reusing the exact
  pattern (and the muted-autoplay reasoning) already established by `src/ui/musicPanel.js`
  inside the game. That is the same thing any website with a video embedded in it does.
- **Words → YouTube's own search page, in a new tab.** `window.open` on
  `https://www.youtube.com/results?search_query=<encoded words>`, `noreferrer`, and then we
  forget about it. Plain navigation. Nothing is read back; the player copies a link and pastes
  it into the box, and it plays in the panel.
- **Why words do not fill the frame.** YouTube serves `/results` and `/watch` with
  `frame-ancestors` set, so they cannot be embedded — only `/embed/` can. The IFrame API's
  `listType=search&list=<query>` would have done it, but it was **deprecated in November 2020**
  and would now render as a broken panel. Reading the results ourselves and drawing our own list
  is precisely the scraping this document rules out. So the honest split is: a link is embedded,
  words are handed to YouTube's own search.
- **Nothing loads until asked.** The stage starts as a paragraph of text; the iframe is created
  on the first successful search. An install whose box is never touched sends **zero** requests
  to youtube.com — the same lazy-load reasoning as the music window in the game.

### Permissions: still none added

`manifest.json` is **untouched**. Permissions remain `sidePanel` and `storage`, with `scripting`
and the youtube.com host permission still *optional* and still only for the opt-in dock.

- Framing `https://www.youtube.com/embed/...` from an extension page needs no permission: MV3's
  default `extension_pages` CSP is `script-src 'self'; object-src 'self'` and sets no
  `frame-src`/`default-src`, so frames are unrestricted.
- `window.open` to an ordinary URL needs no permission either (`tabs` is only needed to *read*
  tab properties, which we never do).
- `panel.js` is a new file because MV3 forbids inline `<script>` on extension pages. It is an ES
  module so its two pure functions (`watchTarget`, `searchUrl`) can be imported and checked from
  node without a browser; the DOM wiring is behind a `typeof document` guard.
- **Still no YouTube name or logo** in the extension's branding. The panel's placeholder says
  "paste a link, or search for something to watch"; the fold button says "hide"/"watch".

### Verified

`npm run build` then `node tools/pack-extension.mjs` packs clean, and the archive was opened and
listed rather than trusted: 26 entries, **`manifest.json`, `panel.html`, `panel.js`, `dock.js`,
`options.html`, `background.js`, `dock.css`, `options.js` all at the zip ROOT**, with `game/` and
`icons/` as the only top-level directories and nothing nested under an `extension/` prefix — i.e.
the `Compress-Archive` glob bug described in item 1 of the previous section has **not** regressed.
The URL builder was exercised from node over ten inputs (watch links, `youtu.be` with a `t=`,
bare ids, shorts, `m.youtube.com`, a watch link carrying a playlist, a playlist URL, and plain
words) and produced the right embed or the right search URL in every case.

What could **not** be verified without a browser, and is the honest gap: that the two halves
measure 50/50 on screen, and that the embed actually renders inside a real side panel. That
needs `npm run test:browser` (real Chrome), which was out of bounds for this pass.
