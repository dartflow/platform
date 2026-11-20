import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import ManualWorkspace from '@/components/manual-workspace';
import {manualArticles} from '@/lib/manual';
type Context={params:Promise<{path?:string[]}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
export async function generateMetadata({params}:Context):Promise<Metadata>{const path=(await params).path??[],article=manualArticles.find(a=>a.id===path[0]);return {title:`${article?.title??'Handleiding'} · DartFlow`,description:article?.intro??'Stap voor stap spelen, oefenen, herstellen en organiseren in DartFlow.'};}
export default async function ManualPage({params,searchParams}:Context){const path=(await params).path??[],query=await searchParams;if(path.length>1||path.length===1&&!manualArticles.some(a=>a.id===path[0]))notFound();return <ManualWorkspace articleId={path[0]} initialQuery={typeof query.q==='string'?query.q:''} returnTo={typeof query.returnTo==='string'?query.returnTo:'/app'}/>;}
