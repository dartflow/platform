import type {SeasonView} from './seasons-types';
const stamp=(value:string)=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const text=(value:string)=>value.replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
function fold(line:string):string{const rows:string[]=[];let row='';for(const char of line){if(Buffer.byteLength(row+char)>75){rows.push(row);row=' ';}row+=char;}rows.push(row);return rows.join('\r\n');}
/** Input must be the actor's already authorized/redacted season projection. */
export function seasonCalendar(season:SeasonView,origin:string):string{
 const events=season.fixtures.filter(f=>f.startsAt&&f.endsAt&&f.status!=='canceled').flatMap(f=>{
  const name=(id:string)=>season.teams.find(t=>t.id===id)?.name??season.participants.find(p=>p.id===id)?.name??'Deelnemer';
  const location=f.boardIds.map(id=>season.boards.find(b=>b.id===id)?.name??'Toegewezen baan').join(' / ');
  return['BEGIN:VEVENT',`UID:${f.id}@dartflow.nl`,`SEQUENCE:${season.revision}`,`DTSTAMP:${stamp(season.createdAt)}`,`DTSTART:${stamp(f.startsAt!)}`,`DTEND:${stamp(f.endsAt!)}`,`SUMMARY:${text(`${season.name} · ${name(f.homeId)} – ${name(f.awayId)}`)}`,`LOCATION:${text(location)}`,`URL:${origin}/app/competities/${season.id}?fixture=${f.id}`,'END:VEVENT'];
 });
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DG Webservices//DartFlow//NL','CALSCALE:GREGORIAN','METHOD:PUBLISH',...events,'END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
