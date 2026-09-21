import { Buffer } from 'node:buffer';
import { crc32, deflateSync } from 'node:zlib';

// A purpose-built amber shield with dark code brackets, distinct even at 16px.
// Generate PNGs at their native sizes; production icons are never modified.
export function developmentIcon(size) {
  const pixels = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size;
      const py = (y + 0.5) / size;
      const shield = py >= 0.08 && py < 0.94 && Math.abs(px - 0.5) < (py < 0.62 ? 0.39 : (0.94 - py) * 1.22);
      if (!shield) continue;
      const bracket = py > 0.27 && py < 0.61 && Math.abs(Math.abs(px - 0.5) - (0.23 - Math.abs(py - 0.44))) < 0.04;
      const i = y * (1 + size * 4) + 1 + x * 4;
      pixels.set(bracket ? [17, 24, 39, 255] : [245, 158, 11, 255], i);
    }
  }
  function chunk(type, data) {
    const name = Buffer.from(type);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([header, name, data, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
