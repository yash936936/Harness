import { describe, expect, it } from 'vitest'
import { BoundedBase64Decoder, WorkspaceFindRecordParser } from '../src/bundles/sandbox-vercel/transfer-streams.js'

describe('bounded Vercel workspace transfer streams', () => {
  it('parses NUL-delimited metadata across arbitrary log boundaries', () => {
    const parser = new WorkspaceFindRecordParser(3)
    const entries: unknown[] = []
    const output = 'd\04096\0755\0src\0f\05\0644\0src/a file.txt\0'
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
    expect(() => parse('l\01\0777\0link\0')).toThrow(/symlinks and special files/)
    expect(() => parse('f\01\04755\0setuid\0')).toThrow(/privileged remote file mode/)
    expect(() => parse('f\01\0600\0.env.local\0')).toThrow(/remote path is not allowed/)
    expect(() => parse('f\01\0600\0a\0f\01\0600\0b\0', 1)).toThrow(/entry count/)
    expect(() => parse('f\01\0600\0a\0f\01')).toThrow(/truncated record/)
    expect(() => parse('f\01\0600\0b\0f\01\0600\0a\0')).toThrow(/not unique and lexicographically sorted/)
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
