import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The gateway serves the built app from `dist/` at same-origin `/`, so the app talks to
// the API with relative URLs (`/v1/...`) and there is NO CORS surface to open (Slice 7's
// single-instance model holds — the app is just static files the one gateway ships).
//
// In standalone dev (`pnpm --filter @querais/dashboard dev` on :5173) we proxy the API
// paths to a locally-running gateway (:8787) so the same relative URLs work without CORS.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    proxy: {
      '/v1': 'http://127.0.0.1:8787',
      '/health': 'http://127.0.0.1:8787',
      '/status': 'http://127.0.0.1:8787',
    },
  },
});
