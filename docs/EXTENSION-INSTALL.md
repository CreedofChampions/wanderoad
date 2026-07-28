<!-- created by AI -->
# Installing Cozy Driver in Chrome — about 2 minutes

This is a local, unpacked extension — nothing to upload, nothing to publish, no account. Chrome
loads it straight off your disk. Every step below was run against this exact repo before being
written down; the file names and menu labels are copied from what is actually there, not from
memory.

## 1. Build the game and pack the extension

From the repo root (`D:\Github-Projects\wanderoad`), in a terminal:

```
npm run build
node tools/pack-extension.mjs
```

`npm run build` compiles the game into `dist/`. `node tools/pack-extension.mjs` copies that
build into `extension/game/` — this is the step that makes `extension/` a complete, working
folder Chrome can load; skipping it leaves `extension/game/` empty or stale. It also writes a
zip (`wanderoad-extension-0.1.0.zip`) for safekeeping, but the zip is **not** what you load —
see step 2.

## 2. Load it in Chrome

1. Open `chrome://extensions` (type or paste that into the address bar).
2. Turn on **Developer mode** — the toggle is in the top-right corner of that page.
3. Click **Load unpacked**.
4. Select the `extension` folder itself — `D:\Github-Projects\wanderoad\extension` — not the
   zip, not the repo root, not `extension/game`. Chrome reads `extension/manifest.json` from
   whichever folder you pick, and that file only exists at the top of `extension/`.
5. "Cozy Driver — drive while you watch" appears in your extensions list and its icon in the
   toolbar (click the puzzle-piece icon and pin it if you don't see it).

That's the whole install. It re-loads from disk every time Chrome starts, so if you rebuild the
game later, re-run step 1 and click the refresh icon on the extension's card in
`chrome://extensions` — no re-installing.

## 3. Open the game beside a video

Click the toolbar icon (or press **Alt+D**). Chrome's own Side Panel opens next to whatever
page you're on — the game is the top/left half, and the bottom/right half is yours to watch in:
paste a video link (or a playlist link) into the search box and it plays right there, split
50/50 with the road. This half works on any page, not just YouTube, and needs no extra
permission — it's the default, always-on surface.

## 4. The car button next to Subscribe (what you actually asked for)

This is a second, optional surface — the in-page dock — because it's the only way to get the
game onto the **left** side of a YouTube page and a button sitting **in** that page next to
Subscribe. It's off until you turn it on, on purpose (see `docs/EXTENSION.md` for why: adding
anything to a YouTube page needs the page's permission, so Chrome asks for it explicitly rather
than the extension grabbing it silently at install time).

1. Right-click the toolbar icon → **Options** (or open `chrome://extensions`, find Cozy Driver,
   click **Details**, then **Extension options**).
2. Tick **"Dock the game inside YouTube pages."** Chrome will ask you to allow the extension to
   run on `youtube.com` — allow it. Without this, the button never appears.
3. Go to any YouTube video. Next to the **Subscribe** button, a small teal **car** button
   appears, labelled "Drive."
4. Click it. The game opens in a panel down the left of the page (drag its edge to resize, or
   flip it to the right from the options page), and it opens **already showing that same
   video** — large, inside the game itself, in a window you can drag by its bottom-right corner
   to make bigger or smaller. No searching, no pasting a link: the button reads the video id
   straight off the page you're already on.
5. Click a **different** video's page and press the car button again — the game swaps to that
   video without you closing and reopening anything. Click the button again on the *same* video
   and the panel just closes, same as before.

Nothing you watch is read, logged or sent anywhere by any of this — the button only ever reads
the video id out of the page's own URL (the same 11 characters you'd copy out of the address
bar yourself) and hands it to the bundled game running on your own machine.

## Controls, once the game is on screen

`W`/`S` throttle and brake · `A`/`D` steer · `Space` handbrake · `Shift` fine control · `R` back
to the road · `C` camera · `V` next car · `N` radio · `J` the music window (this is what the car
button opens automatically with your video loaded) · `Esc` garage. A gamepad works too.

## If something doesn't match this

- **No car button next to Subscribe** — check step 4.2 was actually completed (the toggle in
  Options, and the youtube.com permission prompt was allowed, not dismissed). YouTube also
  changes its own page layout from time to time; if the button still doesn't show up after
  that, the side panel (step 3) still works regardless — it needs no permission and nothing
  about it depends on YouTube's page structure.
- **`extension/` looks empty or the game half is blank** — step 1 wasn't run, or was run before
  the latest code change. Re-run `npm run build && node tools/pack-extension.mjs` and reload
  the extension's card in `chrome://extensions`.
