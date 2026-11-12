export const OCHE_STANDBY_DURATIONS = [5000, 10000, 15000] as const;
export const OCHE_STANDBY_CYCLE = 30000;
/** A single monotonic elapsed time drives slides and progress, including hidden-tab resume. */
export function ocheStandbyFrame(elapsed: number): {index: 0|1|2; progress: number; elapsed: number; duration: number; cycle: number} {
  const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  let offset = time % OCHE_STANDBY_CYCLE;
  const cycle = Math.floor(time / OCHE_STANDBY_CYCLE);
  for (let index = 0; index < OCHE_STANDBY_DURATIONS.length; index++) {
    const duration = OCHE_STANDBY_DURATIONS[index];
    if (offset < duration) return {index: index as 0|1|2, progress: offset / duration, elapsed: offset, duration, cycle};
    offset -= duration;
  }
  return {index: 0, progress: 0, elapsed: 0, duration: 5000, cycle};
}
