<?php
/* Wanderoad — POST /drive. The whole multiplayer protocol, in one endpoint.
 *
 * Write and read are fused on purpose: the request carries your car, the response carries
 * the nearest peers. The client therefore needs nothing but plain HTTPS to be fully
 * playable — no socket, no long poll, no fallback path that only gets exercised when
 * something is already broken.
 *
 * Remote cars are ghosts on the client and never collide, which is why there is no
 * authority, no arbitration and no rollback in here. This file is a spatial cache with a
 * sanity filter bolted on, and nothing more.
 *
 * Runs on OpenLiteSpeed + PHP 8.3 with pdo_sqlite. The database lives OUTSIDE the docroot
 * (deploy/deploy.py creates the directory) so a webserver misconfiguration cannot serve it.
 *
 * state.php require_once's this file for the schema, the CORS rules and the connection, so
 * there is one definition of each. The handler at the bottom only runs when this file is
 * the request's entry point.
 */

declare(strict_types=1);

const WR_DATA_DIR = '/home/admin/domains/crumbtown.org/wanderoad_data';
const WR_MAX_BODY = 8192;          // bytes; the client enforces the same cap
const WR_EXPIRE_S = 8.0;           // a presence row is dead this long after its last tick
const WR_CELL = 2048.0;            // interest-management cell size, metres
const WR_MAX_PEERS = 16;           // nearest N returned
const WR_MAX_SPEED = 105.0;        // m/s — above this the position is a lie
const WR_JUMP_SLACK = 25.0;        // metres of free movement before the jump test bites
const WR_JUMP_FACTOR = 1.6;        // how much faster than last reported you may have gone
const WR_RATE_WINDOW = 2.0;        // seconds
const WR_RATE_PLAYER = 6;          // requests per window per player
const WR_RATE_IP = 40;             // per window per IP — a household shares one address
const WR_SAVE_MAX = 262144;        // bytes of stored save blob per player
const WR_SAVE_OPS = 4000;          // ops kept per player
const WR_SIGNAL_TTL = 30.0;        // seconds a WebRTC signal waits for its recipient
const WR_SIGNAL_MAX = 1400;        // bytes per signal body

/* ── CORS ──────────────────────────────────────────────────────────────────
 * The game is served from crumbtown.org and from *.base44.app, and is developed against
 * a Vite dev server on localhost. No cookies are ever used — the secret travels in the
 * body — so credentials are never allowed and there is nothing for a third-party origin
 * to steal by embedding us.
 */
function wr_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $ok = $origin !== '' && (
        $origin === 'https://crumbtown.org'
        || $origin === 'https://www.crumbtown.org'
        || preg_match('#^https://([a-z0-9-]+\.)*base44\.app$#i', $origin) === 1
        || preg_match('#^http://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin) === 1
    );
    if ($ok) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
}

function wr_send(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function wr_fail(string $why, int $status): void
{
    wr_send(['error' => $why], $status);
    exit;
}

/* ── database ──────────────────────────────────────────────────────────────*/

function wr_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dir = getenv('WANDEROAD_DATA') ?: WR_DATA_DIR;
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        wr_fail('data directory missing', 500);
    }
    $pdo = new PDO('sqlite:' . $dir . '/wanderoad.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    // WAL keeps a reader from blocking the 2 Hz writers; a 3 s busy timeout absorbs the
    // occasional overlap without a 500.
    $pdo->exec('PRAGMA journal_mode=WAL');
    $pdo->exec('PRAGMA synchronous=NORMAL');
    $pdo->exec('PRAGMA busy_timeout=3000');
    $pdo->exec('CREATE TABLE IF NOT EXISTS presence(
        player_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cell TEXT NOT NULL,
        x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL, yaw REAL NOT NULL,
        vx REAL NOT NULL, vy REAL NOT NULL, vz REAL NOT NULL,
        yaw_rate REAL NOT NULL, steer REAL NOT NULL, throttle REAL NOT NULL, brake REAL NOT NULL,
        gear INTEGER NOT NULL, tier INTEGER NOT NULL, paint INTEGER NOT NULL, flags INTEGER NOT NULL,
        t REAL NOT NULL, seen REAL NOT NULL)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS presence_cell ON presence(cell, seen)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS saves(
        player_id TEXT PRIMARY KEY, seed INTEGER, body TEXT NOT NULL, updated REAL NOT NULL)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS ratelimit(k TEXT PRIMARY KEY, n INTEGER NOT NULL, win REAL NOT NULL)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS signals(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        to_id TEXT NOT NULL, from_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, t REAL NOT NULL)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS signals_to ON signals(to_id, id)');
    // Bound, not inlined: SQLite reads a double-quoted literal as an identifier first,
    // and single quotes cannot appear inside these single-quoted PHP strings.
    $st = $pdo->prepare('INSERT OR IGNORE INTO meta(k, v) VALUES(?, ?)');
    $st->execute(['boot', (string) time()]);
    return $pdo;
}

function wr_meta(PDO $pdo, string $key): ?string
{
    $st = $pdo->prepare('SELECT v FROM meta WHERE k = ?');
    $st->execute([$key]);
    $row = $st->fetch();
    return $row ? (string) $row['v'] : null;
}

/* ── helpers ───────────────────────────────────────────────────────────────*/

/** Exactly JS Math.round: half goes towards +Infinity, so client and server agree on a cell. */
function wr_cell_index(float $v): int
{
    return (int) floor($v / WR_CELL + 0.5);
}

function wr_cell(float $x, float $z): string
{
    return 'c' . wr_cell_index($x) . '_' . wr_cell_index($z);
}

/** Every number off the wire goes through here: no NaN, no INF, no unbounded magnitudes. */
function wr_num(mixed $v, float $limit): float
{
    if (!is_int($v) && !is_float($v)) {
        return 0.0;
    }
    $f = (float) $v;
    if (!is_finite($f)) {
        return 0.0;
    }
    return max(-$limit, min($limit, $f));
}

function wr_int(mixed $v, int $lo, int $hi): int
{
    $i = is_numeric($v) ? (int) $v : 0;
    return max($lo, min($hi, $i));
}

/**
 * Names are drawn in other players' HUDs, so strip controls, zero-width characters and
 * the bidi overrides — one RTL override in a name reorders the whole line it lands in.
 * Invalid UTF-8 is dropped outright rather than repaired: json_encode would fail on it,
 * which would take down the response for everyone in the cell.
 */
function wr_name(mixed $v): string
{
    if (!is_string($v) || $v === '' || preg_match('//u', $v) !== 1) {
        return '';
    }
    $s = preg_replace(
        '/[\x{0000}-\x{001f}\x{007f}-\x{009f}\x{200b}-\x{200f}\x{2028}-\x{202e}\x{2066}-\x{2069}]/u',
        '',
        $v
    );
    if ($s === null) {
        return '';
    }
    $s = trim((string) preg_replace('/\s+/u', ' ', $s));
    // Codepoint-safe truncation without mbstring, which is not guaranteed on every host.
    return (string) preg_replace('/^(.{0,18}).*$/us', '$1', $s);
}

/** Fixed-window limiter. Two statements instead of one RETURNING, so old SQLite is fine. */
function wr_rate_ok(PDO $pdo, string $key, int $limit, float $now): bool
{
    $st = $pdo->prepare('SELECT n, win FROM ratelimit WHERE k = ?');
    $st->execute([$key]);
    $row = $st->fetch();
    if ($row === false || ($now - (float) $row['win']) >= WR_RATE_WINDOW) {
        $up = $pdo->prepare('INSERT INTO ratelimit(k, n, win) VALUES(?, 1, ?)
            ON CONFLICT(k) DO UPDATE SET n = 1, win = excluded.win');
        $up->execute([$key, $now]);
        return true;
    }
    $n = (int) $row['n'] + 1;
    $up = $pdo->prepare('UPDATE ratelimit SET n = ? WHERE k = ?');
    $up->execute([$n, $key]);
    return $n <= $limit;
}

/**
 * Adaptive tick rate, decided by the server so it can shed load unilaterally.
 * Alone: 0.25 Hz. A peer within 3 km: 1 Hz. Within 800 m: 2 Hz. The client may burst to
 * 4 Hz on its own when its dead reckoning diverges, which is what makes close racing feel
 * live without paying for 4 Hz across an empty continent.
 */
function wr_rate(float $nearest): float
{
    if ($nearest <= 800.0) {
        return 2.0;
    }
    if ($nearest <= 3000.0) {
        return 1.0;
    }
    return 0.25;
}

/* ── save merge ────────────────────────────────────────────────────────────*/

/** Visited bitsets merge by OR: having been somewhere never becomes false. */
function wr_or_b64(string $a, string $b): string
{
    $da = base64_decode($a, true);
    $db = base64_decode($b, true);
    if ($da === false) {
        return $b;
    }
    if ($db === false) {
        return $a;
    }
    $n = max(strlen($da), strlen($db));
    $out = '';
    for ($i = 0; $i < $n; $i++) {
        $out .= chr((isset($da[$i]) ? ord($da[$i]) : 0) | (isset($db[$i]) ? ord($db[$i]) : 0));
    }
    return base64_encode($out);
}

function wr_merge_save(array $save, array $ops): array
{
    $save['visited'] ??= [];
    $save['ops'] ??= [];
    $byBlock = [];
    foreach ($save['visited'] as $i => $entry) {
        if (isset($entry['b'])) {
            $byBlock[(string) $entry['b']] = $i;
        }
    }
    $seen = [];
    foreach ($save['ops'] as $op) {
        if (isset($op['n'])) {
            $seen[(int) $op['n']] = true;
        }
    }

    foreach ($ops as $op) {
        if (!is_array($op)) {
            continue;
        }
        $kind = isset($op['k']) && is_string($op['k']) ? $op['k'] : '';
        if ($kind === 'seed') {
            $save['seed'] = wr_int($op['v'] ?? 0, 0, PHP_INT_MAX);
        } elseif ($kind === 'visited') {
            $block = isset($op['b']) && is_string($op['b']) ? $op['b'] : '';
            $data = isset($op['d']) && is_string($op['d']) ? $op['d'] : '';
            if ($block === '' || $data === '' || !preg_match('/^-?\d+,-?\d+$/', $block)) {
                continue;
            }
            if (isset($byBlock[$block])) {
                $i = $byBlock[$block];
                $save['visited'][$i]['d'] = wr_or_b64((string) $save['visited'][$i]['d'], $data);
            } else {
                $byBlock[$block] = count($save['visited']);
                $save['visited'][] = ['b' => $block, 'd' => $data];
            }
        } elseif ($kind !== 'rtc') {
            $n = isset($op['n']) ? (int) $op['n'] : 0;
            if ($n > 0 && isset($seen[$n])) {
                continue;
            }
            $seen[$n] = true;
            $save['ops'][] = $op;
        }
    }
    if (count($save['ops']) > WR_SAVE_OPS) {
        $save['ops'] = array_slice($save['ops'], -WR_SAVE_OPS);
    }
    return $save;
}

/* ── WebRTC signalling relay ───────────────────────────────────────────────
 * Optional. A pair of players who both manage a direct connection get sub-frame latency;
 * everyone else keeps playing over HTTP and never notices. The relay is deliberately dumb:
 * it holds an opaque body for 30 s and hands it to the addressee once.
 */
function wr_relay_signal(PDO $pdo, string $from, array $op, float $now): void
{
    $to = isset($op['to']) && is_string($op['to']) ? $op['to'] : '';
    $kind = isset($op['kind']) && is_string($op['kind']) ? $op['kind'] : '';
    $body = isset($op['body']) && is_string($op['body']) ? $op['body'] : '';
    if (!preg_match('/^[0-9a-f]{12}$/', $to) || $kind === '' || $body === '') {
        return;
    }
    if (strlen($body) > WR_SIGNAL_MAX || !in_array($kind, ['offer', 'answer', 'ice'], true)) {
        return;
    }
    $st = $pdo->prepare('INSERT INTO signals(to_id, from_id, kind, body, t) VALUES(?, ?, ?, ?, ?)');
    $st->execute([$to, $from, $kind, $body, $now]);
}

function wr_take_signals(PDO $pdo, string $me, float $now): array
{
    $st = $pdo->prepare('SELECT id, from_id, kind, body FROM signals WHERE to_id = ? AND t > ? ORDER BY id LIMIT 4');
    $st->execute([$me, $now - WR_SIGNAL_TTL]);
    $rows = $st->fetchAll();
    if ($rows === []) {
        return [];
    }
    $out = [];
    $ids = [];
    foreach ($rows as $r) {
        $ids[] = (int) $r['id'];
        $out[] = ['from' => $r['from_id'], 'kind' => $r['kind'], 'body' => $r['body']];
    }
    $del = $pdo->prepare('DELETE FROM signals WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')');
    $del->execute($ids);
    return $out;
}

/* ── the handler ───────────────────────────────────────────────────────────*/

function wr_handle(): void
{
    wr_cors();

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS') {
        http_response_code(204);
        return;
    }
    if ($method !== 'POST') {
        wr_fail('POST only', 405);
    }
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > WR_MAX_BODY) {
        wr_fail('body too large', 413);
    }
    $raw = (string) file_get_contents('php://input', false, null, 0, WR_MAX_BODY + 1);
    if (strlen($raw) > WR_MAX_BODY) {
        wr_fail('body too large', 413);
    }
    $req = json_decode($raw, true);
    if (!is_array($req)) {
        wr_fail('bad json', 400);
    }

    $secret = $req['secret'] ?? '';
    if (!is_string($secret) || !preg_match('/^[0-9a-f]{64}$/', $secret)) {
        wr_fail('bad secret', 400);
    }
    // The id is derived, never accepted: without the secret you cannot claim a row.
    $me = substr(hash('sha256', $secret), 0, 12);

    $now = microtime(true);
    $pdo = wr_db();

    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    if (!wr_rate_ok($pdo, 'p:' . $me, WR_RATE_PLAYER, $now)) {
        header('Retry-After: 1');
        wr_fail('slow down', 429);
    }
    if (!wr_rate_ok($pdo, 'i:' . $ip, WR_RATE_IP, $now)) {
        header('Retry-After: 1');
        wr_fail('slow down', 429);
    }

    // Sweep expired rows on roughly one request in sixteen. Cheap, and it keeps the table
    // the size of the live population rather than the size of everyone who ever played.
    if (random_int(0, 15) === 0) {
        $pdo->prepare('DELETE FROM presence WHERE seen < ?')->execute([$now - WR_EXPIRE_S]);
        $pdo->prepare('DELETE FROM signals WHERE t < ?')->execute([$now - WR_SIGNAL_TTL]);
        $pdo->prepare('DELETE FROM ratelimit WHERE win < ?')->execute([$now - 600]);
    }

    $op = isset($req['op']) && is_string($req['op']) ? $req['op'] : 'tick';
    $res = ['now' => (int) round($now * 1000), 'you' => ['playerId' => $me], 'peers' => [], 'rate' => 0.25];

    if ($op === 'bye') {
        $pdo->prepare('DELETE FROM presence WHERE player_id = ?')->execute([$me]);
        wr_send($res);
        return;
    }

    /* ── save / load ─────────────────────────────────────────────────────── */
    if ($op === 'save' || $op === 'load') {
        $st = $pdo->prepare('SELECT seed, body FROM saves WHERE player_id = ?');
        $st->execute([$me]);
        $row = $st->fetch();
        $save = $row ? json_decode((string) $row['body'], true) : null;
        if (!is_array($save)) {
            $save = ['seed' => null, 'visited' => [], 'ops' => []];
        }

        if ($op === 'save') {
            $ops = isset($req['ops']) && is_array($req['ops']) ? $req['ops'] : [];
            $save = wr_merge_save($save, $ops);
            $body = json_encode($save, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if ($body !== false && strlen($body) <= WR_SAVE_MAX) {
                $up = $pdo->prepare('INSERT INTO saves(player_id, seed, body, updated) VALUES(?, ?, ?, ?)
                    ON CONFLICT(player_id) DO UPDATE SET seed = excluded.seed, body = excluded.body, updated = excluded.updated');
                $up->execute([$me, $save['seed'] ?? null, $body, $now]);
                // The first save to name a seed pins the world state.php reports.
                if (isset($save['seed'])) {
                    $pdo->prepare('INSERT OR IGNORE INTO meta(k, v) VALUES(?, ?)')
                        ->execute(['seed', (string) (int) $save['seed']]);
                }
            } else {
                $res['saveFull'] = true; // client keeps its local copy and stops uploading
            }
        }
        $res['save'] = $save;
        wr_send($res);
        return;
    }

    /* ── tick ────────────────────────────────────────────────────────────── */
    $car = isset($req['car']) && is_array($req['car']) ? $req['car'] : [];
    $x = wr_num($car['x'] ?? 0, 1.0e7);
    $y = wr_num($car['y'] ?? 0, 1.0e5);
    $z = wr_num($car['z'] ?? 0, 1.0e7);

    $st = $pdo->prepare('SELECT x, y, z, vx, vy, vz, seen FROM presence WHERE player_id = ?');
    $st->execute([$me]);
    $prev = $st->fetch();

    $rejected = false;
    if ($prev !== false) {
        $elapsed = $now - (float) $prev['seen'];
        if ($elapsed > 0.0 && $elapsed <= WR_EXPIRE_S) {
            $dist = sqrt(
                ($x - (float) $prev['x']) ** 2 +
                ($y - (float) $prev['y']) ** 2 +
                ($z - (float) $prev['z']) ** 2
            );
            $wasGoing = sqrt(
                ((float) $prev['vx']) ** 2 + ((float) $prev['vy']) ** 2 + ((float) $prev['vz']) ** 2
            );
            $allowed = $wasGoing * $elapsed * WR_JUMP_FACTOR + WR_JUMP_SLACK;
            // Two separate tests: one catches a sustained impossible speed, the other a
            // single teleport that a low reported velocity would otherwise excuse.
            //
            // The speed test uses a floor on elapsed because a burst tick 30 ms after the
            // last one says nothing useful about speed — five metres in 30 ms reads as
            // 166 m/s and would fail every legitimate divergence burst. The 6-per-2 s rate
            // limit is what actually bounds how far a client can walk itself: WR_JUMP_SLACK
            // metres per request, 75 m/s at the cap.
            if ($dist / max($elapsed, 0.25) > WR_MAX_SPEED || $dist > $allowed) {
                $rejected = true;
                $x = (float) $prev['x'];
                $y = (float) $prev['y'];
                $z = (float) $prev['z'];
            }
        }
    }

    $cell = wr_cell($x, $z);
    $up = $pdo->prepare('INSERT INTO presence(
            player_id, name, cell, x, y, z, yaw, vx, vy, vz, yaw_rate, steer, throttle, brake,
            gear, tier, paint, flags, t, seen)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(player_id) DO UPDATE SET
            -- A tick that omits the name keeps the stored one, so one malformed request
            -- does not blank a driver out of every other HUD. length() rather than a
            -- quoted empty string: SQLite would read "" as an identifier first.
            name = CASE WHEN length(excluded.name) = 0 THEN presence.name ELSE excluded.name END,
            cell = excluded.cell,
            x = excluded.x, y = excluded.y, z = excluded.z, yaw = excluded.yaw,
            vx = excluded.vx, vy = excluded.vy, vz = excluded.vz,
            yaw_rate = excluded.yaw_rate, steer = excluded.steer,
            throttle = excluded.throttle, brake = excluded.brake,
            gear = excluded.gear, tier = excluded.tier, paint = excluded.paint,
            flags = excluded.flags, t = excluded.t, seen = excluded.seen');
    $up->execute([
        $me,
        wr_name($req['name'] ?? ''),
        $cell,
        $x, $y, $z,
        wr_num($car['yaw'] ?? 0, 1.0e4),
        wr_num($car['vx'] ?? 0, 200.0),
        wr_num($car['vy'] ?? 0, 200.0),
        wr_num($car['vz'] ?? 0, 200.0),
        wr_num($car['yawRate'] ?? 0, 50.0),
        wr_num($car['steer'] ?? 0, 1.0),
        wr_num($car['throttle'] ?? 0, 1.0),
        wr_num($car['brake'] ?? 0, 1.0),
        wr_int($car['gear'] ?? 0, -1, 12),
        wr_int($car['tier'] ?? 0, 0, 63),
        wr_int($car['paint'] ?? 0, 0, 63),
        wr_int($car['flags'] ?? 0, 0, 0xffff),
        (int) round($now * 1000),
        $now,
    ]);

    // Interest management: the 3x3 cell neighbourhood is 6144 m across, comfortably wider
    // than the 3 km at which the tick rate rises, so nobody appears out of nowhere.
    $cx = wr_cell_index($x);
    $cz = wr_cell_index($z);
    $cells = [];
    for ($i = -1; $i <= 1; $i++) {
        for ($j = -1; $j <= 1; $j++) {
            $cells[] = 'c' . ($cx + $i) . '_' . ($cz + $j);
        }
    }
    $sql = 'SELECT player_id, name, tier, paint, x, y, z, yaw, vx, vz, yaw_rate, steer, throttle, brake, flags, t
            FROM presence WHERE cell IN (?, ?, ?, ?, ?, ?, ?, ?, ?) AND seen > ? AND player_id <> ?';
    $q = $pdo->prepare($sql);
    $q->execute([...$cells, $now - WR_EXPIRE_S, $me]);

    $peers = [];
    $nearest = INF;
    foreach ($q->fetchAll() as $r) {
        $d2 = ((float) $r['x'] - $x) ** 2 + ((float) $r['y'] - $y) ** 2 + ((float) $r['z'] - $z) ** 2;
        $nearest = min($nearest, $d2);
        $peers[] = [$d2, [
            'id' => $r['player_id'],
            'name' => $r['name'],
            'tier' => (int) $r['tier'],
            'paint' => (int) $r['paint'],
            'x' => (float) $r['x'], 'y' => (float) $r['y'], 'z' => (float) $r['z'],
            'yaw' => (float) $r['yaw'],
            'vx' => (float) $r['vx'], 'vz' => (float) $r['vz'],
            'yawRate' => (float) $r['yaw_rate'],
            'steer' => (float) $r['steer'],
            'throttle' => (float) $r['throttle'],
            'brake' => (float) $r['brake'],
            'flags' => (int) $r['flags'],
            't' => (float) $r['t'],
        ]];
    }
    // Sorted by true distance, not by cell, so the sixteen you get are the sixteen you can
    // actually see.
    usort($peers, static fn (array $a, array $b): int => $a[0] <=> $b[0]);
    $res['peers'] = array_map(static fn (array $p): array => $p[1], array_slice($peers, 0, WR_MAX_PEERS));
    $res['rate'] = wr_rate($nearest === INF ? INF : sqrt($nearest));
    if ($rejected) {
        $res['rejected'] = true;
    }

    if (isset($req['ops']) && is_array($req['ops'])) {
        foreach ($req['ops'] as $o) {
            if (is_array($o) && ($o['k'] ?? '') === 'rtc') {
                wr_relay_signal($pdo, $me, $o, $now);
            }
        }
    }
    $signals = wr_take_signals($pdo, $me, $now);
    if ($signals !== []) {
        $res['signals'] = $signals;
    }

    wr_send($res);
}

// Only run when this file is the request; state.php includes it for the schema and helpers.
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === realpath(__FILE__)) {
    try {
        wr_handle();
    } catch (Throwable $e) {
        error_log('[wanderoad/drive] ' . $e->getMessage());
        wr_send(['error' => 'server error'], 500);
    }
}
