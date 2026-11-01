// Desktop development: the Vite dev server with hot reload, inside the
// Electron shell, so disk saves work while editing. `npm run desktop:dev`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite did not report a local URL.');
const electron = spawn(require('electron'), ['.'], { stdio: 'inherit', env: { ...process.env, OG_DEV_URL: url.replace(/\/$/, '') } });
electron.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
