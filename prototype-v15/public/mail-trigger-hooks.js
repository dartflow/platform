/** Explicit transactional demo hooks. Recipients come from stored player records. */
export function mailUrl(ctx, route) {
  const origin = ctx.baseUrl || (typeof location !== 'undefined' ? location.origin + location.pathname : 'https://dartflow.example/');
  return `${origin.replace(/#.*$/, '').replace(/\/$/, '')}/#${route}`;
}
export function playerMail(ctx, templateId, eventId, scopeId, playerId, variables = {}) {
  const person = ctx.db.players.find(p => Number(p.id) === Number(playerId));
  if (!person?.email) return null;
  const club = ctx.db.play?.clubs?.items?.find(c => String(c.id) === String(scopeId));
  return ctx.emitMail?.({templateId,eventId:String(eventId),scopeId:scopeId??null,recipient:{name:person.name,email:person.email},variables:{name:person.name,actorName:ctx.db.players.find(p=>p.id===1)?.name||'Een speler',clubName:club?.name||'Dartflow Wereldwijd',actionUrl:mailUrl(ctx,'home'),...variables}});
}
export function clubTeamMail(ctx, templateId, eventId, club, variables = {}) {
  for (const member of club.members.filter(m => ['owner','admin'].includes(m.role))) playerMail(ctx,templateId,eventId,club.id,member.id,variables);
}

/** Reads only new committed venue log entries, including calls from automatic scheduling. */
export function collectVenueMailEvents(previous, next, players = [], origin = 'https://dartflow.example', clubs = []) {
  if (!previous || !next || previous === next || String(previous.id)!==String(next.id)) return [];
  const events = [];
  const fresh = (next.log||[]).filter(log => Number(log.id)>Number(previous.sequence||0)).reverse();
  const club = clubs.find(c=>String(c.id)===String(next.clubId));
  const clubName = club?.name || (next.clubId ? 'Jouw vereniging' : 'Dartflow Wereldwijd');
  const send = (templateId, log, ids, extra = {}) => {
    for (const id of [...new Set(ids.filter(Boolean))]) {
      const person = players.find(p=>Number(p.id)===Number(id));
      if (!person?.email) continue; // Guest entries without an address never receive fabricated mail.
      const match = (next.matches||[]).find(m=>String(m.id)===String(log.matchId));
      const opponent = match?.players?.find(p=>Number(p)!==Number(id));
      events.push({templateId,eventId:`venue:${next.id}:log:${log.id}`,scopeId:next.clubId??null,recipient:{name:person.name,email:person.email},variables:{name:person.name,actorName:person.name,clubName,eventName:next.name,opponentName:players.find(p=>Number(p.id)===Number(opponent))?.name||'Je tegenstander',actionUrl:`${origin.replace(/\/$/,'')}/#venue${match?'/result/'+encodeURIComponent(match.id):'/entries'}`,startScore:next.settings.startScore,bestOf:match?.bestOf||next.settings.bestOf,...extra}});
    }
  };
  for (const log of fresh) {
    const p = next.players.find(p=>Number(p.id)===Number(log.playerId));
    const m = next.matches.find(m=>String(m.id)===String(log.matchId));
    if (log.type==='signup' && p) send(p.signup==='waitlisted'?'tournament-waitlist':'tournament-approved',log,[p.id],{status:p.signup==='waitlisted'?'Op de wachtlijst':'Ingeschreven'});
    if (log.type==='promoted' && p) send('tournament-promoted',log,[p.id],{status:'Je hebt een plaats'});
    if (log.type==='withdrawn' && p) send('tournament-withdrawn',log,[p.id],{status:'Afgemeld'});
    if (log.type==='called' && m && m.status==='called') send('board-call',log,m.players,{boardName:next.boards.find(b=>b.id===log.boardId)?.name||log.boardId,time:new Intl.DateTimeFormat('nl-NL',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Amsterdam'}).format(new Date(log.at)),actionUrl:`${origin.replace(/\/$/,'')}/#venue/board-${log.boardId}`});
    if (log.type==='pending' && m?.status==='pending') send('result-confirm',log,m.players,{score:m.score?.join(' – ')||'Nog te controleren'});
    if (log.type==='disputed' && m) {
      send('result-disputed',log,m.players,{actorName:m.players.map(id=>players.find(p=>Number(p.id)===Number(id))?.name||'Speler').join(' tegen '),score:m.score?.join(' – ')||'Nog te controleren',reason:m.dispute?.reason||log.reason||'Controle aangevraagd'});
      const adminIds=club ? club.members.filter(member=>['owner','admin'].includes(member.role)).map(member=>member.id) : next.clubId == null ? [9] : [];
      send('result-disputed',log,adminIds.filter(id=>!m.players.includes(id)),{actorName:m.players.map(id=>players.find(p=>Number(p.id)===Number(id))?.name||'Speler').join(' tegen '),score:m.score?.join(' – ')||'Nog te controleren',reason:m.dispute?.reason||log.reason||'Controle aangevraagd'});
    }
    if (log.type==='confirmed' && m) send(m.resolution?'result-resolved':'result-confirmed',log,m.players,{score:m.score?.join(' – '),reason:m.resolution?.reason||'Door beide spelers bevestigd'});
  }
  return events;
}
