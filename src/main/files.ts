// The filesystem edge: the only place a book file is read or written, and the
// only place a try/catch guards those calls — each converted immediately into a
// Result so the rest of main stays exception-free.

import { readFile, writeFile } from "node:fs/promises"

import type { FileError } from "../shared/ipc-contract"
import { err, ok } from "../shared/result"
import type { Result } from "../shared/result"

export async function readBookFile(
  path: string,
): Promise<Result<string, FileError>> {
  try {
    const content = await readFile(path, "utf8")

    return ok(content)
  } catch (caught) {
    return err({ kind: "read-failed", path, message: messageOf(caught) })
  }
}

export async function writeBookFile(
  path: string,
  content: string,
): Promise<Result<void, FileError>> {
  try {
    await writeFile(path, content, "utf8")

    return ok(undefined)
  } catch (caught) {
    return err({ kind: "write-failed", path, message: messageOf(caught) })
  }
}

function messageOf(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message
  }

  return String(caught)
}
