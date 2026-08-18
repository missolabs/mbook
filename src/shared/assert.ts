// The one sanctioned throw, shared by every process: a `default: return
// assertNever(x)` on an exhaustive switch turns "added a variant, forgot a case"
// into a compile error. The reached path is provably unreachable at runtime.
export function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`)
}
