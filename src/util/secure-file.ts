import { constants, lstatSync, openSync, fstatSync, readFileSync, closeSync } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, parse, resolve, sep, join } from 'node:path'

function parentParts(path: string): string[] {
  const absolute = resolve(path)
  const root = parse(absolute).root
  const parent = dirname(absolute)
  const relative = parent.slice(root.length)
  const parts = relative.split(sep).filter(Boolean)
  const out: string[] = []
  let current = root
  for (const part of parts) {
    current = join(current, part)
    out.push(current)
  }
  return out
}

/** Refuse symlinked or non-directory ancestors of a persistent state file. */
export async function assertNoSymlinkParents(path: string): Promise<void> {
  for (const parent of parentParts(path)) {
    try {
      const st = await lstat(parent)
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`state path parent is not a real directory: ${parent}`)
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      throw error
    }
  }
}

/** Synchronous counterpart for constructors that load persisted limits before startup. */
export function assertNoSymlinkParentsSync(path: string): void {
  for (const parent of parentParts(path)) {
    try {
      const st = lstatSync(parent)
      if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`state path parent is not a real directory: ${parent}`)
    } catch (error: any) {
      if (error?.code === 'ENOENT') return
      throw error
    }
  }
}

async function openExisting(path: string) {
  await assertNoSymlinkParents(path)
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`state file is not a regular non-symlink file: ${path}`)
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const handle = await open(path, constants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    const after = await lstat(path)
    if (!after.isFile() || after.isSymbolicLink() ||
        (opened.ino !== 0 && (opened.ino !== after.ino || opened.dev !== after.dev))) {
      throw new Error(`state file changed while opening: ${path}`)
    }
    await assertNoSymlinkParents(path)
    return handle
  } catch (error) {
    await handle.close().catch(() => {})
    throw error
  }
}

export async function readTextFileNoFollow(path: string): Promise<string> {
  const handle = await openExisting(path)
  try { return await handle.readFile({ encoding: 'utf8' }) }
  finally { await handle.close() }
}

export async function readBufferFileNoFollow(path: string): Promise<Buffer> {
  const handle = await openExisting(path)
  try { return await handle.readFile() }
  finally { await handle.close() }
}

function openExistingSync(path: string): number {
  assertNoSymlinkParentsSync(path)
  const before = lstatSync(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`state file is not a regular non-symlink file: ${path}`)
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const fd = openSync(path, constants.O_RDONLY | noFollow)
  try {
    const opened = fstatSync(fd)
    const after = lstatSync(path)
    if (!after.isFile() || after.isSymbolicLink() ||
        (opened.ino !== 0 && (opened.ino !== after.ino || opened.dev !== after.dev))) {
      throw new Error(`state file changed while opening: ${path}`)
    }
    assertNoSymlinkParentsSync(path)
    return fd
  } catch (error) {
    closeSync(fd)
    throw error
  }
}

export function readTextFileSyncNoFollow(path: string): string {
  const fd = openExistingSync(path)
  try { return readFileSync(fd, 'utf8') }
  finally { closeSync(fd) }
}

export function readBufferFileSyncNoFollow(path: string): Buffer {
  const fd = openExistingSync(path)
  try { return readFileSync(fd) }
  finally { closeSync(fd) }
}
