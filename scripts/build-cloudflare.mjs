import { build } from 'esbuild';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const output = new URL('../cloudflare/assets-generated.mjs', import.meta.url);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const assets = {};
async function scan(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (entry.isFile() && extname(path) !== '.woff') {
      const name = '/' + relative(root, path).split(sep).join('/');
      assets[name] = { type: mime[extname(path)] || 'application/octet-stream', data: (await readFile(path)).toString('base64') };
    }
  }
}
await scan(root);
await writeFile(output, `export const assets = ${JSON.stringify(assets)};\n`);
await build({ entryPoints: [fileURLToPath(new URL('../cloudflare/index.mjs', import.meta.url))],
  outfile: fileURLToPath(new URL('../.private/cloudflare-worker.mjs', import.meta.url)),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, external: ['node:*'] });
console.log(`Cloudflare bundle ready with ${Object.keys(assets).length} assets.`);
