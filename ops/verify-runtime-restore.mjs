#!/usr/bin/env node
/** Restore a runtime backup only into a disposable database on loopback. */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
try{process.loadEnvFile('.env.local');}catch{}
const source=new URL(process.env.DARTFLOW_DATABASE_ADMIN_URL??'invalid:');
if(process.env.DARTFLOW_DATA_MODE!=='local'||!['127.0.0.1','localhost','[::1]'].includes(source.hostname)||process.argv.length!==5)throw new Error('Only an explicit loopback restore is allowed: backup.gz manifest.json evidence.json');
const bytes=await readFile(process.argv[2]),manifest=JSON.parse(await readFile(process.argv[3],'utf8')),snapshot=JSON.parse(gunzipSync(bytes));
const digest=data=>createHash('sha256').update(data).digest('hex');
if(digest(bytes)!==manifest.files.find(file=>file.name==='application.json.gz')?.sha256||snapshot.format!=='dartflow-runtime-backup-v1')throw new Error('Backup digest or format mismatch.');
const taskDatabase=`dartflow_restore_${randomBytes(8).toString('hex')}`;
const server=new pg.Client({connectionString:source.toString()});await server.connect();
const restored=new URL(source);restored.pathname=`/${taskDatabase}`;let target;
try{
 const env={...process.env,PGHOST:source.hostname,PGPORT:source.port,PGUSER:decodeURIComponent(source.username),PGPASSWORD:decodeURIComponent(source.password),PGDATABASE:source.pathname.slice(1)};
 const schema=spawnSync('pg_dump',['--schema=dartflow_private','--schema-only','--no-owner','--no-privileges'],{env,encoding:'utf8',maxBuffer:32*1024*1024});
 if(schema.status!==0)throw new Error('Local schema export failed.');
 await server.query(`create database "${taskDatabase}" template template0`);target=new pg.Client({connectionString:restored.toString()});await target.connect();
 await target.query(schema.stdout.split('\n').filter(line=>!line.startsWith('\\')).join('\n'));await target.query("set timezone='UTC'");
 await target.query("set session_replication_role='replica'");await target.query('begin');
 const evidence={format:'dartflow-restore-validation-v1',createdAt:new Date().toISOString(),environment:manifest.environment,backupDigest:digest(bytes),scope:manifest.scope,isolatedLoopbackDatabase:true,restoredTables:[],foreignKeysChecked:0,rows:0};
 for(const [name,rows]of Object.entries(snapshot.tables)){
  if(!/^[a-z][a-z0-9_]*$/.test(name)||!Array.isArray(rows))throw new Error('Invalid table.');
  const columns=(await target.query("select column_name from information_schema.columns where table_schema='dartflow_private' and table_name=$1 order by ordinal_position",[name])).rows.map(row=>row.column_name);
  const names=columns.map(name=>`"${name}"`).join(',');
  if(rows.length)await target.query(`insert into dartflow_private."${name}"(${names}) overriding system value select ${names} from jsonb_populate_recordset(null::dartflow_private."${name}",$1::jsonb)`,[JSON.stringify(rows)]);
  const actual=(await target.query(`select to_jsonb(t) as row from dartflow_private."${name}" t`)).rows.map(row=>row.row);
  // The candidate schema can contain new nullable/defaulted columns. Compare
  // every backed-up field, including identifiers, without removing new columns.
  const fields=rows.length?Object.keys(rows[0]).sort():[];
  const canonical=list=>JSON.stringify(list.map(row=>JSON.stringify(fields.map(field=>[field,row[field]]))).sort());
  if(canonical(actual)!==canonical(rows)){
   const changed=fields.filter(field=>JSON.stringify(actual.map(row=>JSON.stringify(row[field])).sort())!==JSON.stringify(rows.map(row=>JSON.stringify(row[field])).sort()));
   throw new Error(`Restored backed-up fields differ in ${name}: ${changed.join(',')}.`);
  }
  evidence.restoredTables.push({name,count:rows.length});evidence.rows+=rows.length;
 }
 await target.query('commit');await target.query("set session_replication_role='origin'");
 const constraints=(await target.query(`select con.conname,con.conrelid::regclass::text as source,con.confrelid::regclass::text as target,array(select attname::text from unnest(con.conkey)with ordinality k(id,n) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.id order by k.n) as source_columns,array(select attname::text from unnest(con.confkey)with ordinality k(id,n) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.id order by k.n) as target_columns from pg_constraint con join pg_namespace n on n.oid=con.connamespace where con.contype='f' and n.nspname='dartflow_private'`)).rows;
 for(const constraint of constraints){
  const present=constraint.source_columns.map(name=>`s."${name}" is not null`).join(' and '),join=constraint.source_columns.map((name,index)=>`s."${name}"=t."${constraint.target_columns[index]}"`).join(' and ');
  const invalid=(await target.query(`select exists(select 1 from ${constraint.source} s where ${present} and not exists(select 1 from ${constraint.target} t where ${join})) as invalid`)).rows[0].invalid;
  if(invalid)throw new Error('Restored foreign-key relation is incomplete.');evidence.foreignKeysChecked++;
 }
 const migrationsRoot=new URL('../supabase/migrations/',import.meta.url);
 const migrations=(await readdir(migrationsRoot)).filter(name=>/^20261119\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
 evidence.candidateMigrations=[];
 for(let pass=1;pass<=2;pass++){
  for(const name of migrations){const sql=await readFile(new URL(name,migrationsRoot),'utf8');await target.query(sql);if(pass===1)evidence.candidateMigrations.push({name,sha256:digest(sql)});}
  for(const [name,rows]of Object.entries(snapshot.tables)){
   if(name==='feature_versions')continue;
   const fields=rows.length?Object.keys(rows[0]).sort():[];
   const actual=(await target.query(`select to_jsonb(t) as row from dartflow_private."${name}" t`)).rows.map(row=>row.row);
   const canonical=list=>JSON.stringify(list.map(row=>JSON.stringify(fields.map(field=>[field,row[field]]))).sort());
   if(canonical(actual)!==canonical(rows))throw new Error(`Candidate migration changed historical rows in ${name}.`);
  }
 }
 evidence.migrationPasses=2;evidence.historicalRowsUnchanged=true;
 evidence.result='passed';await writeFile(process.argv[4],JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify({result:evidence.result,tables:evidence.restoredTables.length,rows:evidence.rows,foreignKeysChecked:evidence.foreignKeysChecked}));
}catch(error){throw new Error(`Isolated restore failed (${error?.code??error?.message??'error'}). No hosted database was changed.`);}
finally{await target?.end();await server.query(`drop database if exists "${taskDatabase}" with(force)`);await server.end();}
