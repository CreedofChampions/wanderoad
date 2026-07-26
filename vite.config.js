import { defineConfig } from 'vite';

// Wanderoad ships as one static bundle: Base44 site hosting serves ./dist, and the
// same folder is rsynced to crumbtown.org. Relative base keeps it working from a
// sub-path (crumbtown.org/wanderoad/) as well as from a domain root.
export default defineConfig({
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
