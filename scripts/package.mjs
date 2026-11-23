// Zip dist/ into release/zxtabs-<version>.zip for a GitHub release or the Chrome Web Store.
// Pure Node (deflate from zlib, zip headers written by hand). Usage: npm run package

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

const { version } = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const files = (function walk(dir) {
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
})('dist');
if (!files.length) throw new Error('dist/ is empty: run `npm run build` first');

const local = [], central = [];
let offset = 0;
for (const file of files) {
  const name = Buffer.from(relative('dist', file).replaceAll('\\', '/'));
  const data = readFileSync(file);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  // Fixed fields shared by the local and central headers: version, flags, method 8 (deflate),
  // time/date (fixed at 1980-01-01 so the zip is reproducible), crc, sizes, name and extra lengths.
  const common = Buffer.alloc(26);
  common.writeUInt16LE(20, 0); common.writeUInt16LE(0, 2); common.writeUInt16LE(8, 4);
  common.writeUInt16LE(0, 6); common.writeUInt16LE(0x21, 8); common.writeUInt32LE(crc, 10);
  common.writeUInt32LE(packed.length, 14); common.writeUInt32LE(data.length, 18);
  common.writeUInt16LE(name.length, 22); common.writeUInt16LE(0, 24);
  const sig = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  local.push(sig(0x04034b50), common, name, packed);
  const tail = Buffer.alloc(14); // comment length, disk, internal attrs, external attrs, offset
  tail.writeUInt32LE(offset, 10);
  central.push(sig(0x02014b50), Buffer.from([20, 0]), common, tail, name);
  offset += 30 + name.length + packed.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);

mkdirSync('release', { recursive: true });
const out = `release/zxtabs-${version}.zip`;
writeFileSync(out, Buffer.concat([...local, cd, end]));
console.log(`${out} (${files.length} files)`);
