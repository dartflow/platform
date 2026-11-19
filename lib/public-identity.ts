import {normalizeDisplayName,normalizeUsername,validDisplayName,validUsername} from './display-name';
export type PublicIdentityInput={id?:string;displayName?:string|null;username?:string|null};
/** Never inspect name/fullName/email: ambiguous legacy fields are private input. */
export function publicLabel(profile:PublicIdentityInput):string{
 const display=validDisplayName(profile.displayName)?normalizeDisplayName(profile.displayName):null;
 return display??(validUsername(profile.username)?`@${normalizeUsername(profile.username)}`:'Speler');
}
export function socialIdentityLabel(profile:PublicIdentityInput):string{
 const label=publicLabel(profile),handle=validUsername(profile.username)?normalizeUsername(profile.username):null;
 return handle&&!label.startsWith('@')?`${label} (@${handle})`:label;
}
export function publicIdentity<T extends PublicIdentityInput>(profile:T){
 return{id:profile.id??'',name:publicLabel(profile),displayName:validDisplayName(profile.displayName)?normalizeDisplayName(profile.displayName):null,username:validUsername(profile.username)?normalizeUsername(profile.username):null};
}
