"use client";
import {Fragment, useEffect, useRef, type ReactNode} from 'react';
import type {PublicSnapshot} from '@/lib/types';
import {buildOcheScorecard, ocheScorecardScroll, ochePlayerInitials, type OcheScorecard} from '@/lib/oche-scorecard';
import {OcheFullscreen} from './oche-live-standby';
import {OcheHeadToHead,OcheMatchRecap} from './oche-statistics';

export default function SprintDisplay({snapshot, stale, qr, scanInstruction, overlay, activityOverlay, controls}: {
  snapshot: PublicSnapshot;
  stale: boolean;
  qr: ReactNode;
  scanInstruction?: string;
  overlay?: ReactNode;
  activityOverlay?: ReactNode;
  controls?: ReactNode;
}) {
  const match = snapshot.match!;
  const card = buildOcheScorecard(match, snapshot.sessionKey, snapshot.scoreEvents);
  const scroll = useRef<HTMLDivElement>(null);
  const previous = useRef<OcheScorecard | null>(null);
  const wasStale = useRef(stale);
  const finished = ['result','confirmed','disputed'].includes(match.status);
  const last = card.lastVisit;
  useEffect(() => {
    const node = scroll.current;
    const decision = ocheScorecardScroll(previous.current, card, !stale && !wasStale.current);
    previous.current = card;
    wasStale.current = stale;
    if (!node) return;
    if (decision === 'reset') {node.scrollTop = 0; return;}
    if (decision !== 'reveal') return;
    const latest = node.querySelector<HTMLTableRowElement>(`tbody tr[data-row="${card.filledRows - 1}"]`);
    if (!latest) return;
    // Layout offsets retain the logical scorecard Y-axis when the cast surface is rotated.
    let top = 0;
    for (let item: HTMLElement | null = latest; item && item !== node; item = item.offsetParent as HTMLElement | null) top += item.offsetTop;
    const bottom = top + latest.offsetHeight;
    const heading = node.querySelector('thead')?.offsetHeight ?? 0;
    if (bottom > node.scrollTop + node.clientHeight + .5) node.scrollTop = bottom - node.clientHeight;
    else if (top < node.scrollTop + heading - .5) node.scrollTop = Math.max(0, top - heading);
  }, [card, stale]);
  return <main className="sprint-display bf-display oche-match-display" aria-label="Oche Live-baanscherm">
    <div className="bf-display__frame sprint-frame">
      <div className="sprint-atmosphere" aria-hidden="true"><i className="sprint-target"/><i className="sprint-streaks"/></div>
      {overlay}
      <section className="sprint-board" data-solo={match.players.length === 1} aria-label="Oche Live-scorebord">
        <header className="sprint-brand-row sprint-head"><img src="/assets/dartflow-logo.svg" alt="DartFlow"/><span className="sprint-board-badge" title={snapshot.board.name}>{snapshot.board.name}</span></header>
        <div className="sprint-match-content">{activityOverlay}<div className="sprint-playing" data-solo={match.players.length === 1}>
          <div className="sprint-top"><div className="sprint-heading"><h1>{match.settings.startScore} <em>Dubbel uit</em></h1><p>{match.players.length === 1 ? 'Solo training' : snapshot.boardActivity?.kind === 'official' ? snapshot.event.name : match.scoringMode === 'per-player' ? 'Thuis / hybride' : 'Lokale wedstrijd'}</p></div><span className="sprint-status" data-online={!stale}>{stale ? 'Offline' : finished ? match.resultPublished ? 'Uitslag bevestigd' : 'Uitslag' : match.paused ? 'Gepauzeerd' : match.status === 'live' ? 'Live' : 'Wacht'}</span></div>
          <div className="sprint-roster" aria-label="Spelers en resterende scores">{match.players.map((player,index) => {const stats = match.stats?.[index],projected=snapshot.statistics?.players.find(item=>item.playerIndex===index),average=projected?projected.live.average:stats?.measurementComplete===false?null:stats?.average??(stats?.darts?stats.total/stats.darts*3:null);return <div className="sprint-player" key={player.id} data-turn={index === match.turn && !finished}>
            <div className="sprint-identity"><span className="sprint-avatar" aria-hidden="true">{ochePlayerInitials(player.name)}</span><div className="sprint-player-label"><h2 className="sprint-player-name" title={player.name}>{player.name}</h2><small className="sprint-history-average" aria-label={projected?.last50?`Historisch gemiddelde ${player.name}`:undefined}>{projected?.last50?`Laatste 50 · ${projected.last50.average.toFixed(1).replace('.',',')}`:'\u00a0'}</small></div></div>
            <div className="sprint-score" data-active={index === match.turn && !finished} aria-label={player.name}><span className="sprint-caption">Resterend</span><strong className="sprint-number">{match.remaining[index]}</strong><span className="sprint-turn">{finished ? 'Uitgespeeld' : index === match.turn ? 'Aan de beurt' : 'Wacht'}</span></div>
            <dl className="sprint-stats" aria-label={`Statistieken ${player.name}`}><div><dt title="Live 3-dartsgemiddelde">Live AVG</dt><dd>{average==null?'–':average.toFixed(1).replace('.',',')}</dd></div><div><dt title="Hoogste finish">H. FIN</dt><dd>{projected?.live.highestFinish||stats?.highestFinish||'–'}</dd></div><div><dt>180’s</dt><dd>{projected?.live.oneEighties??stats?.oneEighties??0}</dd></div></dl>
          </div>;})}</div>
          <section className="sprint-countdown" aria-labelledby="sprint-scorecard-title">
            <header className="sprint-card-heading"><h2 id="sprint-scorecard-title">Scorekaart</h2><p>Set {card.setNumber} · Leg {card.legNumber}</p></header>
            <div className="sprint-scroll" ref={scroll} tabIndex={0} role="region" aria-label="Beurten in deze leg" data-leg-key={card.legKey}>
              <table className="sprint-table" aria-label={`Scorekaart van ${match.players.map(player => player.name).join(' en ')}`}>
                <colgroup><col className="sprint-col-throw"/><col className="sprint-col-rest"/>{match.players.length > 1 && <><col className="sprint-col-rest"/><col className="sprint-col-throw"/></>}</colgroup>
                <thead><tr className="sprint-labels"><th scope="col">Worp</th><th scope="col">Rest</th>{match.players.length > 1 && <><th scope="col">Rest</th><th scope="col">Worp</th></>}</tr><tr className="sprint-start" aria-label="Startscore"><td>–</td><td>{card.startScore}</td>{match.players.length > 1 && <><td>{card.startScore}</td><td>–</td></>}</tr></thead>
                <tbody>{card.rows.map(row => <tr key={row.index} data-row={row.index}>{row.cells.map((cell,side) => {const visit = cell.visit;const thrown = <td className="sprint-throw" data-bust={visit?.bust || false} aria-label={visit?.bust ? `${visit.score}, bust` : undefined}>{visit?.score ?? ''}</td>;const rest = <td className="sprint-rest" data-latest={cell.latest}>{visit?.remainingAfter ?? ''}</td>;return <Fragment key={side}>{side === 0 ? <>{thrown}{rest}</> : <>{rest}{thrown}</>}</Fragment>;})}</tr>)}</tbody>
              </table>
            </div>
          </section>
          {!['live','result','confirmed','disputed'].includes(match.status)&&snapshot.statistics?.headToHead?<OcheHeadToHead statistics={snapshot.statistics}/>:<aside className="sprint-insight"><span>{finished ? 'Wedstrijduitslag' : match.checkout ? 'Finishroute' : last?.score === 180 && !last.bust ? 'Maximum' : 'Laatste beurt'}</span><strong>{finished ? match.players.find(player => player.id === match.winnerId)?.name || 'Gelijkspel' : match.checkout || (last ? `${match.players[last.playerIndex]?.name ?? 'Speler'} · ${last.score} punten${last.bust ? ' · bust' : ''}` : 'Nog geen worpen')}</strong></aside>}
        </div>{finished&&<OcheMatchRecap statistics={snapshot.statistics}/>}</div>
        <footer className="sprint-foot"><span className="sprint-format">DartFlow · Baanmodus</span><div className="sprint-foot-controls"><details className="sprint-info"><summary aria-label="Wedstrijdinformatie" title="Wedstrijdinformatie"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></svg></summary><div><h2>Wedstrijdinformatie</h2><p>{match.settings.startScore} · Dubbel uit · Best of {match.settings.bestOfLegs} legs</p><div className="sprint-tally" aria-label="Set- en legstand">{match.players.map((player,index) => <p key={player.id}>{player.name}: <b>{match.legs[index]}</b> legs{match.settings.bestOfSets > 1 && <> · <b>{match.sets[index]}</b> sets</>}</p>)}</div><p className="sprint-writer">{scanInstruction || (match.writerId ? `${match.players.find(player=>player.id===match.writerId)?.name || 'Schrijver'} voert in` : 'Score-invoer via telefoon')}</p><div className="sprint-qr">{qr}</div></div></details>{controls}<OcheFullscreen/></div></footer>
      </section>
    </div>
  </main>;
}
