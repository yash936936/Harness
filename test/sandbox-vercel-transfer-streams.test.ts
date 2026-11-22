import { describe, expect, it } from 'vitest'
import { BoundedBase64Decoder, WorkspaceFindRecordParser } from '../src/bundles/sandbox-vercel/transfer-streams.js'

const nul = String.fromCharCode(0)
const record = (kind: string, size: string, mode: string, path: string) =>
  [kind, size, mode, path, ''].join(nul)

describe('bounded Vercel workspace transfer streams', () => {
  it('parses NUL-delimited metadata across arbitrary log boundaries', () => {
    const parser = new WorkspaceFindRecordParser(3)
    const entries: unknown[] = []
    const output = record('d', '4096', '755', 'src') +
      record('f', '5', '644', 'src/a file.txt')
    for (let offset = 0; offset < output.length; offset += 3) {
      parser.push(output.slice(offset, offset + 3), (entry) => entries.push(entry))
    }
    parser.finish()
    expect(entries).toEqual([
      { path: 'src', kind: 'directory', sizeBytes: 0, mode: 0o755 },
      { path: 'src/a file.txt', kind: 'file', sizeBytes: 5, mode: 0o644 },
    ])
  })

  it('rejects links, special files, secret paths, privileged modes, and oversized enumeration', () => {
    const parse = (value: string, maxEntries = 10) => {
      const parser = new WorkspaceFindRecordParser(maxEntries)
      parser.push(value, () => {})
      parser.finish()
    }
    expect(() => parse(record('l', '1', '777', 'link'))).toThrow(/symlinks and special files/)
    expect(() => parse(record('f', '1', '4755', 'setuid'))).toThrow(/privileged remote file mode/)
    expect(() => parse(record('f', '1', '600', '.env.local'))).toThrow(/remote path is not allowed/)
    expect(() => parse(record('f', '1', '600', 'a') + record('f', '1', '600', 'b'), 1)).toThrow(/entry count/)
    expect(() => parse('f' + nul + '1')).toThrow(/truncated record/)
    expect(() => parse(record('f', '1', '600', 'b') + record('f', '1', '600', 'a'))).toThrow(/not unique and lexicographically sorted/)
  })

  it('decodes base64 incrementally into chunks no larger than the configured byte limit', () => {
    const source = Buffer.from(Array.from({ length: 4_097 }, (_, index) => (index * 37) % 256))
    const encoded = source.toString('base64')
    const decoder = new BoundedBase64Decoder(31, source.byteLength)
    const chunks: Uint8Array[] = []
    for (let offset = 0; offset < encoded.length; offset += 17) {
      decoder.push(encoded.slice(offset, offset + 17), (chunk) => chunks.push(chunk))
    }
    decoder.finish((chunk) => chunks.push(chunk))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.byteLength <= 31)).toBe(true)
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))).toEqual(source)
    expect(decoder.bytesDecoded).toBe(source.byteLength)
  })

  it('handles empty files and rejects malformed, truncated, or over-limit streams', () => {
    const empty = new BoundedBase64Decoder(12, 0)
    expect(() => empty.finish(() => { throw new Error('empty stream emitted bytes') })).not.toThrow()
    expect(empty.bytesDecoded).toBe(0)

    const malformed = new BoundedBase64Decoder(12, 100)
    expect(() => malformed.push('%%%=', () => {})).toThrow(/invalid characters/)

    const truncated = new BoundedBase64Decoder(12, 100)
    truncated.push('YWJjZ', () => {})
    expect(() => truncated.finish(() => {})).toThrow(/truncated/)

    const oversized = new BoundedBase64Decoder(12, 2)
    oversized.push('YWJj', () => {})
    expect(() => oversized.finish(() => {})).toThrow(/exceed the configured limit/)
  })
})
