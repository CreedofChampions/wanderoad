import { defineConfig } from 'vite';
import { wanderoadDevApi } from './server/devApi.mjs';

// Wanderoad ships as one static bundle: Base44 site hosting serves ./dist, and the
// same folder is rsynced to crumbtown.org. Relative base keeps it working from a
// sub-path (crumbtown.org/wanderoad/) as well as from a domain root.
export default defineConfig({
  /* Multiplayer, on the dev server, in-process — see server/devApi.mjs for the whole story.
   * Short version: Vite answers any unmatched path with index.html, so a POST to
   * /api/drive.php came back 200 with an HTML body, net/transport.js's PHP driver threw on
   * the JSON parse, the chain demoted to the `local` driver, and every localhost window was
   * permanently solo — including the garage's own "Second window here (seat 2)" link. This
   * plugin only touches /api/drive.php and /api/state.php, only exists inside `vite dev`
   * (`apply: 'serve'` below), and adds nothing at all to the built bundle. */
  plugins: [{ ...wanderoadDevApi(), apply: 'serve' }],
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    host: true,
  },
});
