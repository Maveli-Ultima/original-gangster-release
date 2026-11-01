import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// The release version, shown on the menu and in the credits for bug reports.
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { port: 5180, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
