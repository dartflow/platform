/** Names are player-chosen labels, never an identity or authorization claim. */
export function normalizeDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
}
/** A single leading @ is presentation syntax, never part of the canonical handle. */
export function normalizeUsername(value:unknown):string {
  const normalized=normalizeDisplayName(value);
  return normalized.startsWith('@')?normalizeDisplayName(normalized.slice(1)):normalized;
}
export function validUsername(value:unknown):boolean {
  const username=normalizeUsername(value);
  return !username.startsWith('@')&&validDisplayName(username);
}
export function validDisplayName(value: unknown): boolean {
  const name = normalizeDisplayName(value);
  return name.length >= 1 && name.length <= 80 && /[\p{L}\p{N}]/u.test(name)
    && !/[\p{Cc}\p{Cf}]/u.test(name) && name.toLocaleLowerCase('nl') !== 'nieuwe speler';
}
export function requiresDisplayName(profile: {name: string; username?:string;displayNameConfirmed?: boolean}): boolean {
  return profile.displayNameConfirmed === false || !validUsername(profile.username??profile.name);
}
/** The server-owned confirmation flag is backed by the global unique username index. */
export function hasConfirmedUsername(profile:{name:string;username?:string;displayNameConfirmed?:boolean}):boolean{
  return profile.displayNameConfirmed===true&&validUsername(profile.username??profile.name);
}
