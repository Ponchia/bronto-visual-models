/**
 * The lifecycle every engine hook shares (`useVegaSurface`, `useVisTimeline`).
 * It is written once, here; the hooks' own options add only what they draw.
 */
export interface EngineLifecycle {
  /** Optional host instrumentation: acquire once per engine; release on disposal. */
  onAcquire?(): () => void;
  /**
   * Inactive: no draws and no acknowledgements, engine retained. Work asked for
   * meanwhile is dropped, and activation applies the current data and size to
   * the retained engine, then attests the frame it drew.
   */
  active: boolean;
  /**
   * Attests a drawn frame: pass the adapter's `useFrameAck(props)`. The hook
   * keeps the acknowledgement it had when it began drawing and calls it once
   * that drawing is on screen, and again when the acknowledgement changes, after
   * applying the data, so a new frame is attested showing its own data. Omit it
   * while the frame cannot be current, for example while its source is pending.
   * Withdrawal suppresses pending callbacks and explicit re-attestation until
   * the host supplies readiness again. Hidden or disposed surfaces do not call
   * host draw/error instrumentation; a retained frame is observed on activation.
   */
  onReady?(): void;
  /** Called before the hook changes what the engine shows. */
  onInvalidate?(): void;
}
