import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getFaq,FAQ_VERSION} from '../lib/faq';

test('shared Dutch FAQ has stable unique share routes and complete question content',()=>{
 const data=getFaq();assert.equal(data.version,FAQ_VERSION);assert.equal(data.items.length,79);
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
