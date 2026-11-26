import {createHash} from 'node:crypto';

/** Opaque public proof of the exact server-rendered article revision. */
export function blogPublicationMarker(origin:string,id:string,revision:string|number){
 return createHash('sha256').update(JSON.stringify(['dartflow-blog-publication-v1',origin,id,String(revision)])).digest('hex');
}
