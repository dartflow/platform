import type {ClubBoardScreenView} from './platform-types';

/** Public v1 contract. Credentials never appear in metadata, projections or QR URLs. */
export const OCHE_API_VERSION=1 as const;
export const OCHE_POLL_MS=2000;
export const OCHE_REVOCATION_BOUND_MS=5000;
export type OchePlatform='browser'|'android'|'android-tv';
export type OcheScope='home'|'location';
export type OcheLayout={orientation:'portrait'|'landscape';scoreboards:1|2};
export type OchePairing={installationId:string;code:string;expiresAt:string;serverNow:number;verificationUrl:string;pollAfterMs:number;installationSecret?:string;layoutProposal?:OcheLayout|null;targetDeviceId?:string|null};
export type OchePairingStatus={state:'pending'|'approved'|'redeemed'|'expired'|'revoked';serverNow:number;expiresAt:string;pollAfterMs:number;pairing?:OchePairing};
export type OcheSession={deviceId:string;accessExpiresAt:string;refreshExpiresAt:string;accessToken?:string;refreshToken?:string};
export type OcheDevice={layout?:OcheLayout|null;secondaryBoardId?:string|null;secondaryBoardName?:string|null;configurationRevision?:number;theme?:'dartflow'|'onzetrots';id:string;name:string;platform:OchePlatform;scope:OcheScope;locationId:string|null;locationName:string|null;boardId:string|null;boardName:string|null;lastSeenAt:string|null;online:boolean;createdAt:string;revoked:boolean;grantVersion:number};
export type OcheCapacity={scope:OcheScope;locationId:string|null;name:string;maximum:number;active:number;reserved:number;aboveLimit:boolean};
export type OcheLegacyDevice={id:string;name:string;scope:OcheScope;locationId:string;locationName:string;boardId:string;boardName:string;paired:boolean;expiresAt:string;lastSeenAt:string|null};
export type OcheManagement={layoutSupport?:boolean;serverNow:number;canManageLimits:boolean;home:OcheCapacity;locations:(OcheCapacity&{canManageScreens:boolean;boards:{id:string;name:string}[]})[];devices:OcheDevice[];legacyDevices:OcheLegacyDevice[];homeSessions:{id:string;name:string;kind:'match'|'lobby'|'training'}[];selectedHomeSessionId:string|null;defaultLocationMaximum:number};
export type OcheClaim={layout?:OcheLayout;secondaryBoardId?:string|null;expectedRevision?:number;code:string;scope:OcheScope;name:string;locationId?:string;boardId?:string;replaceDeviceId?:string;requestId:string};
export type OcheClaimResult={state:'approved'|'redeemed';reservationId:string;expiresAt:string;capacity:OcheCapacity};
export type OcheDisplaySnapshot={
 layout?:OcheLayout|null;configurationRevision?:number;panels?:OcheDisplayPanel[];
 apiVersion:1;serverNow:number;state:'unassigned'|'waiting'|'standby'|'reserved'|'closed'|'blocked'|'live'|'warning'|'result';
 scope:OcheScope;device:Pick<OcheDevice,'id'|'name'|'platform'|'grantVersion'>;
 location:{id:string;name:string}|null;board:{id:string;name:string}|null;
 /** Existing display allowlist; never contains account sessions or score authority. */
 display:ClubBoardScreenView|null;eventId:string;revision:number;pollAfterMs:number;
 permissions:{read:true;score:false;extend:false};
};
export type OcheEvents={apiVersion:1;eventId:string;reset:boolean;snapshot:OcheDisplaySnapshot};

/** Opt-in v1 extension. A failed lane never supplies a stale playable QR. */
export type OcheDisplayPanel={position:'left'|'right';sourceId:string|null;status:'ready'|'unassigned'|'unavailable'|'error';snapshot:OcheDisplaySnapshot|null};
export type OcheLayoutProposal={layoutProposal:OcheLayout|null;targetDeviceId:string|null;device?:OcheDevice|null};
