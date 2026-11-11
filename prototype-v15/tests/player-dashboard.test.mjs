import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openPlayerProgramme, renderPlayerDashboard} from '../public/player-dashboard.js';

function context(scope = null) {
  const play = {
    social:{friends:[], blocked:[], requests:[]},
    rooms:{2:{phase:'lobby'}, 3:{phase:'playing'}, 4:{confirmations:[false,false]}},
    leagues:[
      {id:23, name:'Eigen competitie', clubId:null, fixtures:[
        {players:[1,2], status:'proposed', proposedTime:'2050-02-17T19:25'},
        {players:[2,3], status:'scheduled', time:'2050-02-18T19:25'}
      ]},
      {id:42, name:'Clubcompetitie', clubId:8, fixtures:[{players:[1,2], status:'scheduled', time:'2050-02-18T19:25'}]}
    ]
  };
  const db = {play, matches:[
    {id:4, status:'finished', players:[1,2], legs:[2,1], clubId:null},
    {id:3, status:'live', players:[1,3], legs:[1,0], clubId:null},
    {id:2, status:'live', players:[1,2], legs:[0,0], clubId:null}
  ], tournaments:[
    {id:91, name:'Open toernooi', status:'open', date:'2050-03-02', clubId:null},
    {id:92, name:'Toernooi van club 8', status:'active', date:'2050-03-02', clubId:8}
  ]};
  return {
    db, scopeId:() => scope, scopeName:() => 'Dartflow', P:id => ({name:'Speler '+id}),
    esc:value => String(value), icon:() => '', avatar:() => '', badge:text => text,
    button:(label,action,style,attrs='') => `<button data-action="${action}" ${attrs}>${label}</button>`,
    go(route) { this.route = route; }, save() { this.saved = true; }
  };
}

test('Vandaag hervat de actieve partij boven de lobby en gebruikt de juiste agenda', () => {
  const ctx = context();
  const view = renderPlayerDashboard(ctx, () => '');
  assert.match(view, /data-id="3">\s*Hervat je partij/);
  assert.match(view, /Tegen Speler 2/);
  assert.match(view, /17 feb.*19:25/);
  assert.match(view, /Tijdvoorstel/);
  assert.match(view, /Open toernooi/);
  assert.doesNotMatch(view, /Tegen Speler 3|Clubcompetitie|Toernooi van club 8/);

  const clubView = renderPlayerDashboard(context(8), () => '');
  assert.match(clubView, /Clubcompetitie/);
  assert.doesNotMatch(clubView, /Hervat je partij|Eigen competitie/);
});

test('agendalinks selecteren het concrete onderdeel binnen de gekozen omgeving', () => {
  const ctx = context();
  openPlayerProgramme(ctx, 'league', 42);
  assert.equal(ctx.route, undefined);
  openPlayerProgramme(ctx, 'league', 23);
  assert.equal(ctx.db.play.leagueTab, 'fixtures');
  assert.equal(ctx.db.play.selectedLeague, 23);
  assert.equal(ctx.route, 'leagues');
  assert.equal(ctx.saved, true);
  openPlayerProgramme(ctx, 'tournament', 91);
  assert.equal(ctx.db.play.selectedHall, 91);
  assert.equal(ctx.route, 'hall');
});
