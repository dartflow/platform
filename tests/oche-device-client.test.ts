import test from 'node:test';
import assert from 'node:assert/strict';
import {canReplaceOcheDevice,captureOchePairCode,claimCapacity,formattedOcheUserCode,normaliseOcheUserCode,OCHE_PAIR_CODE_KEY,pairableOcheLocations,validOcheUserCode} from '../lib/oche-device-client';
import type {OcheManagement} from '../lib/oche-device-types';

test('Crockford user codes accept grouping and lower case without coercing arbitrary strings',()=>{
 assert.equal(normaliseOcheUserCode('k8g4–p7rw'),'K8G4P7RW');assert.equal(formattedOcheUserCode('k8g4 p7rw'),'K8G4–P7RW');assert.equal(validOcheUserCode('k8g4-p7rw'),true);assert.equal(normaliseOcheUserCode('o1il 2345'),'01112345');
 for(const input of ['','K8G4','K8G4P7RW9','K8G4P7RU','<script>','Ａ2345678'])assert.equal(validOcheUserCode(input),false,input);
});
test('QR code is captured and erased before a login return; no installation credential is carried',()=>{
 const values=new Map<string,string>(),order:string[]=[];const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{order.push('store');values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};
 const history={replaceState:(_data:unknown,_unused:string,url?:string|URL|null)=>{order.push(`erase:${url}`);}};
 assert.equal(captureOchePairCode({hash:'#code=k8g4-p7rw&installationSecret=never-import',pathname:'/koppel-scherm',search:''},history,storage),'K8G4P7RW');
 assert.deepEqual(order,['erase:/koppel-scherm','store']);assert.deepEqual([...values],[[OCHE_PAIR_CODE_KEY,'K8G4P7RW']]);
 assert.equal(captureOchePairCode({hash:'',pathname:'/koppel-scherm',search:''},history,storage),'K8G4P7RW');
 assert.equal(captureOchePairCode({hash:'#code=invalid',pathname:'/koppel-scherm',search:''},history,storage),'');assert.equal(values.size,0);
});
test('capacity selection is scoped and above-limit locations cannot offer replacement',()=>{
 const home={scope:'home' as const,locationId:null,name:'Thuis',maximum:1,active:1,reserved:0,aboveLimit:false};
 const location={scope:'location' as const,locationId:'location-1',name:'Club',maximum:2,active:3,reserved:0,aboveLimit:true,boards:[]};
 const context={home,locations:[location]} as unknown as OcheManagement;
 assert.equal(claimCapacity(context,'home','location-1'),home);assert.equal(claimCapacity(context,'location','location-1'),location);assert.equal(claimCapacity(context,'location','unknown'),undefined);
 assert.equal(canReplaceOcheDevice(home),true);assert.equal(canReplaceOcheDevice(location),false);assert.equal(canReplaceOcheDevice({...home,active:0}),false);assert.equal(canReplaceOcheDevice(undefined),false);
});
test('central limit-only venues are excluded from pairing while older compatible contexts remain usable',()=>{
 const base={scope:'location' as const,locationId:'own',name:'Eigen club',maximum:2,active:0,reserved:0,aboveLimit:false,boards:[]};
 const locations=[{...base,canManageScreens:true},{...base,locationId:'central-only',canManageScreens:false},{...base,locationId:'older-api'}];
 assert.deepEqual(pairableOcheLocations(locations).map(location=>location.locationId),['own','older-api']);assert.equal(locations.length,3,'limit administration keeps its complete context');
});
