// Copies the Draco + Basis (KTX2) decoder binaries that GLTFLoader needs at
// runtime from the three.js package into public/libs so Vite can serve them.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'node_modules/three/examples/jsm/libs');
const dst = join(root, 'public/libs');

for (const dir of ['draco', 'basis']) {
  const from = join(src, dir);
  const to = join(dst, dir);
  if (!existsSync(from)) {
    console.warn(`[copy-decoders] missing ${from} — run npm install first`);
    continue;
  }
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}
console.log('[copy-decoders] Draco + Basis decoders copied to public/libs');
