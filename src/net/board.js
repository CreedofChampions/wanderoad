/* Cozy Driver — the leaderboard client.
 *
 * One question, asked rarely: who has driven furthest without leaving the road, in this world?
 *
 * Submit and fetch are the SAME request, exactly like the drive tick — the body carries your
 * best, the response carries the top of the table. That is not a shortcut, it is what lets the
 * client be stateless about it: it never has to know whether the server already has a better
 * number, because the server refuses anything lower than what it holds. So this file can submit
 * whenever it likes and the board can only ever move up.
 *
 * Polled slowly on purpose. A leaderboard is not gameplay, and a cozy driving game should not be
 * spending its network budget on a table nobody is staring at. Sixty seconds, and only when the
 * panel is actually open or the player has just beaten their own record.
 */

const POLL_MS = 60000;

export class Board {
  /**
   * @param {object} o
   * @param {object} o.transport  the same transport the drive tick uses — needs .send(body)
   * @param {number} o.seed       which world this board belongs to
   * @param {Function} o.identity () => ({ name })  read lazily so a rename is picked up
   */
  constructor({ transport, seed, identity }) {
    this.transport = transport;
    this.seed = seed >>> 0;
    this.identity = identity;
    /** @type {Array<{rank:number,name:string,best:number,you:boolean}>} */
    this.rows = [];
    this.updated = 0;
    this._inFlight = false;
    this._lastSubmitted = 0;
  }

  /** The player's own row, if they are on the board at all. */
  get mine() {
    return this.rows.find((r) => r.you) ?? null;
  }

  /**
   * Ask the server, optionally submitting a new best.
   *
   * `force` skips the poll interval — used when the player has just beaten their own record,
   * because that is the one moment they actually want to see the table move.
   */
  async refresh(best = 0, force = false) {
    if (this._inFlight) return this.rows;
    const now = Date.now();
    if (!force && now - this.updated < POLL_MS) return this.rows;

    const claim = Math.max(0, Math.floor(best));
    this._inFlight = true;
    try {
      const res = await this.transport.send({
        op: 'board',
        seed: this.seed,
        best: claim,
        name: this.identity?.()?.name ?? '',
      });
      if (res && Array.isArray(res.board)) {
        this.rows = res.board;
        this.updated = now;
        if (claim > this._lastSubmitted) this._lastSubmitted = claim;
      }
    } catch {
      /* Offline, or the backend is having a moment. The board is decoration — the game does not
       * stop for it, and the next poll will pick it up. */
    } finally {
      this._inFlight = false;
    }
    return this.rows;
  }

  /**
   * Called when a streak ends. Submits only if it beats what we last sent, so a run that ends
   * short costs nothing.
   */
  submitIfBetter(best) {
    const b = Math.max(0, Math.floor(best));
    if (b <= this._lastSubmitted) return false;
    this.refresh(b, true);
    return true;
  }
}

/** Metres to something a person reads at a glance. Matches the HUD's own idiom. */
export function fmtBoard(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
