import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getFaq,FAQ_VERSION,mergePublishedFaq} from '../lib/faq';

test('shared Dutch FAQ has stable unique share routes and complete question content',()=>{
 const data=getFaq();assert.equal(data.version,FAQ_VERSION);assert.ok(data.items.length>=79);
 assert.equal(new Set(data.items.map(item=>item.id)).size,data.items.length);
 for(const item of data.items){assert.match(item.id,/^[a-z0-9-]+$/);assert.ok(item.question&&item.answer&&item.keywords.length);assert.deepEqual(getFaq({id:item.id}).items,[item]);}
});
test('FAQ searches Dutch questions, answers and synonyms with all terms and category filtering',()=>{
 const data=getFaq();const keyword=data.items.find(item=>item.keywords.includes('scorekaart'))!;
 assert.ok(getFaq({q:'SCOREKAART'}).items.some(item=>item.id===keyword.id));
 assert.ok(getFaq({q:'  scorekaart  ',category:keyword.category}).items.every(item=>item.category===keyword.category));
 assert.equal(getFaq({q:'onbestaandzoekwoord999'}).items.length,0);
 assert.equal(getFaq({id:'onbekende-vraag'}).items.length,0);
});
test('an earlier published FAQ gains all new game help without losing unrelated editorial questions',()=>{
 const base=getFaq(),prior=base.items.find(item=>item.id==='baan-offline')!,other=base.items.find(item=>item.id!==prior.id&&!['baan-tablet','hulp-gastprofiel','sport-bust','hulp-correctie','oche-inactiviteit'].includes(item.id))!;
 const custom={...other,id:'eigen-clubvraag',answer:'Bewaar de eigen clubafspraak.'};
 const result=mergePublishedFaq({version:'oude-publicatie',createdAt:'2026-11-01T00:00:00Z',items:[{...prior,answer:'Verouderde offline-instructie.'},{...other,answer:'Bestaande redactiewijziging.'},custom]});
 assert.equal(result.items.length,base.items.length+1);assert.equal(new Set(result.items.map(item=>item.id)).size,result.items.length);
 assert.deepEqual(result.items.find(item=>item.id===prior.id),prior);
 assert.equal(result.items.find(item=>item.id===other.id)?.answer,'Bestaande redactiewijziging.');assert.deepEqual(result.items.find(item=>item.id===custom.id),custom);
 assert.equal(result.version,`oude-publicatie+${FAQ_VERSION}`);assert.equal(result.publishedAt,base.publishedAt);
});
test('an editor can revise the upgraded help after release without the bundled baseline overriding it',()=>{
 const base=getFaq(),items=base.items.map(item=>item.id==='baan-offline'?{...item,answer:'Nieuwe gepubliceerde uitleg.',manualId:'hervatten-offline'}:item);
 const createdAt=new Date(Date.parse(base.publishedAt)+3600000).toISOString();
 const result=mergePublishedFaq({version:'nieuwe-publicatie',createdAt,items});
 assert.deepEqual(result.items,items);assert.equal(result.version,'nieuwe-publicatie');assert.equal(result.publishedAt,createdAt);
});
