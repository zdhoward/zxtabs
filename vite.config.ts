import { defineConfig } from 'vite';

// Builds the browser extension into dist/: content.js (one self-contained script) plus
// everything in public/ (manifest, popup, icons). Load dist/ as an unpacked extension.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: { entry: 'src/content.ts', formats: ['iife'], name: 'zxtabs', fileName: () => 'content.js' },
  },
});
