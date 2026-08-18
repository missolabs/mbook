// Explicit "maybe" so no field is optional and no `??`/`?.` is ever needed.
export type Optional<T> =
  | { kind: "some"; value: T }
  | { kind: "none" }

// Generic acknowledgement for write-only operations.
export type Ack = { kind: "ok" }
