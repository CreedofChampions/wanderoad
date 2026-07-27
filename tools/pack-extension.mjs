/* Rebuild the extension bundle from the current game build, then zip it for the store.
 *   node tools/pack-extension.mjs
 * The game is copied in rather than framed from the web because Manifest V3 forbids an
 * extension executing remotely hosted code — see docs/EXTENSION.md.
 */
import { cpSync, rmSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const game = resolve(root, 'extension/game');

if (!existsSync(dist)) throw new Error('no dist/ — run `npm run build` first');

rmSync(game, { recursive: true, force: true });
mkdirSync(game, { recursive: true });
cpSync(dist, game, { recursive: true });
// The preview gallery links out to the web build and has no place inside the extension.
rmSync(resolve(game, 'previews'), { recursive: true, force: true });

const manifest = JSON.parse(readFileSync(resolve(root, 'extension/manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(resolve(root, 'extension/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

const zip = resolve(root, `wanderoad-extension-${manifest.version}.zip`);
rmSync(zip, { force: true });
try {
  // `join(extDir, '*')` — NOT a `${extDir}\*` template literal. Inside a JS template literal
  // `\*` is an unrecognized escape and the backslash is silently dropped, collapsing the path
  // to `...extension*`: a glob matching the `extension` FOLDER itself (there being no other
  // sibling starting with that prefix), not its contents. Compress-Archive then zips the
  // folder as a single nested entry, so manifest.json lands at `extension\manifest.json`
  // inside the zip instead of at the zip root — which the Chrome Web Store upload requires
  // and which "unzip, then Load unpacked on the top folder" also silently gets wrong. This
  // ran without ever throwing, "packed …zip" printed either way — the bug was invisible
  // unless someone opened the archive. `join()` inserts a real path separator character at
  // runtime, so it is not subject to source-level escape parsing.
  const glob = join(resolve(root, 'extension'), '*');
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${glob}' -DestinationPath '${zip}' -Force`],
    { stdio: 'inherit' }
  );
  console.log('packed', zip);
} catch {
  console.log('bundle refreshed at extension/ — zip it however you like');
}
