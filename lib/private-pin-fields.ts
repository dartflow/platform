/** Keep PIN credentials out of generic command receipts, including unexpected nested fields. */
export function containsPrivatePinField(value:unknown):boolean{
 const queue:unknown[]=[value],seen=new Set<object>();
 while(queue.length){
  const item=queue.pop();if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);
  for(const[key,field]of Object.entries(item)){
   if(['pin','playerpin','playerpinconfirmation','pinconfirmation','currentpin'].includes(key.toLowerCase()))return true;
   if(field&&typeof field==='object')queue.push(field);
  }
 }
 return false;
}
