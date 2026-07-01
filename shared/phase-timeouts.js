/** Phase timeouts — generous ceilings; actual runs are usually faster. */

export const PHASE_TIMEOUT = {
  resolve: 60000,
  research: 180000,
  synthesizePrimitive: 120000,
  synthesizeComposite: 180000,
};

export function phaseClientAbortMs(phase) {
  return phase?.timeoutMs || PHASE_TIMEOUT.synthesizeComposite;
}
