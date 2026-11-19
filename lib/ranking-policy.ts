/** Changing a calculation requires a new published version; existing books keep this one. */
export const NATIONAL_RATING_POLICY = Object.freeze({
  version: 'national-x01-2026-11-v1',
  initialRating: 1500,
  k: 32,
  placementMatches: 10,
  placementOpponents: 5,
  activeDays: 90,
  freeMatchesPerWindow: 2,
  windowDays: 7,
});
