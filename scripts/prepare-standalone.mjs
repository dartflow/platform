import {cp,readdir,rm} from 'node:fs/promises';
const target=new URL('../.next/standalone/',import.meta.url);
await cp(new URL('../public/',import.meta.url),new URL('public/',target),{recursive:true});
await cp(new URL('../.next/static/',import.meta.url),new URL('.next/static/',target),{recursive:true});
for(const name of await readdir(target)) if(name.startsWith('.env')) await rm(new URL(name,target),{recursive:true,force:true});
console.log('Standalone server en publieke assets gereed; runtime-env wordt apart aangeleverd.');
