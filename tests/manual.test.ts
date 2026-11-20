import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manualArticles,getManual} from '../lib/manual';
import faq from '../lib/content/faq.nl.json';
test('one shared manual covers all eighteen requested topics and every FAQ crosslink resolves',()=>{assert.equal(manualArticles.length,18);const ids=new Set(manualArticles.map(a=>a.id));assert.equal(ids.size,18);for(const a of manualArticles){assert.ok(a.intro.length>50,a.id);assert.ok(a.steps.length>=3,a.id);assert.ok(a.examples.length>=1,a.id);assert.ok(a.href.startsWith('/'),a.id);}for(const row of faq){if('manualId'in row)assert.ok(ids.has(row.manualId!),row.id);}for(const id of['qr-beginnen','gast-bewaren','hervatten-offline','schrijver-en-bord','baantimer','x01','cricket','tactics','around','dubbelbingo','versla-mijn-leg','finishtraining','oche-koppelen'])assert.ok(ids.has(id));});
test('manual search finds explanatory content and supports multiple terms without exposing an account',()=>{assert.ok(getManual({q:'dubbel openen'}).articles.some(a=>a.id==='x01'));assert.ok(getManual({q:'offline beurten'}).articles.length);assert.equal(getManual({id:'not-a-topic'}).articles.length,0);});
