import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) }, // shown on the title screen
  // BASE_PATH=/arrow-game/ bun run build for a GitHub Pages subpath build; default "/" serves from a domain root.
  base: process.env.BASE_PATH ?? '/',
  server: { port: 8000, strictPort: true },
  preview: { port: 8000, strictPort: true },
});
