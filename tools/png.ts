/**
 * Minimal PNG encoder for debug artefacts.
 *
 * The compute core is headless typed arrays, so the only way to judge whether a
 * DEM has real valleys or a connectivity map has the right shape is to look at
 * it. Node ships zlib, and a greyscale/RGB PNG is a short header plus one
 * deflate stream, so this needs no dependency.
 */

import { deflateSync } from "node:zlib";

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);

  const body = new Uint8Array(typeBytes.length + payload.length);
  body.set(typeBytes, 0);
  body.set(payload, 4);

  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
}

/** Encode RGB bytes (3 per pixel, row-major) as a PNG. */
export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // 10-12: compression, filter and interlace methods, all zero.

  // One filter byte per scanline; filter type 0 (None) keeps this simple, and
  // deflate still compresses the result perfectly well for debug output.
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let row = 0; row < height; row++) {
    const src = row * width * 3;
    const dst = row * (1 + width * 3);
    raw[dst] = 0;
    raw.set(rgb.subarray(src, src + width * 3), dst + 1);
  }

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
