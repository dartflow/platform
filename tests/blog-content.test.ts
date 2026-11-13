import assert from 'node:assert/strict';
import test from 'node:test';
import {BlogContentError,blogSlug,collectBlogMediaIds,markdownToBlogDocument,renderBlogDocument,validateBlogDocument,type BlogDoc,type BlogNode} from '../lib/blog-content';
const text=(value:string,marks?:unknown)=>({type:'text',text:value,...(marks?{marks}: {})});
const doc=(...content:unknown[])=>({type:'doc',content});
const paragraph=(value:string)=>({type:'paragraph',content:[text(value)]});
const render=(input:unknown)=>renderBlogDocument(input as BlogDoc);
const asset='12345678-1234-4234-8234-123456789abc';

test('Tiptap document uses one deterministic safe renderer for headings, marks and table of contents',()=>{
 const rendered=render(doc({type:'heading',attrs:{level:2},content:[text('Café & club')]},paragraph('<script>alert("x")</script>'),{type:'heading',attrs:{level:3},content:[text('Café & club')]},{type:'heading',attrs:{level:2},content:[text('Café & club')]}));
 assert.deepEqual(rendered.headings.map(h=>h.id),['cafe-club','cafe-club-2','cafe-club-3']);assert.ok(rendered.html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));assert.ok(!rendered.html.includes('<script>'));assert.equal(rendered.readMinutes,1);assert.equal(blogSlug('  Dé club: 501!  '),'de-club-501');
});

test('malformed documents and structures fail validation instead of silently discarding entered data',()=>{
 const malformed:unknown[]=[null,[],{}, {type:'paragraph'}, {type:'doc',content:'wrong'}, {type:'doc',content:{}},doc(null),doc([]),doc({type:'paragraph',attrs:[]}),doc({type:'paragraph',attrs:'color:red'}),doc({type:'paragraph',attrs:null}),doc({type:'paragraph',text:'lost text'}),doc({type:'paragraph',content:[{type:'text',text:123}]}),doc({type:'paragraph',content:[{type:'text',text:'valid',content:[paragraph('hidden')]}]}),doc({type:'paragraph',content:[{type:'heading',content:[text('invalid nested heading')]}]}),doc({type:'javascript',content:[]})];
 for(const input of malformed)assert.throws(()=>validateBlogDocument(input),BlogContentError,JSON.stringify(input));
});

test('safe text marks preserve formatting and links while dropping scripts and unwanted properties',()=>{
 const marks=[{type:'bold',attrs:{style:'onclick=bad'}},{type:'italic'},{type:'link',attrs:{href:'https://example.org/article?ref=club',target:'_self',onclick:'bad'}},{type:'textStyle',attrs:{color:'red'}}];
 const normalized=validateBlogDocument(doc({type:'paragraph',content:[text('Club',marks)]}));const html=render(normalized).html;
 assert.ok(html.includes('<strong>Club</strong>'));assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));assert.ok(!html.includes('onclick'));assert.ok(!html.includes('textStyle'));assert.deepEqual(validateBlogDocument(normalized),normalized);
});

test('unsafe or ambiguous link schemes and redirects remain plain text',()=>{
 for(const href of ['javascript:alert(1)','data:text/html,bad','vbscript:msgbox(1)','//evil.example/path','/\\evil.example','https://user:pass@example.org','mailto:owner@example.org?body=bad','https://example.org/\u202ebad','https://example.org/\nheader']){
  const html=render(doc({type:'paragraph',content:[text('Open de club',[{type:'link',attrs:{href}}])]})).html;
  assert.equal(html,'<p>Open de club</p>',href);
 }
 for(const href of ['/blog/club','#ronde-2','https://example.org/club','mailto:owner@example.org'])assert.ok(render(doc({type:'paragraph',content:[text('Club',[{type:'link',attrs:{href}}])]})).html.includes('<a href='),href);
});

test('images accept the first party media namespace only and collect stable asset IDs once',()=>{
 const image={type:'image',attrs:{src:'/api/blog/media/'+asset,alt:'Een "darter" <aan de oche>',width:1200,height:1800,x:.25,y:.75,displayWidth:640,title:'Bijschrift'}};
 const normalized=validateBlogDocument(doc(image,image));assert.deepEqual(collectBlogMediaIds(normalized),[asset]);const html=render(normalized).html;assert.ok(html.includes('width="1200" height="1800"'));assert.ok(html.includes('style="width:640px;height:auto;max-width:100%"'));assert.ok(html.includes('Een &quot;darter&quot; &lt;aan de oche&gt;'));assert.ok(html.includes('<figcaption>Bijschrift</figcaption>'));
 for(const src of ['https://example.org/image.jpg','http://169.254.169.254/latest','data:image/svg+xml,<svg>','javascript:alert(1)','/api/blog/media/'+asset+'?token=private','/api/private/photo','//example.org/a.jpg'])assert.throws(()=>validateBlogDocument(doc({type:'image',attrs:{src}})),BlogContentError,src);
});

test('image and table dimensions, alignment and task status are bounded to renderable values',()=>{
 const result=validateBlogDocument(doc({type:'heading',attrs:{level:1,textAlign:'center',onclick:'bad'},content:[text('Titel')]},{type:'image',attrs:{src:'/assets/blog/toernooi-hero.webp',width:Infinity,height:-1,x:3,y:-1,ratio:'bad',displayWidth:99999}},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:999,rowspan:999,colwidth:[Infinity,200]},content:[paragraph('Inhoud')]}]}]},{type:'taskList',content:[{type:'taskItem',attrs:{checked:'yes'},content:[paragraph('Taak')]}]}));
 assert.deepEqual(result.content?.[0].attrs,{level:2,textAlign:'center'});assert.equal(result.content?.[1].attrs?.width,0);assert.equal(result.content?.[1].attrs?.x,.5);assert.ok(!render(result).html.includes('onclick'));assert.ok(render(result).html.includes('colspan="1" rowspan="1"'));assert.ok(!render(result).html.includes(' checked'));
});

test('Markdown from SocialHero maps headings, lists, tasks, tables and fenced code to the same schema',()=>{
 const markdown='# Titel\n\nEen **club** met [regels](/blog/regels).\n\n- Eerste\n- Tweede\n\n- [x] Inchecken\n- [ ] Baan toewijzen\n\n| Ronde | Banen |\n| --- | --- |\n| Poule | 4 |\n\n```js\nconst html = "<script>";\n```\n\n> Begin op tijd.\n\n---';
 const parsed=markdownToBlogDocument(markdown),html=render(parsed).html;
 for(const expected of ['<h2 id="titel">Titel</h2>','<strong>club</strong>','<a href="/blog/regels">regels</a>','<ul>','class="blog-task-list"',' checked','<table><tbody>','<pre><code>','&lt;script&gt;','<blockquote>','<hr>'])assert.ok(html.includes(expected),expected);
 assert.deepEqual(validateBlogDocument(parsed),parsed);
});

test('Markdown never loads remote images or executes embedded HTML, event handlers or dangerous links',()=>{
 const parsed=markdownToBlogDocument('![Beschrijving](http://169.254.169.254/latest)\n\n<script>alert(1)</script>\n\n[Klik](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\nVeilige tekst **blijft**.');
 const html=render(parsed).html;assert.ok(html.includes('Beschrijving'));assert.ok(html.includes('Veilige tekst <strong>blijft</strong>'));for(const bad of ['<script','<img','javascript:','169.254','onerror'])assert.ok(!html.includes(bad),bad);assert.deepEqual(collectBlogMediaIds(parsed),[]);
});

test('renderer budgets cap huge documents, deep nesting and oversized Markdown before storage',()=>{
 assert.throws(()=>validateBlogDocument(doc(paragraph('a'.repeat(95001)))),BlogContentError);assert.throws(()=>markdownToBlogDocument('x'.repeat(95001)),BlogContentError);
 assert.throws(()=>validateBlogDocument(doc(...Array.from({length:3501},()=>paragraph('x')))),BlogContentError);
 let deep:BlogNode=paragraph('onderaan') as BlogNode;for(let i=0;i<20;i++)deep={type:'blockquote',content:[deep]};assert.throws(()=>validateBlogDocument(doc(deep)),BlogContentError);
});

test('empty paragraphs, genuine zero text and small complete documents keep their meaning',()=>{
 const normalized=validateBlogDocument(doc({type:'paragraph'},paragraph('0'),{type:'paragraph',content:[text('A\u0000B')]}));assert.equal(render(normalized).html,'<p></p><p>0</p><p>AB</p>');assert.equal(render(normalized).readMinutes,1);assert.equal(render(doc(paragraph(Array.from({length:431},()=> 'woord').join(' ')))).readMinutes,3);
});
