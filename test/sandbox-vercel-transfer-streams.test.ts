import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BoundedBase64Decoder, WorkspaceFindRecordParser, writeWorkspaceTransferFileToStdin, type WorkspaceStdinCommand } from '../src/bundles/sandbox-vercel/transfer-streams.js'
import type { WorkspaceTransferFile, WorkspaceTransferLimits } from '../src/architecture/contracts.js'

const nul = String.fromCharCode(0)
const record = (kind: string, size: string, mode: string, path: string) =>
  [kind, size, mode, path, ''].join(nul)

describe('bounded Vercel workspace transfer streams', () => {
  it('enforces hard ceilings when constructing stream parsers', () => {
    expect(() => new WorkspaceFindRecordParser(100_001)).toThrow(/maxEntries/)
    expect(() => new BoundedBase64Decoder(1_048_577, 10)).toThrow(/invalid base64 decoder limits/)
    expect(() => new BoundedBase64Decoder(3, 536_870_913)).toThrow(/invalid base64 decoder limits/)
  })

  it('parses NUL-delimited metadata across arbitrary log boundaries', () => {
    const parser = new WorkspaceFindRecordParser(3)
    const entries: unknown[] = []
    const output = record('d', '0', '755', 'src') +
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
    expect(() => parse(record('d', '1', '755', 'directory'))).toThrow(/invalid remote file size/)
    expect(() => parse(record('f', '1', '600', '.env.local'))).toThrow(/remote path is not allowed/)
    expect(() => parse(record('f', '1', '600', 'a') + record('f', '1', '600', 'b'), 1)).toThrow(/entry count/)
    expect(() => parse('f' + nul + '1')).toThrow(/truncated record/)
    expect(() => parse(record('f', '1', '600', 'b') + record('f', '1', '600', 'a'))).toThrow(/not unique and lexicographically sorted/)
    expect(() => parse(record('f', '1', '600', 'a') + record('f', '1', '600', 'a/child'))).toThrow(/file path is also used as a directory/)
    expect(() => parse(record('d', '0', '755', 'Src') + record('f', '1', '600', 'src/file'))).toThrow(/case-insensitive collision/)
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

    const nonCanonical = new BoundedBase64Decoder(12, 100)
    nonCanonical.push('YR==', () => {})
    expect(() => nonCanonical.finish(() => {})).toThrow(/not canonical/)
  })
})


describe('bounded workspace stdin uploads', () => {
  const limits: WorkspaceTransferLimits = {
    maxFiles: 4,
    maxEntries: 8,
    maxFileBytes: 64,
    maxTotalBytes: 128,
    chunkBytes: 8,
  }

  function file(path: string, source: Uint8Array, chunks?: readonly Uint8Array[]): WorkspaceTransferFile {
    const parts = chunks ?? [source]
    return {
      path,
      sizeBytes: source.byteLength,
      sha256: createHash('sha256').update(source).digest('hex'),
      chunks: (async function* () {
        let offset = 0
        for (const bytes of parts) {
          yield { offset, bytes }
          offset += bytes.byteLength
        }
      })(),
    }
  }

  function command(options: { failWrite?: boolean; exitCode?: number } = {}) {
    const writes: Uint8Array[] = []
    const calls: string[] = []
    const fake: WorkspaceStdinCommand = {
      async writeStdin(bytes) {
        calls.push('write')
        if (options.failWrite) throw new Error('stdin write failed')
        writes.push(new Uint8Array(bytes))
      },
      async closeStdin() { calls.push('close') },
      async wait() { calls.push('wait'); return { exitCode: options.exitCode ?? 0 } },
      async kill() { calls.push('kill') },
    }
    return { fake, writes, calls }
  }

  it('streams bounded chunks in order and closes stdin after digest verification', async () => {
    const source = Buffer.from('0123456789abcdef')
    const target = command()
    await writeWorkspaceTransferFileToStdin(
      file('src/data.bin', source, [source.subarray(0, 8), source.subarray(8)]),
      target.fake,
      limits,
    )
    expect(Buffer.concat(target.writes.map((part) => Buffer.from(part)))).toEqual(source)
    expect(target.calls).toEqual(['write', 'write', 'close', 'wait'])
  })

  it('rejects a digest mismatch and terminates the partial staging writer', async () => {
    const source = Buffer.from('payload')
    const target = command()
    const invalid = { ...file('src/data.bin', source), sha256: '0'.repeat(64) }
    await expect(writeWorkspaceTransferFileToStdin(invalid, target.fake, limits)).rejects.toThrow(/SHA-256 mismatch/)
    expect(target.calls).toContain('kill')
    expect(target.calls).toContain('wait')
    expect(target.calls).not.toContain('close')
  })

  it('rejects invalid chunk sizes and upload paths before sending bytes', async () => {
    const source = Buffer.from('payload')
    const oversized = file('src/data.bin', source, [Buffer.from('012345678')])
    const target = command()
    await expect(writeWorkspaceTransferFileToStdin(oversized, target.fake, limits)).rejects.toThrow(/chunk is empty or exceeds/)
    expect(target.calls).toEqual(['kill', 'close', 'wait'])
    const secret = command()
    await expect(writeWorkspaceTransferFileToStdin(file('.env', source), secret.fake, limits)).rejects.toThrow(/path is not allowed/)
    expect(secret.calls).toEqual([])
  })

  it('fails when the remote writer exits unsuccessfully', async () => {
    const source = Buffer.from('payload')
    const target = command({ exitCode: 2 })
    await expect(writeWorkspaceTransferFileToStdin(file('src/data.bin', source), target.fake, limits)).rejects.toThrow(/exited with code 2/)
    expect(target.calls).toEqual(['write', 'close', 'wait'])
  })

  it('kills and waits for the writer when stdin transport fails', async () => {
    const source = Buffer.from('payload')
    const target = command({ failWrite: true })
    await expect(writeWorkspaceTransferFileToStdin(file('src/data.bin', source), target.fake, limits)).rejects.toThrow(/stdin write failed/)
    expect(target.calls).toEqual(['write', 'kill', 'close', 'wait'])
  })
})
