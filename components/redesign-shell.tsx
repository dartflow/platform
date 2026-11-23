"use client";

import {useEffect, useState, type ReactNode} from 'react';
import type { MatchView, Overview, Profile, ResultView } from '@/lib/types';
import type {PlaySessionView} from '@/lib/play-session-types';
import { ClubhouseHeaderLogo } from '@/components/clubhouse-theme';
import PlayerExperienceWorkspace from '@/components/player-experience';

const icons = {
  home: <path d="m3 10 9-7 9 7v10h-6v-7H9v7H3Z"/>,
  target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="m12 12 8-8m-4 0h4v4"/></>,
  league: <><path d="M8 4h8v5a4 4 0 0 1-8 0Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 1v5m-4 2h8"/></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-11 4h2m3 0h2m-7 3h2"/></>,
  club: <path d="M3 20h18M5 20V8l7-4 7 4v12m-9 0v-5h4v5m-6-9h.01m8 0h.01"/>,
  feed: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8m-8 4h8m-8 4h4"/></>,
  history: <><path d="M4 20h16M7 16v-5m5 5V5m5 11V9"/><path d="M4 5v12"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,
  menu: <path d="M5 7h14M5 12h14M5 17h14"/>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.7 2.7 0 0 1 5.2.8c0 2-2.7 2.3-2.7 4m0 3h.01"/></>,
  board: <><path d="M4 8V4h4m8 0h4v4M4 16v4h4m8 0h4v-4"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 4v2"/></>,
  bot: <><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 7V4m-4 8h.01m8 0h.01m-6 3h4"/></>,
  bolt: <path d="M13 3 5 14h6l-1 7 9-11h-6Z"/>,
  code: <><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 12h.01m4 0h.01m4 0h.01"/></>,
} satisfies Record<string, ReactNode>;

type IconName = keyof typeof icons;

export function FlowIcon({ name }: { name: IconName }) {
  return <svg className="df-flow-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

type NavLink = { href: string; label: string; icon: IconName };

const playNav: NavLink[] = [
  { href: '/app', label: 'Vandaag', icon: 'home' },
  { href: '/app/play', label: 'Spelen', icon: 'target' },
  { href: '/app/competities', label: 'Competities', icon: 'league' },
  { href: '/app/hall', label: 'Toernooien', icon: 'calendar' },
  { href: '/app/clubs', label: 'Verenigingen', icon: 'club' },
];
const personalNav: NavLink[] = [
  { href: '/app/feed', label: 'Community', icon: 'feed' },
  { href: '/app/statistics', label: 'Statistieken', icon: 'history' },
  { href: '/app/settings', label: 'Instellingen', icon: 'settings' },
];
const controlNav: NavLink[] = [
  { href: '/app/dashboard', label: 'Organiseren', icon: 'calendar' },
  { href: '/app/platform/integraties', label: 'Platformbeheer', icon: 'settings' },
];

export function activeNav(href: string, path: string) {
  if (href === '/app/play' && /^\/(?:app\/(?:play|practice|training|uitdagingen|lobby|baan)(?:\/|$)|wedstrijd\/|baan\/|spelen(?:\/|$))/.test(path)) return true;
  if (href === '/app/platform/integraties' && /^\/app\/(platform|admin)(?:\/|$)/.test(path)) return true;
  if (href === '/app/hall' && /^\/app\/(?:hall|tournaments|events)(?:\/|$)/.test(path)) return true;
  if (href === '/app/competities' && /^\/app\/(?:competities|leagues|competitions)(?:\/|$)/.test(path)) return true;
  return href === path || href !== '/app' && path.startsWith(href + '/');
}

export function DesktopNavigation({ path, onMore, moreOpen, canOrganize, canManagePlatform }: {
  path: string;
  onMore: () => void;
  moreOpen: boolean;
  canOrganize: boolean;
  canManagePlatform: boolean;
}) {
  function links(items: NavLink[]) {
    return items.map(({ href, label, icon }) => (
      <a className="df-rail-link" key={href} href={href} aria-current={activeNav(href, path) ? 'page' : undefined}>
        <FlowIcon name={icon}/><span>{label}</span>
      </a>
    ));
  }

  return <aside className="df-app-rail">
    <a className="df-rail-brand" href="/app" aria-label="DartFlow · Vandaag"><ClubhouseHeaderLogo/></a>
    <nav className="df-rail-nav" aria-label="Desktopnavigatie">
      <div className="df-nav-group">{links(playNav)}</div>
      <div className="df-nav-group">{links(personalNav)}</div>
      {canOrganize && <div className="df-nav-group">{links(canManagePlatform ? controlNav : controlNav.slice(0, 1))}</div>}
      <button className="df-rail-link" type="button" onClick={onMore} aria-expanded={moreOpen}><FlowIcon name="menu"/>Meer</button>
    </nav>
    <div className="df-rail-foot">{links([{ href: '/help', icon: 'help', label: 'Hulp & FAQ' }])}</div>
  </aside>;
}

type TodayEvent = { id: string; name: string; kind: string; clubId: string | null; state: Record<string, unknown> };
type Friend = { id: string; name: string; status: string; favorite: boolean };

const formatToday = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Amsterdam' });
const eventDay = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', timeZone: 'Europe/Amsterdam' });
const eventMonth = new Intl.DateTimeFormat('nl-NL', { month: 'short', timeZone: 'Europe/Amsterdam' });
const eventTime = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word.charAt(0)).join('').toUpperCase();
}

export function RedesignedToday({ data, overview, clubId }: {
  data: { profile: Profile; matches?: MatchView[]; history?: ResultView[]; friends: Friend[]; clubs: { id: string; members: { id: string; status: string }[] }[]; trainings: { ownerId: string }[]; leagues: TodayEvent[]; tournaments: TodayEvent[] };
  overview: Overview | null;
  clubId: string;
}) {
  const user = data.profile;
  const matches = (data.matches || overview?.matches || []).filter(match => match.players.some(player => player.id === user.id));
  const [plays, setPlays] = useState<PlaySessionView[]>([]);
  const [playError, setPlayError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/play/mine', {cache:'no-store', signal:AbortSignal.timeout(10000)});
        if (!response.ok) throw Error('Je vrije partijen konden niet worden opgehaald.');
        const next = await response.json();
        if (!Array.isArray(next.sessions)) throw Error('Je vrije partijen konden niet worden opgehaald.');
        if (active) {setPlays(next.sessions); setPlayError('');}
      } catch (error) {if (active) setPlayError(error instanceof Error ? error.message : 'Je vrije partijen konden niet worden opgehaald.');}
    };
    void load();
    const timer = setInterval(() => {if (document.visibilityState === 'visible') void load();}, 15000);
    return () => {active = false; clearInterval(timer);};
  }, []);
  const live = matches.find(match => match.status === 'live');
  const free = plays.find(play => play.status === 'active' && play.game.status !== 'finished');
  const confirmation = matches.find(match => match.status === 'result' && match.players.some((player, index) => player.id === user.id && !match.confirmations[index]));
  const match = live || (!free ? confirmation : undefined);
  const scores = match && (match.cricket?.points ?? match.tactics?.points ?? match.remaining);
  const freeSides = free?.game.sides.map((side, index) => {
    const progress = free.game.progress;
    const score = progress.mode === 'x01' ? progress.remaining[index]
      : progress.mode === 'cricket' || progress.mode === 'tactics' ? progress.points[index]
      : progress.mode === 'around' ? progress.targets[progress.targetIndex[index]] ?? '✓'
      : progress.mode === 'bingo' ? progress.filled[index]?.filter(Boolean).length ?? 0
      : progress.remaining;
    return {id:side.id, name:side.playerIds.map(id=>free.participants.find(player=>player.id===id)?.name ?? 'Speler').join(' / '), score, legs:free.game.legs[index]??0};
  }) ?? [];
  const featuredId = match?.id ?? free?.id;
  const friends = data.friends.filter(friend => friend.status === 'friend').sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'nl')).slice(0, 3);
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const events = [...data.tournaments, ...data.leagues]
    .filter(event => !clubId || event.clubId === clubId)
    .map(event => ({ ...event, at: new Date(String(event.state.startsAt || event.state.date || '')) }))
    .filter(event => Number.isFinite(event.at.getTime()) && event.at >= todayStart && event.state.cancelled !== true && event.state.closed !== true && event.state.completed !== true && event.state.archived !== true && !['archived', 'finished', 'completed', 'cancelled', 'canceled'].includes(String(event.state.status)))
    .sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 3);
  const metrics = [
    ['Uitslagen', data.history?.length ?? overview?.history.length ?? 0, '/app/mymatches'],
    ['Trainingen', data.trainings.filter(training => training.ownerId === user.id).length, '/app/training'],
    ['Verzoeken', data.friends.filter(friend => friend.status === 'incoming').length, '/app/friends'],
    ['Verenigingen', data.clubs.filter(club => club.members.some(member => member.id === user.id && member.status === 'active')).length, '/app/clubs'],
  ] as const;
  const lead = user.displayName?.trim() || user.name;

  return <div className="df-today">
    <header className="df-today-heading">
      <div><p className="df-today-date">{formatToday.format(now)}</p><h1>Hoi {lead.split(/\s+/)[0]}.</h1></div>
      <a className="df-quiet-link df-today-schedule-link" href="/app/speeldag"><FlowIcon name="calendar"/>Mijn speeldag</a>
    </header>
    {playError&&<p className="notice error" role="status">{playError} <a href="/historie">Open je partijen</a></p>}
    <div className="df-today-lead">
      <section className="df-play-hero" aria-label="Nieuwe partij">
        <div className="df-play-hero-copy"><h2>Vrij spelen</h2><p>Solo, samen of tegen de Dartbot.</p>
          <a className="button gold df-hero-action" href="/app/play">Kies een spel</a>
        </div>
      </section>
      {match || free ? <section className="df-current-panel" aria-label="Jouw wedstrijd">
        <div className="df-section-head"><h2>Jouw wedstrijd</h2><span className="df-status">{free || match?.status === 'live' ? 'Live' : 'Uitslag'}</span></div>
        <div className="df-current-scores">
          {match?.players.map((player, index) => <div className="df-current-player" key={player.id} data-turn={match.turn === index}>
            <span>{player.displayName || player.name}</span><strong>{scores?.[index] ?? '–'}</strong><small>{match.legs[index] ?? 0} {match.legs[index]===1?'leg':'legs'}</small>
          </div>)}
          {!match && freeSides.map((side,index)=><div className="df-current-player" key={side.id} data-turn={free?.game.turn===index}><span>{side.name}</span><strong>{side.score}</strong><small>{side.legs} {side.legs===1?'leg':'legs'}</small></div>)}
        </div>
        <a className="button df-card-action" href={match ? `/wedstrijd/${match.id}` : `/spelen/${free!.id}`}>{free || match?.status === 'live' ? 'Hervat je partij' : 'Bevestig je uitslag'}</a>
      </section> : <section className="df-current-panel df-board-hero" aria-label="Baan openen">
        <FlowIcon name="board"/><h2>Spelen op locatie</h2><p>Open de baan en volg de stand op Oche Live.</p>
        <a className="button df-card-action" href="/app/baan">Bekijk de banen</a>
      </section>}
    </div>
    <nav className="df-today-actions" aria-label="Snel naar">
      {([
        ['board', 'Baanmodus', '/app/baan'],
        ['bolt', 'Oefenen', '/app/practice'],
        ['code', 'Wedstrijdcode', '/app/lobby'],
      ] as const).map(([icon, label, href]) => <a key={href} href={href}><FlowIcon name={icon}/><span>{label}</span></a>)}
    </nav>
    <div className="df-today-details">
      <section className="df-today-list df-today-program">
        <div className="df-section-head"><h2>Op de agenda</h2><a className="df-quiet-link" href="/app/events">Alle evenementen</a></div>
        {events.length ? <ul>{events.map(event => <li key={event.id}><a className="df-program-item" href={`/app/${event.kind === 'league' ? 'leagues' : 'hall'}/${event.id}`}>
          <span className="df-date-tile"><strong>{eventDay.format(event.at)}</strong><small>{eventMonth.format(event.at).replace(/\.$/, '')}</small></span>
          <span className="df-list-text"><strong>{event.name}</strong><small>{eventTime.format(event.at)} · {event.kind === 'league' ? 'Competitie' : 'Toernooi'}</small></span>

        </a></li>)}</ul> : <p className="df-empty-copy">Er staat nog niets op je agenda.</p>}
        <PlayerExperienceWorkspace compact resumeExcept={featuredId}/>
      </section>
      <section className="df-today-list df-today-social">
        <div className="df-section-head"><h2>Vrienden</h2><a className="df-quiet-link" href="/app/friends">Alle vrienden</a></div>
        {friends.length ? <ul>{friends.map(friend => <li key={friend.id}><a className="df-friend-item" href="/app/friends">
          <span className="df-friend-avatar" aria-hidden="true">{initials(friend.name)}</span><strong>{friend.name}</strong>{friend.favorite && <small>Favoriet</small>}
        </a></li>)}</ul> : <p className="df-empty-copy">Zoek een vriend om samen te spelen.</p>}
        <a className="df-community-link" href="/app/feed"><FlowIcon name="feed"/>Bekijk de community</a>
      </section>
    </div>
    <nav className="df-today-metrics" aria-label="Jouw overzicht">
      {metrics.map(([label, count, href]) => <a href={href} key={label}><strong>{count}</strong><span>{label}</span></a>)}
    </nav>
  </div>;
}
