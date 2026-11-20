import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = fileURLToPath(new URL('../web/public/icon.svg', import.meta.url));
const svg = await readFile(source);
for (const size of [192, 512]) {
  const target = fileURLToPath(new URL(`../web/public/icon-${size}.png`, import.meta.url));
  await sharp(svg).resize(size, size).png().toFile(target);
}
