/** Public labels are chosen separately from private account-holder names. */
export function normalizeDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFC').replace(/\s+/gu, ' ').trim() : '';
}
/** One canonical handle everywhere; a single leading @ is presentation syntax. */
export function normalizeUsername(value:unknown):string {
  if(typeof value!=='string')return '';
  const normalized=value.normalize('NFKC');
  return (normalized.startsWith('@')?normalized.slice(1):normalized).toLowerCase();
}
const forbiddenUsername=/[\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
export function validUsername(value:unknown):boolean {
  if(typeof value!=='string'||forbiddenUsername.test(value))return false;
  const username=normalizeUsername(value);
  return !username.startsWith('@')&&!forbiddenUsername.test(username)&&username.length>=1&&username.length<=80&&/[\p{L}\p{N}]/u.test(username)&&username!=='nieuwe speler';
}
export function validDisplayName(value: unknown): boolean {
  const name = normalizeDisplayName(value);
  return name.length >= 1 && name.length <= 80 && /[\p{L}\p{N}]/u.test(name)
    && !/[\p{Cc}\p{Cf}]/u.test(name) && name.toLocaleLowerCase('nl') !== 'nieuwe speler';
}
export function requiresDisplayName(profile: {name: string; username?:string|null;displayNameConfirmed?: boolean}): boolean {
  return profile.displayNameConfirmed !== true || !validUsername(profile.username);
}
export function hasConfirmedUsername(profile:{name:string;username?:string|null;displayNameConfirmed?:boolean}):boolean{
  return profile.displayNameConfirmed===true&&validUsername(profile.username);
}
