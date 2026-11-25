import type {DomainMailApplicability} from './integrations-mail';
const supportTypes=new Set(['support-created','support-user-replied','support-reopened','support-answered','support-status-changed']);
/** A closed lock-screen projection. Never copy arbitrary reference or user text. */
export function notificationWireData(row:{template_id:string;category:string;reference:DomainMailApplicability}):Record<string,string>{
 const c=row.reference.communication;if(!c)return {};
 if(row.category==='Supporttickets'&&c.reference.kind==='support'&&supportTypes.has(row.template_id)&&/^DF-[1-9]\d{0,14}$/.test(c.reference.ticketNumber))return {eventType:row.template_id,ticketNumber:c.reference.ticketNumber};
 if(['Productreleases','Platformberichten'].includes(row.category)&&['campaign','test'].includes(c.reference.kind)&&c.title.length<=80&&c.body.length<=180&&!/[\u0000-\u001f\u007f-\u009f]/.test(c.title+c.body))return {campaignTitle:c.title,campaignBody:c.body};
 return {};
}
