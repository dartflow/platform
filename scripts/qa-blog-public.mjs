/** Compare the shipped public components with the delivered Sites reference using local fixtures only.
 * Run: node --import tsx scripts/qa-blog-public.mjs [path/to/extracted/package]
 * Existing Chromium is reused; no browser or dependency download and no database writes.
 */
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import {renderBlogArticleBody,renderBlogIndexBody,renderLatestBlog,renderBlogMasthead,renderBlogFooter} from '../components/blog-public.tsx';
import {renderBlogDocument} from '../lib/blog-content.ts';
const packagePath=resolve(process.argv[2]||'.local/blog-package'),prototype=join(packagePath,'prototype');
const {seedPosts}=await import(pathToFileURL(join(prototype,'worker/blog-seed.js')));
const {presentBlogPost}=await import(pathToFileURL(join(prototype,'worker/blog-content.js')));
const {renderBlogArticle,renderBlogIndex,renderMarketingBlog}=await import(pathToFileURL(join(prototype,'worker/blog-pages.js')));
const fixtureOrigin='https://blog-layout.fixture';
seedPosts.sort((a,b)=>a.id.localeCompare(b.id));
const referencePosts=seedPosts.map(presentBlogPost),actualPosts=seedPosts.map(p=>({...presentBlogPost(p),...renderBlogDocument(p.content)}));
const shell=body=>'<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/pwa-screens.css"><link rel="stylesheet" href="/oche-live.css"><link rel="stylesheet" href="/analytics-consent.css"><link rel="stylesheet" href="/marketing.css"><link rel="stylesheet" href="/blog.css"></head><body><div class="blog-page" lang="nl-NL">'+renderBlogMasthead()+body+renderBlogFooter()+'</div><script type="module" src="/blog-share.js"></script></body></html>';
const homeshell=body=>'<!doctype html><html lang="nl"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/marketing.css"><link rel="stylesheet" href="/blog.css"></head><body>'+body+'</body></html>';
const cases=[
 {id:'archive',reference:renderBlogIndex({posts:referencePosts,origin:fixtureOrigin}),actual:shell(renderBlogIndexBody(actualPosts,fixtureOrigin)),selectors:['.masthead','.blog-intro','.blog-feature','.blog-controls','.blog-grid','.blog-card','.footer']},
 {id:'filter',reference:renderBlogIndex({posts:referencePosts,origin:fixtureOrigin,category:'Training'}),actual:shell(renderBlogIndexBody(actualPosts,fixtureOrigin,'Training')),selectors:['.blog-intro','.blog-controls','.blog-card','.footer']},
 {id:'search',reference:renderBlogIndex({posts:referencePosts,origin:fixtureOrigin,query:'onvindbaar'}),actual:shell(renderBlogIndexBody(actualPosts,fixtureOrigin,'','onvindbaar')),selectors:['.blog-intro','.blog-controls','.blog-empty','.footer']},
 {id:'article',reference:renderBlogArticle({post:referencePosts[0],posts:referencePosts,origin:fixtureOrigin}),actual:shell(renderBlogArticleBody(actualPosts[0],actualPosts,fixtureOrigin)),selectors:['.masthead','.blog-article-hero','.blog-article-title','.blog-article-cover','.blog-toc','.blog-prose','.blog-related','.footer']},
 {id:'latest',reference:homeshell(renderMarketingBlog({posts:referencePosts,origin:fixtureOrigin})),actual:homeshell(renderLatestBlog(actualPosts,fixtureOrigin)),selectors:['.home-blog','.home-blog-header','.blog-grid','.blog-card']}
];
const executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/home/codex/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
assert.ok(existsSync(executable),'Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to the existing Chromium.');
const output=resolve(process.env.BLOG_PUBLIC_QA_OUTPUT||'artifacts/blog-public');mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--disable-dev-shm-usage']});
const results=[];
try{
 const context=await browser.newContext({reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());if(u.origin!==fixtureOrigin)return route.abort();
  const fixture=cases.find(c=>u.pathname==='/reference/'+c.id||u.pathname==='/actual/'+c.id);
  if(fixture)return route.fulfill({status:200,contentType:'text/html',body:u.pathname.startsWith('/reference/')?fixture.reference.replaceAll('href="/marketing.css"','href="/reference-marketing.css"').replaceAll('href="/blog.css"','href="/reference-blog.css"'):fixture.actual});
  const maps={'/reference-blog.css':join(prototype,'public/blog.css'),'/reference-marketing.css':join(prototype,'public/marketing.css'),'/globals.css':'app/globals.css','/pwa-screens.css':'components/pwa-screens.css','/oche-live.css':'components/oche-live.css','/analytics-consent.css':'components/analytics-consent.css'};
  const path=maps[u.pathname]||'public'+decodeURIComponent(u.pathname);
  if(!path.startsWith('public/')&&!Object.values(maps).includes(path)||!existsSync(path))return route.fulfill({status:404,body:''});
  const types={'.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg'};
  return route.fulfill({status:200,contentType:types[extname(path)]||'application/octet-stream',body:readFileSync(path)});
 });
 for(const viewport of [{width:1440,height:1000},{width:900,height:1200},{width:540,height:960},{width:390,height:844}]){
  for(const item of cases){
   const captures=[];
   for(const kind of ['reference','actual']){
    const page=await context.newPage();await page.setViewportSize(viewport);await page.goto(fixtureOrigin+'/'+kind+'/'+item.id);await page.evaluate(()=>document.fonts.ready);await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>{image.loading='eager';return image.decode().catch(()=>{});})));
    const geometry=await page.evaluate(selectors=>({width:document.documentElement.scrollWidth,fonts:[getComputedStyle(document.querySelector('h1,h2')).fontFamily,getComputedStyle(document.querySelector('h1,h2')).fontWeight],boxes:selectors.map(selector=>{const element=document.querySelector(selector);if(!element)return {selector,missing:true};const b=element.getBoundingClientRect(),s=getComputedStyle(element);return {selector,x:b.x,y:b.y,width:b.width,height:b.height,fontSize:s.fontSize,lineHeight:s.lineHeight,columns:s.gridTemplateColumns};})}),item.selectors);
    assert.ok(geometry.width<=viewport.width,kind+' '+item.id+' overflows '+viewport.width);
    const png=await page.screenshot({animations:'disabled'});captures.push({geometry,png});
    if([390,1440].includes(viewport.width)&&['archive','article'].includes(item.id))writeFileSync(join(output,kind+'-'+item.id+'-'+viewport.width+'.png'),png);
    await page.close();
   }
   const [reference,actual]=captures;
   let maxGeometryDelta=0;
   for(let i=0;i<reference.geometry.boxes.length;i++){
    const a=actual.geometry.boxes[i],r=reference.geometry.boxes[i];assert.equal(Boolean(a.missing),Boolean(r.missing),item.id+' '+a.selector);
    if(!a.missing){for(const key of ['x','y','width','height'])maxGeometryDelta=Math.max(maxGeometryDelta,Math.abs(a[key]-r[key]));assert.equal(a.fontSize,r.fontSize,item.id+' '+a.selector+' font');assert.equal(a.lineHeight,r.lineHeight,item.id+' '+a.selector+' lineheight');}
   }
   const a=await sharp(actual.png).ensureAlpha().raw().toBuffer(),r=await sharp(reference.png).ensureAlpha().raw().toBuffer();let changedPixels=0;for(let pixel=0;pixel<a.length;pixel+=4)if(Math.abs(a[pixel]-r[pixel])>8||Math.abs(a[pixel+1]-r[pixel+1])>8||Math.abs(a[pixel+2]-r[pixel+2])>8)changedPixels++;
   const differentPixelPercent=Number((100*changedPixels/(viewport.width*viewport.height)).toFixed(5));
   results.push({case:item.id,viewport,maxGeometryDelta,differentPixelPercent,actual:actual.geometry,reference:reference.geometry});
   assert.ok(maxGeometryDelta<=1,item.id+' '+viewport.width+' geometry differs '+maxGeometryDelta+'px');
   assert.ok(differentPixelPercent<=.5,item.id+' '+viewport.width+' screenshot differs '+differentPixelPercent+'%');
  }
 }
 writeFileSync(join(output,'report.json'),JSON.stringify({ok:true,source:'Delivered Sites source; current production CSS and public components; local fixture data only',checks:results.length,results},null,2));
 console.log(JSON.stringify({ok:true,comparisons:results.length,maxGeometryDelta:Math.max(...results.map(r=>r.maxGeometryDelta)),maxDifferentPixelPercent:Math.max(...results.map(r=>r.differentPixelPercent)),report:join(output,'report.json')}));
}finally{await browser.close();}
