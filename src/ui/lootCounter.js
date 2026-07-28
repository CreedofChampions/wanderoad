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
  position:absolute; top:clamp(5.6rem, 13vw, 7.2rem); right:clamp(1rem, 4vw, 3rem);
  width:132px; text-align:right;
  pointer-events:none; opacity:.82;
  font:500 12px/1.3 ui-rounded,-apple-system,Segoe UI,Roboto,sans-serif;
  color:#F6ECD8; text-shadow:0 1px 3px rgba(28,34,48,.55);
}
#lootCounter .row{ display:flex; justify-content:flex-end; gap:.7em; letter-spacing:.02em; font-variant-numeric:tabular-nums; }
#lootCounter .track{ margin-top:.35em; height:4px; border-radius:2px; background:rgba(246,236,216,.22); overflow:hidden; }
#lootCounter .fill{ height:100%; min-width:3px; width:0%; background:#93B84E; border-radius:2px; transition:width .4s ease; }
#lootCounter.unlocked .fill{ background:#E0B14E; }
#lootCounter .cap{ margin-top:.28em; opacity:.7; font-size:10px; letter-spacing:.05em; }
#lootCounter.unlocked .cap{ opacity:.95; }
@media (max-width:640px){ #lootCounter{ top:clamp(6.4rem, 20vw, 8rem); width:104px; font-size:11px; } }
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
    this.coinEl.textContent = '🪙 0'; // resting value — never blank, see hud.js's own note
    this.gemEl = document.createElement('span');
    this.gemEl.textContent = '💎 0';
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
    this.cap.textContent = `boat at ${BOAT_UNLOCK_COINS}`; // resting value — never blank
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
      this.coinEl.textContent = `🪙 ${wallet.coins}`;
    }
    if (wallet.gems !== this._gems) {
      this._gems = wallet.gems;
      this.gemEl.textContent = `💎 ${wallet.gems}`;
    }
    const unlocked = wallet.boatUnlocked;
    const pct = unlocked ? 100 : Math.min(100, (wallet.coins / BOAT_UNLOCK_COINS) * 100);
    this.fill.style.width = `${pct.toFixed(1)}%`;
    if (unlocked !== this._unlocked) {
      this._unlocked = unlocked;
      this.root.classList.toggle('unlocked', unlocked);
      this.cap.textContent = unlocked ? '⛵ boat unlocked' : `boat at ${BOAT_UNLOCK_COINS}`;
    }
  }

  dispose() {
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}
