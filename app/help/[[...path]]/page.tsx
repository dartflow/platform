import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import FaqWorkspace from '@/components/faq-workspace';
import {getPublishedFaq} from '@/lib/faq-publication';
import {connection} from 'next/server';

type Context={params:Promise<{path?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
export async function generateMetadata({params}:Context):Promise<Metadata>{
 await connection();
 const path=(await params).path??[],item=path.length===1?(await getPublishedFaq({id:path[0]})).items[0]:null;
 return {title:item?`${item.question} · DartFlow Help`:'Help & FAQ · DartFlow',description:'Hulp bij spelen, competities, toernooien, rankings en Oche Live.',robots:{index:true,follow:true}};
}
export default async function HelpPage({params,searchParams}:Context){
 await connection();
 const path=(await params).path??[],query=await searchParams;
 const snapshot=await getPublishedFaq();
 if(path.length>1||path.length===1&&!snapshot.items.some(item=>item.id===path[0]))notFound();
 return <FaqWorkspace snapshot={snapshot} questionId={path[0]} initialQuery={typeof query.q==='string'?query.q:''} initialCategory={typeof query.category==='string'?query.category:''} returnTo={typeof query.returnTo==='string'?query.returnTo:'/app'}/>;
}
