import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const source = fileURLToPath(new URL('../web/public/rukn-logo.png', import.meta.url));
const logo = await readFile(source);
for (const size of [192, 512]) {
  const target = fileURLToPath(new URL(`../web/public/icon-${size}.png`, import.meta.url));
  const wordmark = await sharp(logo).resize({ width: Math.round(size * .85), height: Math.round(size * .54), fit: 'inside' }).toBuffer();
  const dimensions = await sharp(wordmark).metadata();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#f7f3eb' } })
    .composite([{ input: wordmark, left: Math.round((size - dimensions.width) / 2), top: Math.round((size - dimensions.height) / 2) }])
    .png().toFile(target);
}
