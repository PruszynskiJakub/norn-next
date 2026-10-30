/** Time helpers. Core never reads the clock; callers pass `facts.now`. */
export const iso = (ms: number): string => new Date(ms).toISOString();
export const epoch = (isoTime: string): number => Date.parse(isoTime);

/** Compact age: `45s`, `12m`, `3h`, `2d`. */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}
