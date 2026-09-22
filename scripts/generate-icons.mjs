import { PNG } from 'pngjs';
import { mkdirSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'assets'), { recursive: true });

const clamp = value => Math.max(0, Math.min(255, Math.round(value)));
const smoothstep = value => value * value * (3 - 2 * value);

function icon(size, filename) {
  const png = new PNG({ width: size, height: size });
  const radius = size * .225;
  const margin = size * .055;
  const cx = size / 2;
  const cy = size / 2;
  const insideRoundRect = (x, y) => {
    const px = Math.max(margin + radius - x, 0, x - (size - margin - radius));
    const py = Math.max(margin + radius - y, 0, y - (size - margin - radius));
    return px * px + py * py <= radius * radius;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    if (!insideRoundRect(x, y)) { png.data[i + 3] = 0; continue; }
    const t = smoothstep((x + y) / (size * 2));
    png.data[i] = clamp(29 + 16 * t);
    png.data[i + 1] = clamp(88 + 36 * t);
    png.data[i + 2] = clamp(71 + 30 * t);
    png.data[i + 3] = 255;
    const dx = x - size * .74, dy = y - size * .23;
    if (dx * dx + dy * dy < size * size * .11) {
      png.data[i] += 5; png.data[i + 1] += 9; png.data[i + 2] += 7;
    }
  }
  const white = [246, 248, 242, 255];
  const paint = (x, y, alpha = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) png.data[i + c] = clamp(png.data[i + c] * (1 - alpha) + white[c] * alpha);
    png.data[i + 3] = 255;
  };
  const lineWidth = size * .058;
  const drawRoundedLine = (x1, y1, x2, y2, width) => {
    const minX = Math.floor(Math.min(x1, x2) - width), maxX = Math.ceil(Math.max(x1, x2) + width);
    const minY = Math.floor(Math.min(y1, y2) - width), maxY = Math.ceil(Math.max(y1, y2) + width);
    const vx = x2 - x1, vy = y2 - y1, len2 = vx * vx + vy * vy;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / len2));
      const dx = x - (x1 + t * vx), dy = y - (y1 + t * vy);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= width / 2 + 1) paint(x, y, Math.max(0, Math.min(1, width / 2 + 1 - distance)));
    }
  };
  drawRoundedLine(cx, size * .27, cx, size * .73, lineWidth);
  drawRoundedLine(size * .27, cy, size * .73, cy, lineWidth);
  drawRoundedLine(size * .69, size * .22, size * .69, size * .36, lineWidth * .33);
  drawRoundedLine(size * .62, size * .29, size * .76, size * .29, lineWidth * .33);
  png.pack().pipe(createWriteStream(resolve(root, 'assets', filename)));
}

icon(180, 'icon-180.png');
icon(192, 'icon-192.png');
icon(512, 'icon-512.png');
