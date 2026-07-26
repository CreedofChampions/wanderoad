<?php
/* Wanderoad — GET /state. Health and population, nothing else.
 *
 * Read-only and unauthenticated on purpose: it is what the deploy script curls to prove
 * the API came up, and what a status page can poll. It exposes no player identity, no
 * position and no save data — a count, the world seed and how long the database has been
 * alive. Nothing here is worth rate-limiting or hiding.
 *
 * The schema, the connection and the CORS rules come from drive.php so there is exactly
 * one definition of each; drive.php's handler does not run on include.
 */

declare(strict_types=1);

require_once __DIR__ . '/drive.php';

wr_cors();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    return;
}

try {
    $pdo = wr_db();
    $now = microtime(true);

    $st = $pdo->prepare('SELECT COUNT(*) AS n FROM presence WHERE seen > ?');
    $st->execute([$now - WR_EXPIRE_S]);
    $players = (int) ($st->fetch()['n'] ?? 0);

    $seed = wr_meta($pdo, 'seed');
    $boot = (int) (wr_meta($pdo, 'boot') ?? time());

    wr_send([
        'ok' => true,
        'players' => $players,
        'seed' => $seed === null ? null : (int) $seed,
        'uptime' => max(0, time() - $boot),
    ]);
} catch (Throwable $e) {
    error_log('[wanderoad/state] ' . $e->getMessage());
    wr_send(['ok' => false, 'error' => 'server error'], 500);
}
