const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '..', 'icon-32.png');
const outPath = path.join(__dirname, '..', 'favicon.ico');

if (!fs.existsSync(pngPath)) {
  console.error('Missing', pngPath);
  process.exit(2);
}

const png = fs.readFileSync(pngPath);
const pngSize = png.length;

// ICO header: reserved(2), type(2), count(2)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = 1 (icon)
header.writeUInt16LE(1, 4); // count = 1

// Directory entry (16 bytes): width(1), height(1), colorCount(1), reserved(1), planes(2), bitCount(2), bytesInRes(4), imageOffset(4)
const entry = Buffer.alloc(16);
entry.writeUInt8(32, 0); // width
entry.writeUInt8(32, 1); // height
entry.writeUInt8(0, 2); // color count
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bit count
entry.writeUInt32LE(pngSize, 8); // bytes in resource
entry.writeUInt32LE(header.length + entry.length, 12); // offset to image data

const out = Buffer.concat([header, entry, png]);
fs.writeFileSync(outPath, out);
console.log('Wrote', outPath, 'size', out.length);