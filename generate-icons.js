const fs = require('fs');
const zlib = require('zlib');

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createPNG(size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6; // RGBA
  const ihdr = createChunk('IHDR', ihdrData);

  const rawData = [];
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2;
  const innerR = size * 0.42;

  for (let y = 0; y < size; y++) {
    rawData.push(0);
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist < outerR) {
        const t = Math.min(dist / outerR, 1);
        const r = Math.round(108 + t * 10);
        const g = Math.round(99 - t * 10);
        const b = Math.round(255 - t * 20);
        const edge = Math.max(0, Math.min(1, (outerR - dist) * 2));
        rawData.push(r, g, b, Math.round(edge * 255));
      } else {
        rawData.push(0, 0, 0, 0);
      }
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(rawData));
  const idat = createChunk('IDAT', compressed);
  const iend = createChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

(async () => {
  try {
    const sharp = require('sharp');
    for (const size of sizes) {
      await sharp('public/logo.webp')
        .resize(size, size, { fit: 'contain', background: { r: 108, g: 99, b: 255, alpha: 1 } })
        .png()
        .toFile(`public/icons/icon-${size}.png`);
      console.log(`icon-${size}.png (sharp)`);
    }
  } catch(e) {
    console.log('sharp 실패, 기본 아이콘 생성...');
    for (const size of sizes) {
      const png = createPNG(size);
      fs.writeFileSync(`public/icons/icon-${size}.png`, png);
      console.log(`icon-${size}.png (기본)`);
    }
  }
  console.log('완료!');
})();
