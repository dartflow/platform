import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {clubColor,clubGrants,clubInk,intakeAnswers,intakeQuestions} from '../lib/club-validation';
import {safeClubLogo} from '../lib/club-branding';
import {renderMail,templateById} from '../lib/integrations-mail';

test('v17 intake validates typed bounded questions and immutable labelled answer snapshots',()=>{
 const questions=intakeQuestions([{id:'motivation',label:'Waarom wil je lid worden?',type:'textarea',required:true},{id:'level',label:'Ervaring',type:'select',required:true,options:['Beginner','Ervaren']},{id:'name',label:'Voorkeur',type:'text',required:false}]);
 const snapshot=intakeAnswers(questions,{motivation:'Voor de clubavonden',level:'Beginner'});questions[0].label='Een andere vraag';assert.equal(snapshot[0].label,'Waarom wil je lid worden?');assert.equal(snapshot[2].value,'');
 for(const answers of [{level:'Beginner'},{motivation:'Goed',level:'forged'},{motivation:'x'.repeat(801),level:'Beginner'},{motivation:'Goed',level:'Beginner',extra:'private'}])assert.throws(()=>intakeAnswers(questions,answers));
 for(const input of [Array(13).fill(questions[0]),[questions[0],questions[0]],[{id:'x',label:'Vraag',type:'select',required:false,options:['Zelfde','Zelfde']}],[{id:'x',label:'Vraag',type:'html',required:true}]])assert.throws(()=>intakeQuestions(input));
});
test('v17 grants and branding cannot introduce owner, platform, location or executable assets',async()=>{
 assert.deepEqual(clubGrants(['members.approve']),['members.approve']);for(const grants of [['owner'],['locations.manage'],['platform.admin'],['members.approve','members.approve']])assert.throws(()=>clubGrants(grants));
 assert.equal(clubColor('#ABCDEF'),'#abcdef');for(const color of ['red','#fff','url(javascript:alert(1))'])assert.throws(()=>clubColor(color));assert.equal(clubInk('#ffffff'),'#000000');assert.equal(clubInk('#000000'),'#ffffff');
 for(const value of ['https://untrusted.invalid/logo.png','data:image/svg+xml;base64,'+Buffer.from('<svg onload="alert(1)"/>').toString('base64'),'data:image/png;base64,'+Buffer.from('<script>bad</script>').toString('base64')])await assert.rejects(safeClubLogo(value),{code:'club_logo'});
 const png=await sharp({create:{width:32,height:32,channels:4,background:'#b7f62b'}}).png().toBuffer();const logo=await safeClubLogo('data:image/png;base64,'+png.toString('base64'));assert.match(logo!,/^data:image\/webp;base64,/);const meta=await sharp(Buffer.from(logo!.split(',')[1],'base64')).metadata();assert.equal(meta.width,32);assert.equal(meta.exif,undefined);
 const oversized=await sharp({create:{width:1025,height:8,channels:3,background:'#fff'}}).png().toBuffer();await assert.rejects(safeClubLogo('data:image/png;base64,'+oversized.toString('base64')),{code:'club_logo'});
});
test('v17 app-mail catalog includes receipt/invite and keeps empty decision reasons absent',()=>{
 for(const id of ['club-invite','club-request-received','club-request','club-decision']){const template=templateById(id);assert.equal(template.readOnly,false);assert.equal(template.variables.some(k=>/answer|intake/i.test(k)),false);}
 const template=templateById('club-decision'),without=renderMail(template.id,template.fields,{clubName:'Club',name:'Speler',status:'Afgewezen',reason:''},'https://staging.dartflow.nl','/app/clubs');assert.ok(!without.html.includes('Toelichting'));
 const withReason=renderMail(template.id,template.fields,{clubName:'Club',name:'Speler',status:'Afgewezen',reason:'<b>Een veilige reden</b>'},'https://staging.dartflow.nl','/app/clubs');assert.ok(withReason.html.includes('&lt;b&gt;Een veilige reden&lt;/b&gt;'));
});
