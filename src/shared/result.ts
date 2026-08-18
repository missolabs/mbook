// Result<T, E>: the single fallible-value type. `E` is always a discriminated
// union with a `kind`. try/catch appears only at module boundaries (fs, native),
// immediately becoming a Result.

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
