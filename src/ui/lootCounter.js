/* Wanderoad — the loot counter: coins, gems, and progress toward the boat.
 *
 * src/ui/fuelGauge.js's own pattern, exactly: its own `<style>` block appended once, a root
 * div appended to `hud.root`, and an update(dt, wallet) that only touches the DOM nodes whose
 * text actually changed this frame.
 *
 * PLACEMENT. Every other corner of the HUD is already claimed — see musicPanel.js's own
 * comment for the full map: speedo bottom-right, place bottom-left, streak bottom-centre,
 * players top-right, toast/openMenu top-centre, unlock bar the full bottom edge, musicPanel
 * top-left, fuel gauge stacked above the speedo. #players is the only thing already living in
 * the top-right, and it is a short, resting one-or-two-line block (see hud.js), so this docks
 * BELOW it with enough clearance for a small crowd of nearby drivers, rather than invent a
 * corner that does not exist at 1280x800.
 */

import { BOAT_UNLOCK_COINS } from '../game/wallet.js';

const CSS = `
#lootCounter{
  position:absolute; top:clamp(7.4rem, 16vw, 9.4rem); right:clamp(1rem, 4vw, 3rem);
  width:132px; text-align:right;
  pointer-events:none; opacity:.82;
  font:500 12px/1.3 ui-rounded,-apple-system,Segoe UI,Roboto,sans-serif;
  color:#F6ECD8; text-shadow:0 1px 3px rgba(28,34,48,.55);
}
#lootCounter .row{ display:flex; justify-content:flex-end; gap:.7em; letter-spacing:.02em; font-variant-numeric:tabular-nums; }
/* ONE CURRENCY AT A TIME. Operator: "rather than showing people 9 coins, 0 gems, we should
 * just not show people gems until they've unlocked the boat. Then we should switch it from
 * coins to gems ... only the relevant information to them that they need to know."
 *
 * Exactly right, and "gems 0" was worse than useless before the boat: gems only exist out on
 * open water, so a zero next to your coins is a counter for a thing you cannot yet reach and
 * have not been told about. Coins are the whole game until the boat; gems are the whole game
 * after it. So the row holds one of them, and the swap IS the reward moment. */
#lootCounter .gem{ display:none; }
#lootCounter.unlocked .coin{ display:none; }
#lootCounter.unlocked .gem{ display:inline; }
#lootCounter .gemIcon{ display:inline-block; width:.78em; height:.78em; margin-right:.1em;
  background:linear-gradient(145deg, #7FD4E8, #2E7FA8); vertical-align:middle;
  clip-path:polygon(50% 0%, 100% 38%, 50% 100%, 0% 38%); }
/* The 🪙 glyph renders as tofu on Windows (playtest report) — a small painted disc in CSS
 * reads the same everywhere. NO EMOJI: the operator's Windows 10 renders none of these
 * glyphs in this font stack, so they showed as nothing at all. Plain words instead;
 * they were reported rendering fine. */
#lootCounter .coinIcon{ display:inline-block; width:.9em; height:.9em; border-radius:50%;
  background:radial-gradient(circle at 34% 30%, #E0B14E, #8A6B2A); vertical-align:middle; }
#lootCounter .track{ margin-top:.35em; height:4px; border-radius:2px; background:rgba(246,236,216,.22); overflow:hidden; }
#lootCounter .fill{ height:100%; min-width:3px; width:0%; background:#93B84E; border-radius:2px; transition:width .4s ease; }
#lootCounter.unlocked .fill{ background:#E0B14E; }
#lootCounter .cap{ margin-top:.28em; opacity:.7; font-size:10px; letter-spacing:.05em; }
#lootCounter.unlocked .cap{ opacity:.95; }
@media (max-width:640px){ #lootCounter{ top:clamp(8.2rem, 24vw, 10rem); width:104px; font-size:11px; } }
`;

export class LootCounter {
  /** @param {HTMLElement} root the #hud element — same constructor shape as FuelGauge. */
  constructor(root) {
    if (!document.getElementById('lootCounterCss')) {
      const st = document.createElement('style');
      st.id = 'lootCounterCss';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    this.root = document.createElement('div');
    this.root.id = 'lootCounter';

    const row = document.createElement('div');
    row.className = 'row';
    this.coinEl = document.createElement('span');
    // The coin glyph is a CSS disc, not text — see the .coinIcon rule above — so this is
    // innerHTML, not textContent; resting value 0, never blank, see hud.js's own note.
    this.coinEl.className = 'coin';
    this.coinEl.innerHTML = '<span class="coinIcon"></span> 0';
    this.gemEl = document.createElement('span');
    this.gemEl.className = 'gem';
    // A drawn diamond, for the same reason the coin is a drawn disc: the operator's Windows
    // renders no emoji at all in this font stack (see the .coinIcon note above).
    this.gemEl.innerHTML = '<span class="gemIcon"></span> 0';
    row.appendChild(this.coinEl);
    row.appendChild(this.gemEl);
    this.root.appendChild(row);

    const track = document.createElement('div');
    track.className = 'track';
    this.fill = document.createElement('div');
    this.fill.className = 'fill';
    track.appendChild(this.fill);
    this.root.appendChild(track);

    this.cap = document.createElement('div');
    this.cap.className = 'cap';
    // Resting value — never blank. Says what the coins are FOR, which is the only reason to
    // show a coin count to someone who has never seen a boat.
    this.cap.textContent = `${BOAT_UNLOCK_COINS} coins buys a boat`;
    this.root.appendChild(this.cap);

    this._coins = -1;
    this._gems = -1;
    this._unlocked = null;
    root.appendChild(this.root);
  }

  /**
   * @param {number} dt seconds — unused (nothing here needs smoothing: a coin count is an
   *        integer, not a needle), kept for the same call signature fuelGauge.update(dt, ...)
   *        uses so every HUD widget in the frame loop is called the same way.
   * @param {import('../game/wallet.js').Wallet} wallet
   */
  update(dt, wallet) {
    if (wallet.coins !== this._coins) {
      this._coins = wallet.coins;
      this.coinEl.innerHTML = `<span class="coinIcon"></span> ${wallet.coins}`;
    }
    if (wallet.gems !== this._gems) {
      this._gems = wallet.gems;
      this.gemEl.innerHTML = `<span class="gemIcon"></span> ${wallet.gems}`;
    }
    const unlocked = wallet.boatUnlocked;
    const pct = unlocked ? 100 : Math.min(100, (wallet.coins / BOAT_UNLOCK_COINS) * 100);
    this.fill.style.width = `${pct.toFixed(1)}%`;
    if (unlocked !== this._unlocked) {
      this._unlocked = unlocked;
      this.root.classList.toggle('unlocked', unlocked);
      /* The caption swaps with the currency. Before the boat it says what coins buy; after it,
       * what gems are — because the moment the row changes is the only moment anyone will read
       * it, and "boat unlocked" is a thing they just watched happen. */
      this.cap.textContent = unlocked ? 'gems are out at sea' : `${BOAT_UNLOCK_COINS} coins buys a boat`;
    }
  }

  dispose() {
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}
