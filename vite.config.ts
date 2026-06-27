import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Frontend dev server proxies /api/* to the local Node proxy (server/index.js).
// In production the same Express app serves the built assets, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Don't watch non-source asset folders (reference images, build output).
    // On Windows these PNGs can be locked by another app, and vite's file
    // watcher crashes the whole dev server with EBUSY when it tries to watch
    // a locked file. They aren't source, so ignore them entirely.
    watch: {
      ignored: [
        '**/样式对比/**',
        '**/六种样式/**',
        '**/影画样式*/**',
        '**/dist/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
