import { inflateRawSync } from 'node:zlib';

/**
 * Reads individual members of a remote ZIP archive using HTTP Range requests, so we can pull a few
 * hundred bill XML files out of the ~1.2 GB California "pubinfo" session archive without downloading
 * all of it. Supports ZIP64 end-of-central-directory records (the archive has >65535 entries).
 */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export type RangeFetcher = (start: number, endInclusive: number) => Promise<Buffer>;

export function httpRangeFetcher(url: string): RangeFetcher & { size(): Promise<number> } {
  const fetcher = async (start: number, end: number): Promise<Buffer> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
        if (res.status !== 206) throw new Error(`expected 206 Partial Content, got ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        if (attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  };
  fetcher.size = async () => {
    const res = await fetch(url, { method: 'HEAD' });
    const len = Number(res.headers.get('content-length'));
    if (!Number.isFinite(len) || len <= 0) throw new Error(`could not determine size of ${url}`);
    return len;
  };
  return fetcher;
}

/** Locates and returns the raw central directory bytes given the archive's total size. */
export async function readCentralDirectory(fetchRange: RangeFetcher, totalSize: number): Promise<Buffer> {
  const tailLen = Math.min(totalSize, 65_536 + 22);
  const tail = await fetchRange(totalSize - tailLen, totalSize - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('end of central directory not found');
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  const z64 = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  if (z64 >= 0) {
    cdSize = Number(tail.readBigUInt64LE(z64 + 40));
    cdOffset = Number(tail.readBigUInt64LE(z64 + 48));
  }
  return fetchRange(cdOffset, cdOffset + cdSize - 1);
}

export function parseCentralDirectory(cd: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    let compressedSize = cd.readUInt32LE(p + 20);
    let uncompressedSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    let localHeaderOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
    // ZIP64 extended information extra field (id 0x0001) carries 64-bit sizes/offsets when needed.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.readUInt16LE(e);
      const size = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (localHeaderOffset === 0xffffffff) { localHeaderOffset = Number(cd.readBigUInt64LE(q)); }
      }
      e += 4 + size;
    }
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p = extraEnd + commentLen;
  }
  return entries;
}

/** Fetches and decompresses one member. One range request covers header + data (with slack). */
export async function readEntry(fetchRange: RangeFetcher, entry: ZipEntry): Promise<Buffer> {
  const slack = 30 + entry.name.length + 512;
  const start = entry.localHeaderOffset;
  let buf = await fetchRange(start, start + slack + entry.compressedSize - 1);
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`);
  const dataStart = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  if (dataStart + entry.compressedSize > buf.length) {
    buf = await fetchRange(start, start + dataStart + entry.compressedSize - 1);
  }
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);
}
