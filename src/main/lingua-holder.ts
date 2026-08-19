// The composition root's seam to the loaded lexicons: index.ts fills it once at
// boot and later steps (IPC handlers, the analysis engine) read it. A single
// mutable cell owned by the root — not ambient state reached for from anywhere —
// so the engine is injectable and, until it loads, plainly absent.

import type { Optional } from "../shared/optional"
import type { Lingua } from "./lingua"

let held: Optional<Lingua> = { kind: "none" }

export function setLingua(lingua: Lingua): void {
  held = { kind: "some", value: lingua }
}

export function getLingua(): Optional<Lingua> {
  return held
}
