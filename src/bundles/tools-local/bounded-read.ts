/** The part of a file handle the bounded reader needs (lets tests supply a handle that misbehaves). */
export interface ReadHandle {
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
}

export class FileTooLarge extends Error {
  override name = 'FileTooLarge'
}

/**
 * BUG-04: read at most `max` bytes, enforcing the limit WHILE reading. A stat-then-readFile check is a
 * race: a file that grows in between is read whole. Here the loop stops at `max + 1` bytes, so memory
 * use is bounded no matter what the file does.
 */
export async function readBounded(fh: ReadHandle, max: number): Promise<Buffer> {
  const buf = Buffer.allocUnsafe(max + 1)
  let total = 0
  while (total < buf.length) {
    const { bytesRead } = await fh.read(buf, total, buf.length - total, total)
    if (bytesRead === 0) break
    total += bytesRead
  }
  if (total > max) throw new FileTooLarge(`file is larger than the ${max}-byte limit`)
  return buf.subarray(0, total)
}
