'use client';

import {useState} from 'react';
import {getFaq,filterFaq} from '@/lib/faq';
import type {FaqSnapshot} from '@/lib/faq';
import {safeNext} from '@/lib/config';
import './faq-workspace.css';

export default function FaqWorkspace({questionId='',initialQuery='',initialCategory='',returnTo='/app',snapshot=getFaq()}:{questionId?:string;initialQuery?:string;initialCategory?:string;returnTo?:string;snapshot?:FaqSnapshot}){
 const [query,setQuery]=useState(initialQuery),[category,setCategory]=useState(initialCategory);
 const result=filterFaq(snapshot,{q:query,category,id:questionId});
 return <main className="faq-workspace"><header><a className="faq-brand" href="/"><img src="/assets/dartflow-logo.svg" width="180" height="60" alt="DartFlow"/></a><a className="button" href={safeNext(returnTo)}>Terug naar DartFlow</a></header><div className="page-title"><div><span className="eyebrow">Hulp bij jouw speeldag</span><h1>Help & FAQ</h1><p>Spelregels, organiseren, rankings en Oche Live.</p></div></div><section className="panel faq-search" aria-label="Zoeken in de hulp"><label>Zoek een vraag<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Bijvoorbeeld scorekaart, koppelen of baan" maxLength={200}/></label><label>Categorie<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">Alle categorieën</option>{result.categories.map(name=><option key={name}>{name}</option>)}</select></label>{(query||category||questionId)&&<a href="/help" className="button" onClick={e=>{if(!questionId){e.preventDefault();setQuery('');setCategory('');}}}>Wis filters</a>}</section><p role="status">{result.items.length} {result.items.length===1?'vraag':'vragen'} gevonden</p><div className="faq-answers">{result.items.map(item=><details key={item.id} open={questionId===item.id||undefined}><summary>{item.question}</summary><div><span className="eyebrow">{item.category}</span><p>{item.answer}</p><a href={`/help/${encodeURIComponent(item.id)}`}>Link naar deze vraag</a></div></details>)}</div>{result.items.length===0&&<section className="panel"><h2>Geen vraag gevonden</h2><p>Probeer een korter zoekwoord of kies een andere categorie.</p><a href="/help">Bekijk alle vragen</a></section>}<footer><p>Inhoudsversie {snapshot.version} · {snapshot.publishedAt}</p><p>Het gepubliceerde reglement van jouw evenement bepaalt welke regels gelden. <a href="/app/competities">Open jouw competitie</a> of <a href="/app/events">jouw evenement</a>.</p></footer></main>;
}
