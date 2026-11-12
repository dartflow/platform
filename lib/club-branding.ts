import sharp from 'sharp';
import {DomainError} from './domain';
export async function safeClubLogo(value:unknown):Promise<string|null>{
 if(value===null||value==='')return null;
 if(typeof value!=='string'||value.length>140000||!/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(value))throw new DomainError('club_logo','Upload een PNG-, JPEG- of WebP-logo van maximaal 96 kB.');
 const input=Buffer.from(value.split(',')[1],'base64');if(input.length>96*1024)throw new DomainError('club_logo','Het logo is te groot.');
 try{const image=sharp(input,{limitInputPixels:1024*1024,failOn:'error'}),metadata=await image.metadata();if(!['png','jpeg','webp'].includes(metadata.format||'')||!metadata.width||!metadata.height||metadata.width>1024||metadata.height>1024||(metadata.pages??1)>1)throw new Error('format');const output=await image.rotate().resize(512,512,{fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();if(output.length>128*1024)throw new Error('size');return `data:image/webp;base64,${output.toString('base64')}`;}catch{throw new DomainError('club_logo','Het logo is ongeldig. Gebruik een stilstaand rasterbeeld van maximaal 1024 × 1024 pixels.');}
}
