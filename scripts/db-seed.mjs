import pg from 'pg';
import { loadEnv, databaseConnection, ids as defaults } from './db-shared.mjs';
await loadEnv();
databaseConnection(process.env.DARTFLOW_DATABASE_ADMIN_URL, 'DARTFLOW_DATABASE_ADMIN_URL');
if (process.env.DARTFLOW_DATABASE_URL) databaseConnection(process.env.DARTFLOW_DATABASE_URL, 'DARTFLOW_DATABASE_URL');
const ids = { ...defaults };
const local = process.env.DARTFLOW_DATA_MODE === 'local';
for (const name of ['organizer', 'player1', 'player2', 'outsider']) {
  const value = process.env[`DARTFLOW_SEED_${name.toUpperCase()}_ID`];
  if (!local && !value) throw new Error(`Hosted seed vereist DARTFLOW_SEED_${name.toUpperCase()}_ID van een vooraf toegelaten Auth-gebruiker. Gebruik geen demo-UUID op hosted staging.`);
  if (value) ids[name] = value;
}
const client = new pg.Client({ connectionString: process.env.DARTFLOW_DATABASE_ADMIN_URL });
await client.connect();
try {
 await client.query('begin');
 for (const [key, name] of [['organizer','Danny Goldenbelt'],['player1','Michael de Groot'],['player2','Raymond van Dijk'],['outsider','Speler andere club']]) await client.query('insert into dartflow_private.profiles(id,name) values($1,$2) on conflict(id) do nothing',[ids[key],name]);
 if(local) {
  await client.query("update dartflow_private.profiles set email='fixture-'||id::text||'@example.invalid',email_verified=true where id=any($1::uuid[])",[[ids.organizer,ids.player1,ids.player2,ids.outsider]]);
  await client.query("insert into dartflow_private.platform_roles(user_id,role) values($1,'owner') on conflict(user_id) do nothing",[ids.organizer]);
  // Synthetic development accounts explicitly accept the current rules for existing UI regression fixtures.
  await client.query("insert into dartflow_private.player_safety_acceptances(user_id,version,age_confirmed) select unnest($1::uuid[]),'2026-11-18',true on conflict do nothing",[[ids.organizer,ids.player1,ids.player2,ids.outsider]]);
 }
 for(const [id,name] of [[ids.club1,'Duindorp SV'],[ids.club2,'Dartclub West']]) await client.query('insert into dartflow_private.clubs(id,name) values($1,$2) on conflict(id) do nothing',[id,name]);
 for(const [club,user,role] of [[ids.club1,ids.organizer,'organizer'],[ids.club1,ids.player1,'player'],[ids.club1,ids.player2,'player'],[ids.club2,ids.outsider,'player']]) await client.query('insert into dartflow_private.club_memberships(club_id,user_id,role) values($1,$2,$3) on conflict do nothing',[club,user,role]);
 for(const [id,club,name] of [[ids.event1,ids.club1,'Duindorp clubavond'],[ids.event2,ids.club2,'West clubavond']]) await client.query("insert into dartflow_private.events(id,club_id,name,date,capacity) values($1,$2,$3,current_date,16) on conflict(id) do nothing",[id,club,name]);
 await client.query('insert into dartflow_private.event_staff(event_id,user_id) values($1,$2) on conflict do nothing',[ids.event1,ids.organizer]);
 for(const [board,name] of [[ids.board1,'Baan 1'],[ids.board2,'Baan 2']]) await client.query('insert into dartflow_private.boards(id,event_id,name) values($1,$2,$3) on conflict(id) do nothing',[board,ids.event1,name]);
 for(const [player,event,index] of [[ids.player1,ids.event1,1],[ids.player2,ids.event1,2],[ids.outsider,ids.event2,3]]) await client.query("insert into dartflow_private.entries(id,event_id,user_id,status) values($1,$2,$3,'registered') on conflict(event_id,user_id) do nothing",[`50000000-0000-4000-8000-00000000000${index}`,event,player]);
 const settings={startScore:501,bestOfLegs:3,bestOfSets:1};
 const players=[{id:ids.player1,name:'Michael de Groot'},{id:ids.player2,name:'Raymond van Dijk'}];
 const game={id:ids.match1,players:players.map(p=>p.id),startScore:501,bestOf:3,legs:[0,0],remaining:[501,501],turn:0,legStarter:0,status:'live',visits:[],history:[],stats:[0,1].map(()=>({darts:0,total:0,oneEighties:0,highestFinish:0,legsWon:0}))};
 const state={id:ids.match1,clubId:ids.club1,eventId:ids.event1,boardId:null,revision:0,status:'planned',players,writerId:ids.player1,settings,accepted:[false,false],confirmations:[false,false],resultRevision:null,game,previousSets:[],winnerId:null,resultPublished:false,dispute:null};
 await client.query('insert into dartflow_private.matches(id,club_id,event_id,revision,state) values($1,$2,$3,0,$4) on conflict(id) do nothing',[ids.match1,ids.club1,ids.event1,JSON.stringify(state)]);
 for(let index=0;index<2;index++) await client.query('insert into dartflow_private.match_players(match_id,user_id,position) values($1,$2,$3) on conflict do nothing',[ids.match1,players[index].id,index]);
 await client.query('commit');
 console.log('Pilotseed gereed: twee afgescheiden verenigingen, organisator, twee spelers, andere-clubspeler, twee banen en één geplande partij. Bestaande partijen en resultaten blijven bewaard.');
} catch(error) { await client.query('rollback'); throw error; } finally { await client.end(); }
