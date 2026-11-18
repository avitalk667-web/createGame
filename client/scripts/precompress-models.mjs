// PORTAL X — after `ng build`: a Brotli copy next to every 3D model in the built site (library.glb → library.glb.br).
// The server sends the .br copy to browsers that accept Brotli (Content-Encoding: br) and the original to the rest,
// so each model travels at about half its size. Lossless: the browser gets back the exact same bytes.
// Only the build output is touched; client/public keeps the original models unchanged.
//
//   node scripts/precompress-models.mjs [wwwroot]     (default: ../server/PortalX.Server/wwwroot)
import { readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(process.argv[2] ?? join(here, '../../server/PortalX.Server/wwwroot'));
const models = join(root, 'models');

function* glbFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* glbFiles(p);
    else if (e.name.toLowerCase().endsWith('.glb')) yield p;
  }
}

let before = 0, after = 0;
try { statSync(models); } catch { console.log(`[precompress] no models folder in ${root}, nothing to do`); process.exit(0); }
for (const file of glbFiles(models)) {
  const raw = readFileSync(file);
  const br = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_LGWIN]: 24,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  const target = file + '.br';
  // not worth it (< 5% smaller): no copy, the original is sent as is
  if (br.length > raw.length * 0.95) { rmSync(target, { force: true }); console.log(`[precompress] ${relative(root, file)}: skipped`); continue; }
  // (the server checks once that the copy unpacks to exactly this model before it ever sends it)
  writeFileSync(target, br);
  before += raw.length; after += br.length;
  console.log(`[precompress] ${relative(root, file)}: ${(raw.length / 1048576).toFixed(2)} MB → ${(br.length / 1048576).toFixed(2)} MB`);
}
if (before) console.log(`[precompress] models: ${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`);
