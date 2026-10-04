import { defineConfig } from 'vite';

export default defineConfig({
  // BASE_PATH=/arrow-game/ bun run build for a GitHub Pages subpath build; default "/" serves from a domain root.
  base: process.env.BASE_PATH ?? '/',
  server: { port: 8000, strictPort: true },
  preview: { port: 8000, strictPort: true },
});
