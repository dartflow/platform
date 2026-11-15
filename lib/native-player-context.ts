import {AsyncLocalStorage} from 'node:async_hooks';
import type {NextRequest} from 'next/server';

/** Only the native API boundary may establish this context after authenticating a token.
 * Binding the context to the exact Request keeps it out of cookies, headers and other requests. */
export type NativePlayerPrincipal={request:NextRequest;id:string;claims:Record<string,unknown>|null};
const principals=new AsyncLocalStorage<NativePlayerPrincipal>();
export function nativePlayerPrincipal(request:NextRequest):NativePlayerPrincipal|null {
 const value=principals.getStore();return value?.request===request?value:null;
}
export function withNativePlayerPrincipal<T>(principal:NativePlayerPrincipal,run:()=>Promise<T>):Promise<T>{return principals.run(principal,run);}
