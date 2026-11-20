import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contrastRatio,deriveThemeTokens,resolveClubhouseTheme,DEFAULT_THEME_PREFERENCE,safeThemeColor} from '../lib/clubhouse-theme-domain';
import type {ThemeCandidate} from '../lib/clubhouse-theme-domain';
const now=Date.parse('2026-11-20T12:00:00Z');
const candidate=(clubId:string):ThemeCandidate=>({clubId,name:clubId,brandingRevision:4,endsAt:'2026-12-01T00:00:00Z',design:{name:clubId,primary:'#ff0000',secondary:'#0000ff',logoData:null}});
test('theme selection covers explicit context, zero/one/many options and revoked explicit choice without switching clubs',()=>{
 const base={...DEFAULT_THEME_PREFERENCE};
 assert.equal(resolveClubhouseTheme(base,[],undefined,now).effective.clubId,null);
 assert.equal(resolveClubhouseTheme(base,[candidate('a')],undefined,now).effective.clubId,'a');
 const multiple=resolveClubhouseTheme(base,[candidate('a'),candidate('b')],undefined,now);assert.equal(multiple.effective.clubId,null);assert.equal(multiple.needsChoice,true);
 const revoked=resolveClubhouseTheme({...base,mode:'club',clubId:'a'},[candidate('b')],undefined,now);assert.equal(revoked.effective.clubId,null);assert.equal(revoked.needsChoice,true);
 assert.equal(resolveClubhouseTheme({...base,mode:'dartflow'},[candidate('a')],'a',now).effective.clubId,'a');
 assert.equal(resolveClubhouseTheme({...base,mode:'club',clubId:'a'},[candidate('a')],'b',now).effective.clubId,null);
 assert.equal(resolveClubhouseTheme(base,[{...candidate('a'),endsAt:new Date(now).toISOString()}],undefined,now).effective.clubId,null);
 assert.equal(Date.parse(resolveClubhouseTheme(base,[candidate('a')],undefined,now).effective.validUntil),now+300000);
});
test('extreme light/dark club palettes retain readable text, accent labels and independent semantic errors',()=>{
 for(const primary of ['#000000','#ffffff','#ff0000','#0000ff','#ffff00'])for(const dark of [false,true]){
  const tokens=deriveThemeTokens({primary,secondary:primary},dark);
  assert.ok(contrastRatio(tokens.text,tokens.surface)>=7);assert.ok(contrastRatio(tokens.muted,tokens.surface)>=4.5);assert.ok(contrastRatio(tokens.primary,tokens.surface)>=4.5);assert.ok(contrastRatio(tokens.onPrimary,tokens.primary)>=4.5);assert.ok(contrastRatio(tokens.error,tokens.surface)>=4.5);assert.notEqual(tokens.error,tokens.primary);
 }
 for(const value of ['red','#fff','var(--x)','url(https://x)','</style>'])assert.throws(()=>safeThemeColor(value));
});
