/** Phase timeouts — tight ceilings; fail fast instead of hanging ~2min. */

export const PHASE_TIMEOUT = {
  resolve: 20000,
  research: 60000,
  synthesizePrimitive: 40000,
  synthesizeComposite: 90000,
};

export function synthesizeTimeoutMs(estimatedMs, composite = false) {
  const base = estimatedMs || 15000;
  const ceiling = composite ? PHASE_TIMEOUT.synthesizeComposite : PHASE_TIMEOUT.synthesizePrimitive;
  return Math.min(Math.max(base * 2, 20000), ceiling);
}

export function phaseClientAbortMs(phase) {
  return phase?.timeoutMs || PHASE_TIMEOUT.synthesizeComposite;
}
