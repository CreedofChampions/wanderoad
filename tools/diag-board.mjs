/* Wanderoad — the 'board' op, proven without PHP.
 *
 * server/drive.php cannot be executed on this machine — there is no PHP interpreter here at
 * all (see tools/net-devapi.mjs's header for the same constraint on the position filter, and
 * docs/BACKEND.md's own "written to spec, never deployed" line for the Base44 side of the same
 * problem). So this tool follows that file's exact pattern rather than inventing a new one:
 *
 *   1. a small, self-contained JS mirror of ONLY the 'board' op's semantics — submit-and-fetch,
 *      the monotonic upsert, the seed filter, the claim bounds — run through real scenarios
 *      with real PASS/FAIL assertions;
 *   2. a set of checks that read server/drive.php's and base44/functions/drive/index.js's own
 *      text, to prove the PRODUCTION files actually carry the shape the mirror assumes, since a
 *      mirror that has quietly drifted from what ships is worse than no mirror at all.
 *
 * The mirror below is NOT server/devApi.mjs (this repo's other JS mirror, wired into the Vite
 * dev server for two-tab local multiplayer testing) and does not touch it — devApi.mjs is a
 * whole-protocol dev-server stand-in shared with that harness, and teaching it to answer
 * 'board' too is a separate piece of work for whoever wires this tool into `npm run dev` /
 * `npm test`. This file's mirror exists only to give the checks below something real to run.
 *
 * WHAT THIS PROVES, in order:
 *   a. a claim for a fresh identity+seed creates a row and comes back `you: true`.
 *   b. a lower resubmission, and a fetch-only claim of 0, never move the stored best down.
 *   c. a second identity's higher claim outranks the first — the board sorts by best, DESC.
 *   d. a claim under a different seed does not leak into another seed's board.
 *   e. 0, a negative claim, and a claim over the 4,000,000 m cap are all discarded outright.
 *   (bonus) a higher claim submitted with an empty name still wins, but does not blank out
 *   the name already on file.
 *   (source) server/drive.php and base44/functions/drive/index.js both actually carry this
 *   shape — the CREATE TABLE, the branch, the exact `claim > 0 && claim <= 4000000` gate (not
 *   a silent clamp that would make the upper half of that gate unreachable), the ORDER
 *   BY/LIMIT, and the two backends agreeing on the one magic number that matters.
 *
 *   node tools/diag-board.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const PHP = readFileSync(join(HERE, '..', 'server', 'drive.php'), 'utf8');
const JS = readFileSync(join(HERE, '..', 'base44', 'functions', 'drive', 'index.js'), 'utf8');
const DOC = readFileSync(join(HERE, '..', 'docs', 'BACKEND.md'), 'utf8');

/** Same 64-hex-char fake secrets as tools/net-devapi.mjs's `hex()` — one repeated digit is
 *  the least-effort way to get something that matches drive.php's `^[0-9a-f]{64}$`. */
const hex = (c) => c.repeat(64);

/** drive.php's `$me = substr(hash('sha256', $secret), 0, 12)`, and server/devApi.mjs's
 *  identical DevWorld.idFor — copied rather than imported, because this file has no PHP
 *  process to import FROM and devApi.mjs is out of scope for this change. */
const idFor = (secret) => createHash('sha256').update(secret).digest('hex').slice(0, 12);

/** A deliberately thin stand-in for wr_name()/cleanName() — this tool is not re-proving name
 *  sanitisation (wr_name is existing, already-relied-upon code that the new PHP branch reuses
 *  as-is, never rewritten — see the source checks below), only that a name survives an upsert
 *  intact and that an empty one does not blank out one already on the board. */
const cleanName = (v) => (typeof v === 'string' ? v.trim().slice(0, 18) : '');

/**
 * The mirror. One 'board' request in, `res.board` out — submit (if the claim qualifies) then
 * fetch, exactly the fused shape of the real op. Every rule here is one this change puts in
 * BOTH server/drive.php (the new upsert in wr_handle()) and, already, in
 * base44/functions/drive/index.js — see the source checks at the bottom of this file for
 * proof the production text agrees with what is asserted here.
 */
class Board {
  constructor() {
    /** `${seed}:${playerId}` -> { playerId, seed, best, at, name } — the same composite key
     *  as the PHP table's PRIMARY KEY(player_id, seed): one row per player, per world. */
    this.rows = new Map();
  }

  submit(secret, { seed = 0, best = 0, name = '' } = {}, atS = 0) {
    const me = idFor(secret);
    // Only the LOWER bound belongs on this clamp — see the long comment at the equivalent
    // line in server/drive.php for why capping the upper bound here instead would make the
    // qualifying guard on the next line unreachable.
    const claim = Math.max(0, Math.trunc(Number.isFinite(best) ? best : 0));
    if (claim > 0 && claim <= 4000000) {
      const key = `${seed}:${me}`;
      const row = this.rows.get(key);
      const cleaned = cleanName(name);
      if (!row) {
        this.rows.set(key, { playerId: me, seed, best: claim, at: atS, name: cleaned });
      } else if (claim > row.best) {
        row.best = claim;
        row.at = atS;
        row.name = cleaned || row.name || '';
      }
      // claim <= row.best: not written at all. Not even the name or timestamp move — a run
      // that does not beat the record has not earned the right to relabel it.
    }
    return [...this.rows.values()]
      .filter((r) => r.seed === seed)
      .sort((a, b) => b.best - a.best)
      .slice(0, 20)
      .map((r, i) => ({ rank: i + 1, name: r.name || 'someone', best: r.best, you: r.playerId === me }));
  }
}

let failed = 0;
function check(ok, what, detail = '') {
  if (!ok) failed++;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  — ${detail}` : ''}`);
  return ok;
}

console.log('\nWanderoad — the leaderboard board op\n');

const S1 = hex('1');
const S2 = hex('2');
const S9 = hex('9');
const SEED_1 = 111;
const SEED_2 = 222;

/* ── a. a fresh claim creates a row ────────────────────────────────────────── */
const world = new Board();
let board = world.submit(S1, { seed: SEED_1, best: 5000, name: 'Runner One' }, 1000);
console.log(`a. fresh claim of 5000 for a new identity+seed: ${JSON.stringify(board)}`);
const mine = board.find((r) => r.you);
check(!!mine, 'a fresh claim creates a row that comes back with you:true', mine ? `rank ${mine.rank}` : 'no row at all');
check(mine?.best === 5000, 'the stored best is exactly the claim', `best ${mine?.best}`);

/* ── b. a lower resubmission, and a 0 fetch, never move it down ────────────── */
board = world.submit(S1, { seed: SEED_1, best: 3000, name: 'Runner One' }, 1001);
check(
  board.find((r) => r.you)?.best === 5000,
  'a LOWER resubmission (3000) does not lower the stored best',
  `best is now ${board.find((r) => r.you)?.best}`
);
board = world.submit(S1, { seed: SEED_1, best: 0, name: 'Runner One' }, 1002);
check(
  board.find((r) => r.you)?.best === 5000,
  'a fetch-only claim of 0 leaves the best exactly as it was',
  `best is now ${board.find((r) => r.you)?.best}`
);
check(board.length === 1, 'and a claim of 0 did not create a second row', `${board.length} row(s)`);

/* ── c. a second identity's higher claim outranks the first ────────────────── */
board = world.submit(S2, { seed: SEED_1, best: 9000, name: 'Runner Two' }, 1003);
console.log(`c. after a second identity submits 9000: ${JSON.stringify(board)}`);
check(board.length === 2, "both identities are now on this seed's board", `${board.length} row(s)`);
check(board[0]?.best === 9000 && board[0]?.rank === 1, 'the board is sorted best DESC — 9000 is rank 1', `rank 1 is ${board[0]?.best}`);
check(board[0]?.you === true, 'and it is marked you:true for the identity that just submitted it', `you=${board[0]?.you}`);
check(board[1]?.best === 5000 && board[1]?.rank === 2, 'the earlier claim is still there at rank 2, untouched', `rank 2 is ${board[1]?.best}`);

/* ── d. a different seed does not see this seed's claims at all ────────────── */
board = world.submit(S1, { seed: SEED_2, best: 7000, name: 'Runner One' }, 1004);
console.log(`d. the SAME identity claims 7000 under a different seed: ${JSON.stringify(board)}`);
check(board.length === 1 && board[0]?.best === 7000, 'the new seed starts its own board at just this claim', JSON.stringify(board));
// Fetch-only (claim 0) from the OTHER identity, back on the first seed — proves that claiming
// under seed 222 above left seed 111's table completely alone.
const seed1Board = world.submit(S2, { seed: SEED_1, best: 0 }, 1005);
check(
  seed1Board.length === 2 && seed1Board[0]?.best === 9000 && seed1Board[1]?.best === 5000,
  "the first seed's board is completely unaffected by the other seed's claim",
  JSON.stringify(seed1Board)
);

/* ── bonus: a winning claim with an empty name does not blank the name on file ─ */
// The one cell of the truth table a naive "just overwrite the name" upsert gets wrong: this
// claim DOES beat the stored best, so the row updates — but the name field on THIS particular
// request is empty (a client that has not loaded the player's chosen name yet), and that must
// not cost the row its existing label.
board = world.submit(S1, { seed: SEED_1, best: 6000, name: '' }, 1006);
const raised = board.find((r) => r.you);
check(raised?.best === 6000, 'a higher claim (6000) with an empty name still raises the best', `best ${raised?.best}`);
check(raised?.name === 'Runner One', 'and it does not blank out the name already on file', `name "${raised?.name}"`);

/* ── e. 0, a negative claim, and an over-cap claim are all discarded outright ─ */
const worldE = new Board();
let baseline = worldE.submit(S9, { seed: 333, best: 4200, name: 'D' }, 2000);
check(baseline[0]?.best === 4200, 'baseline: a fresh legitimate claim of 4200 is stored', `best ${baseline[0]?.best}`);
let afterZero = worldE.submit(S9, { seed: 333, best: 0 }, 2001);
check(afterZero[0]?.best === 4200, 'a claim of 0 is rejected — best is unchanged', `best ${afterZero[0]?.best}`);
let afterNeg = worldE.submit(S9, { seed: 333, best: -50 }, 2002);
check(afterNeg[0]?.best === 4200, 'a claim of -50 is rejected — best is unchanged', `best ${afterNeg[0]?.best}`);
let afterOver = worldE.submit(S9, { seed: 333, best: 5000000 }, 2003);
check(
  afterOver[0]?.best === 4200,
  'a claim of 5,000,000 (over the 4,000,000 cap) is rejected outright, not clamped and accepted',
  `best ${afterOver[0]?.best}`
);

/* ── source: the production files actually carry this shape ─────────────────
 * Everything above ran against the mirror in this file, because there is no PHP interpreter
 * on this machine. What CAN be checked without one is that server/drive.php's own text — the
 * file that actually answers https://cozydriver.com/beta/'s requests — carries the same shape
 * the mirror assumes, the same way tools/net-devapi.mjs proves its position-filter fix is
 * really in drive.php by reading the file rather than running it.
 */
console.log('\nsource: reading server/drive.php and base44/functions/drive/index.js directly\n');

const boardStartPhp = PHP.indexOf("if ($op === 'board')");
const boardEndPhp = PHP.indexOf('/* ── tick', boardStartPhp);
const phpBoard = boardStartPhp >= 0 && boardEndPhp > boardStartPhp ? PHP.slice(boardStartPhp, boardEndPhp) : '';

const boardStartJs = JS.indexOf("if (op === 'board')");
const boardEndJs = JS.indexOf('/* ── tick', boardStartJs);
const jsBoard = boardStartJs >= 0 && boardEndJs > boardStartJs ? JS.slice(boardStartJs, boardEndJs) : '';

check(phpBoard !== '', "server/drive.php has an op==='board' branch at all", phpBoard ? `${phpBoard.length} chars` : 'NOT FOUND');
check(/CREATE TABLE IF NOT EXISTS leaderboard\(/.test(PHP), 'wr_db() creates the leaderboard table');
check(/PRIMARY KEY\(player_id,\s*seed\)/.test(PHP), 'the table is keyed one row per player PER SEED');
check(/\$claim = wr_int\(\$req\['best'\] \?\? 0, 0, PHP_INT_MAX\);/.test(PHP), 'the claim is NOT pre-clamped to the 4,000,000 cap');
check(/\$claim > 0 && \$claim <= 4000000/.test(phpBoard), 'the qualifying gate is the exact `claim > 0 && claim <= 4000000` guard');
check((phpBoard.match(/->prepare\(/g) || []).length >= 2, 'the branch uses prepared statements, not raw exec', `${(phpBoard.match(/->prepare\(/g) || []).length} prepare() calls`);
check(!/\.\s*\$req\[/.test(phpBoard), 'no request field is concatenated into a SQL string');
check(/wr_name\(\$req\['name'\] \?\? ''\)/.test(phpBoard), 'the branch reuses wr_name() rather than a second sanitiser');
check(/ORDER BY best DESC LIMIT 20/.test(phpBoard), 'the fetch is top 20 by best, descending');
check(/'someone'/.test(phpBoard), 'a nameless row still reads as "someone" rather than blank');
check(/'you' => \$r\['player_id'\] === \$me/.test(phpBoard), 'each row says whether it belongs to the caller');

check(jsBoard !== '', "base44/functions/drive/index.js still has its own op==='board' branch", jsBoard ? `${jsBoard.length} chars` : 'NOT FOUND');
check(/claim > 0 && claim <= 4000000/.test(jsBoard), 'the Base44 twin gates on the exact same 4,000,000 cap', 'both backends agree on the one number that matters');
check(/'someone'/.test(jsBoard), 'the Base44 twin has the same nameless-row fallback');

check(/"op": "tick" \| "bye" \| "save" \| "load" \| "board"/.test(DOC), 'docs/BACKEND.md documents board in the op enum');
check(/## The leaderboard/.test(DOC), 'docs/BACKEND.md has a dedicated section for the op');

console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
