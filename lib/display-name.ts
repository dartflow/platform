/** Names are player-chosen labels, never an identity or authorization claim. */
export function normalizeDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
}
export function validDisplayName(value: unknown): boolean {
  const name = normalizeDisplayName(value);
  return name.length >= 1 && name.length <= 80 && /[\p{L}\p{N}]/u.test(name)
    && !/[\p{Cc}\p{Cf}]/u.test(name) && name.toLocaleLowerCase('nl') !== 'nieuwe speler';
}
export function requiresDisplayName(profile: {name: string; displayNameConfirmed?: boolean}): boolean {
  return profile.displayNameConfirmed === false || !validDisplayName(profile.name);
}
