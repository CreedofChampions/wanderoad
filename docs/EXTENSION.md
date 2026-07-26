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
