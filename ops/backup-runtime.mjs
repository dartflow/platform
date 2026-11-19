#!/usr/bin/env node
// Run as root on the existing target host. Never emits configuration or row data.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,realpath,chmod} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';

const environment=process.argv[2];
if(process.getuid?.()!==0||!['staging','production'].includes(environment)||process.argv.length!==3)throw new Error('Usage on target host as root: node backup-runtime.mjs staging|production');
const current=`/srv/sites/dartflow-${environment}/current`,release=await realpath(current);
if(!release.startsWith(`/srv/sites/dartflow-${environment}/releases/`))throw new Error('Unexpected active release.');
const destination=`/var/backups/dartflow/full-release-${environment}-${new Date().toISOString().replace(/[^0-9TZ]/g,'')}`;
await mkdir(destination,{mode:0o700});await chmod(destination,0o700);
process.loadEnvFile(path.join(current,'.runtime.env'));
const require=createRequire(path.join(release,'package.json')),{Client}=require('pg');
const client=new Client({connectionString:process.env.DARTFLOW_DATABASE_URL,application_name:'dartflow-release-backup'});
const digest=data=>createHash('sha256').update(data).digest('hex');
const metadata={environment,createdAt:new Date().toISOString(),release,scope:'Runtime-visible private application rows and active runtime/release configuration. Excludes Supabase Auth, owner_bootstrap and external providers.',files:[],tables:[],excluded:[]};
await client.connect();
try{
 await client.query('begin isolation level repeatable read read only');
 const tables=(await client.query("select tablename,has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'select') as readable from pg_tables where schemaname='dartflow_private' order by tablename")).rows;
 const snapshot={format:'dartflow-runtime-backup-v1',createdAt:metadata.createdAt,tables:{}};
 for(const table of tables){
  if(!table.readable||table.tablename==='owner_bootstrap'){metadata.excluded.push(table.tablename);continue;}
  const name=table.tablename;if(!/^[a-z][a-z0-9_]*$/.test(name))throw new Error('Unexpected table identifier.');
  const rows=(await client.query(`select to_jsonb(t) as row from dartflow_private."${name}" t`)).rows.map(record=>record.row);
  snapshot.tables[name]=rows;metadata.tables.push({name,count:rows.length,sha256:digest(JSON.stringify(rows))});
 }
 await client.query('commit');
 const payload=gzipSync(JSON.stringify(snapshot),{level:9});
 const target=path.join(destination,'application.json.gz');await writeFile(target,payload,{mode:0o600});
 const verified=JSON.parse(gunzipSync(await readFile(target)).toString());
 if(verified.format!==snapshot.format||metadata.tables.some(table=>verified.tables[table.name]?.length!==table.count||digest(JSON.stringify(verified.tables[table.name]))!==table.sha256))throw new Error('Backup readback verification failed.');
 metadata.files.push({name:'application.json.gz',bytes:payload.length,sha256:digest(payload)});
 for(const name of ['.runtime.env','.release.env']){
  const data=await readFile(path.join(current,name));const saved=name.slice(1);await writeFile(path.join(destination,saved),data,{mode:0o600});
  if(digest(await readFile(path.join(destination,saved)))!==digest(data))throw new Error('Configuration readback failed.');
  metadata.files.push({name:saved,bytes:data.length,sha256:digest(data)});
 }
 metadata.verifiedReadback=true;await writeFile(path.join(destination,'manifest.json'),JSON.stringify(metadata,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({destination,...metadata}));
}catch(error){await client.query('rollback').catch(()=>{});throw new Error(`Backup did not complete (${typeof error?.code==='string'?error.code:error?.name??'error'}); inspect the protected destination.`);}
finally{await client.end();}
