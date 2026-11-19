import {DomainError} from './domain';
/** RFC-style quoting, including escaped quotes and embedded newlines; no formula execution. */
export function parseParticipantCsv(value:unknown):{headers:string[];rows:{line:number;cells:string[]}[]}{
 if(typeof value!=='string'||Buffer.byteLength(value)>65536)throw new DomainError('invalid_import','Plak een deelnemerslijst van maximaal 64 KiB.');
 const input=value.replace(/^\uFEFF/,''),first=input.split(/\r?\n/,1)[0],delimiter=[';',',','\t'].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows:{line:number;cells:string[]}[]=[],cells:string[]=[];let field='',quoted=false,closed=false,line=1,rowLine=1;
 const cell=()=>{cells.push(field.trim());field='';closed=false;},row=()=>{cell();if(cells.some(Boolean))rows.push({line:rowLine,cells:[...cells]});cells.length=0;};
 for(let i=0;i<input.length;i++){const c=input[i];if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else{field+=c;if(c==='\n')line++;}continue;}
  if(c==='"'){if(field||closed)throw new DomainError('invalid_import','Een aanhalingsteken staat niet aan het begin van een CSV-veld.');quoted=true;}
  else if(c===delimiter)cell();else if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n')i++;row();line++;rowLine=line;}
  else{if(closed&&!/\s/.test(c))throw new DomainError('invalid_import','Na een gesloten CSV-veld hoort een scheidingsteken.');if(!closed)field+=c;}
 }
 if(quoted)throw new DomainError('invalid_import','Sluit het aangehaalde CSV-veld af.');if(field||cells.length||closed)row();
 if(!rows.length||rows.length>501)throw new DomainError('invalid_import','Gebruik een kolomkop en maximaal 500 deelnemersregels.');
 const headers=rows.shift()!.cells.map(v=>v.toLowerCase());if(new Set(headers).size!==headers.length)throw new DomainError('invalid_import','De kolomkop bevat dubbele namen.');
 if(headers.some(h=>!['name','username','type'].includes(h)))throw new DomainError('invalid_import','Gebruik alleen de kolommen name, username en type.');
 return{headers,rows};
}
