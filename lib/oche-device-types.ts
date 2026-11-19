import type {ClubBoardScreenView} from './platform-types';

/** Public v1 contract. Credentials never appear in metadata, projections or QR URLs. */
export const OCHE_API_VERSION=1 as const;
export const OCHE_POLL_MS=2000;
export const OCHE_REVOCATION_BOUND_MS=5000;
export type OchePlatform='browser'|'android'|'android-tv';
export type OcheScope='home'|'location';
export type OchePairing={installationId:string;code:string;expiresAt:string;serverNow:number;verificationUrl:string;pollAfterMs:number;installationSecret?:string};
export type OchePairingStatus={state:'pending'|'approved'|'redeemed'|'expired'|'revoked';serverNow:number;expiresAt:string;pollAfterMs:number;pairing?:OchePairing};
export type OcheSession={deviceId:string;accessExpiresAt:string;refreshExpiresAt:string;accessToken?:string;refreshToken?:string};
export type OcheDevice={theme?:'dartflow'|'onzetrots';id:string;name:string;platform:OchePlatform;scope:OcheScope;locationId:string|null;locationName:string|null;boardId:string|null;boardName:string|null;lastSeenAt:string|null;online:boolean;createdAt:string;revoked:boolean;grantVersion:number};
export type OcheCapacity={scope:OcheScope;locationId:string|null;name:string;maximum:number;active:number;reserved:number;aboveLimit:boolean};
export type OcheLegacyDevice={id:string;name:string;scope:OcheScope;locationId:string;locationName:string;boardId:string;boardName:string;paired:boolean;expiresAt:string;lastSeenAt:string|null};
export type OcheManagement={serverNow:number;canManageLimits:boolean;home:OcheCapacity;locations:(OcheCapacity&{canManageScreens:boolean;boards:{id:string;name:string}[]})[];devices:OcheDevice[];legacyDevices:OcheLegacyDevice[];homeSessions:{id:string;name:string;kind:'match'|'lobby'|'training'|'play'|'play'}[];selectedHomeSessionId:string|null;defaultLocationMaximum:number};
export type OcheClaim={code:string;scope:OcheScope;name:string;locationId?:string;boardId?:string;replaceDeviceId?:string;requestId:string};
export type OcheClaimResult={state:'approved'|'redeemed';reservationId:string;expiresAt:string;capacity:OcheCapacity};
export type OcheDisplaySnapshot={
 apiVersion:1;serverNow:number;state:'unassigned'|'waiting'|'standby'|'reserved'|'closed'|'blocked'|'live'|'warning'|'result';
 scope:OcheScope;device:Pick<OcheDevice,'id'|'name'|'platform'|'grantVersion'>;
 location:{id:string;name:string}|null;board:{id:string;name:string}|null;
 /** Existing display allowlist; never contains account sessions or score authority. */
 display:ClubBoardScreenView|null;eventId:string;revision:number;pollAfterMs:number;
 permissions:{read:true;score:false;extend:false};
};
export type OcheEvents={apiVersion:1;eventId:string;reset:boolean;snapshot:OcheDisplaySnapshot};
