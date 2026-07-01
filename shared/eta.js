/** Observed runtime ≈ 45s vs legacy ~2min UI estimates → scale all ETAs by this ratio. */
export const ETA_SCALE = 45 / 120;

export function scaleEta(ms) {
  return Math.max(2500, Math.round(ms * ETA_SCALE));
}

/** Legacy default job length before scaling (used as plan fallback). */
export const LEGACY_DEFAULT_ETA_MS = 90000;

export const ETA = {
  default: scaleEta(LEGACY_DEFAULT_ETA_MS),
  onboarding: scaleEta(120000),
  expandFunction: scaleEta(60000),
  sameness: scaleEta(45000),
  resolve: scaleEta(18000),
  research: scaleEta(42000),
  synthesize: scaleEta(55000),
};
