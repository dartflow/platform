"use client";
import ScoreInputSettings from './score-input-settings';
import {RedesignedToday} from './redesign-shell';
import LegacyTrainingOffline from './legacy-training-offline';
import X01OpeningField from './x01-opening-field';
import ProfileIdentityFields from './profile-identity-fields';
import {socialIdentityLabel} from '@/lib/public-identity';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Overview, Profile, MatchView, ResultView, ClubBoardView } from "@/lib/types";
import { ClubBoardQr } from "./club-board-screen";
import MailWorkspace from "./mail-workspace";
import LocalPlayerAdd from "./local-player-add";
import ScreenDeviceManager from "./screen-device-manager";
import IntegrationsPanel from "./integrations-panel";
import BlogWorkspace from "./blog-workspace";
import {CommunityRulesGate,SafetyActions} from './player-safety';
import {FeedSpace,ScopedChat} from './community-space';
import {ClubWorkspace} from './club-ui';
import ClubhouseWorkspace,{PlatformBrandingAdministration} from './clubhouse-workspace';
import {ThemePreferencePicker} from './clubhouse-theme';
import LocationWorkspace from './location-workspace';
import type {ClubEntity} from '@/lib/club-types';
import RankingEventPanel from './ranking-event-panel';
import OrganizerDrafts from './organizer-drafts';
import TournamentManagementPanel,{ConsolationFields} from './tournament-management-panel';
import OrganizerParticipantsPanel,{GuestClaimsPanel}from'./organizer-participants';
import TournamentPlanning,{readTournamentPlanning} from './tournament-planning';
import {StartProcedureFields,readWinByTwo} from './bull-start-panel';
import {PlayerPinSettings,PlayerStatisticsPanel,ProfileStatisticsLinks} from './player-profile';

type RecordValue = Record<string, unknown>;
type Member = {
  id: string;
  name: string;
  role: string;
  status: string;
  attributes?: RecordValue;
};
type Entity = {
  id: string;
  kind: string;
  name: string;
  ownerId: string;
  clubId: string | null;
  visibility: string;
  revision: number;
  state: RecordValue;
  members: Member[];
  canManage?: boolean;
  inviteCode?: string;
  boardActivity?:import("@/lib/board-activity-types").BoardActivityView;
  clubAccess?:import('@/lib/club-types').ClubAccess;
};
type Platform = {
  profile: Profile;
  matches?: MatchView[];
  history?: ResultView[];
  players: Profile[];
  clubs: Entity[];
  clubBoards?: ClubBoardView[];
  rooms: Entity[];
  trainings: Entity[];
  leagues: Entity[];
  tournaments: Entity[];
  lobbies: Entity[];
  friends: { id: string; name: string; status: string; favorite: boolean }[];
  blocked: Profile[];
  preferences: RecordValue;
  reports?: RecordValue[];
  registrations?: RecordValue[];
  statistics?: RecordValue;
  canManageRegistrations?: boolean;
};
type Action = Record<string, unknown> & { type: string };
type Result = {
  ok: boolean;
  id?: string;
  entity?: Entity;
  matchId?: string;
  code?: string;
  url?: string;
  token?: string;
  kind?: string;
  grantId?: string;
  screenUrl?: string;
};
function navigate(path: string) {
  window.location.assign(new URL(path, window.location.origin).href);
}
type ImmutableAttempt = {requestId:string;expectedRevision:number};
type Command = (action: Action, entity?: Entity, attempt?: ImmutableAttempt) => Promise<Result | undefined>;

function inviteDetails(value: string): { id?: string; code: string } {
  const input = value.trim();
  try {
    const url = new URL(input, location.origin);
    if (url.origin !== location.origin || url.username || url.password || url.hash) return { code: "" };
    const short = /^\/w\/([A-Za-z0-9]{4})$/.exec(url.pathname);
    if (short) return { code: short[1].toUpperCase() };
    if (url.pathname.startsWith("/app/")) {
      return {
        id: url.pathname.split("/").filter(Boolean).at(-1),
        code: url.searchParams.get("code") || "",
      };
    }
  } catch {
    /* A plain invitation code is valid input. */
  }
  return { code: /^[A-Za-z0-9]{4}$/.test(input) ? input.toUpperCase() : input };
}
function invitationLink(section: string, id: string, code: string) {
  return /^[A-Za-z0-9]{4}$/.test(code)
    ? `/w/${code.toUpperCase()}`
    : entityUrl(section, id, code);
}
function ShareInvitation({ section, id, entity }: { section: string; id: string; entity?: Entity }) {
  const code = entity?.inviteCode || invitationCode();
  const [copyStatus, setCopyStatus] = useState("");
  const link = invitationLink(section, id, code);
  return code ? (
    <div className={`notice${section==='lobby'?' play-lobby-code':''}`}>
      <strong>Uitnodigingscode</strong>
      <p className="workspace-code">{code}</p>
      <p>Deel de code of link met de bedoelde speler. Een nieuwe uitnodiging is zeven dagen geldig.</p>
      <a className="text-link" href={link}>
        {typeof location === "undefined" ? "" : location.origin}{link}
      </a>
      <div className="button-row">
        <button className="button ghost small" type="button" onClick={async () => {
          try {
            await navigator.clipboard.writeText(new URL(link, location.origin).href);
            setCopyStatus("Uitnodigingslink gekopieerd.");
          } catch { setCopyStatus("Kopiëren is niet gelukt. Kopieer de getoonde link handmatig."); }
        }}>Uitnodigingslink kopiëren</button>
      </div>
      <p role="status">{copyStatus}</p>
    </div>
  ) : null;
}
function invitationCode() {
  const code = typeof location === "undefined" ? "" : new URLSearchParams(location.search).get("code") || "";
  return /^[A-Za-z0-9]{4}$/.test(code) ? code.toUpperCase() : code;
}
function entityUrl(section: string, id: string, code?: string) {
  return `/app/${section}/${id}${code ? `?code=${encodeURIComponent(code)}` : ""}`;
}
async function joinInvitation(command: Command, type: string, value: string) {
  const parsed = inviteDetails(value);
  let id = parsed.id;
  if (!id) {
    const resolved = await command({ type: "invitation.resolve", code: parsed.code });
    id = resolved?.id;
  }
  if (!id) return;
  return command({ type, id, code: parsed.code });
}
const record = (v: unknown): RecordValue =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as RecordValue) : {};
const list = (v: unknown): RecordValue[] =>
  Array.isArray(v)
    ? (v.filter((x) => x && typeof x === "object") as RecordValue[])
    : [];
const text = (v: unknown, fallback: string | number = ""): string =>
  v === undefined || v === null ? String(fallback) : String(v);
const number = (v: unknown, fallback = 0) =>
  v === null || v === undefined || v === ""
    ? fallback
    : Number.isFinite(Number(v))
      ? Number(v)
      : fallback;
const statusLabel: Record<string, string> = {
  active: "Actief",
  finished: "Afgerond",
  completed: "Afgerond",
  draft: "Concept",
  archived: "Gearchiveerd",
  cancelled: "Geannuleerd",
  canceled: "Geannuleerd",
  open: "Inschrijving open",
  planned: "Gepland",
  scheduled: "Gepland",
  live: "Live",
  confirmed: "Bevestigd",
  pending: "In behandeling",
  accepted: "Geaccepteerd",
  waitlisted: "Wachtlijst",
  registered: "Ingeschreven",
  member: "Lid",
  owner: "Eigenaar",
  admin: "Beheerder",
  captain: "Captain",
  requested: "Aangevraagd",
  proposed: "Tijdvoorstel",
  rejected: "Afgewezen",
  ready: "Gereed",
  lobby: "Lobby",
  public: "Openbaar",
  private: "Besloten",
  club: "Club",
  bot: "Dartbot",
  solo: "Solo X01",
  around: "Around the board",
  "170": "170-challenge",
};
function Label({ value }: { value: unknown }) {
  const v = text(value);
  return <span className="badge muted">{statusLabel[v] || v || "—"}</span>;
}
function Title({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="workspace-heading">
      <div>
        <p className="eyebrow">JOUW DARTFLOW</p>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="button-row">{actions}</div>}
    </header>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="workspace-empty">
      <span aria-hidden="true">◎</span>
      <p>{children}</p>
    </div>
  );
}
function Link({
  to,
  children,
  primary = false,
}: {
  to: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <a className={`button ${primary ? "gold" : "ghost"}`} href={`/app/${to}`}>
      {children}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
function Tile({
  title,
  children,
  to,
  label,
  accent = false,
}: {
  title: string;
  children: ReactNode;
  to: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <article
      className={`panel workspace-tile ${accent ? "workspace-tile-accent" : ""}`}
    >
      <span className="workspace-tile-symbol" aria-hidden="true">
        ◎
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      <Link to={to} primary={accent}>
        {label}
      </Link>
    </article>
  );
}
function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`button ${primary ? "gold" : "ghost"} small`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  disabled = false,
  maxLength,
  children,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  disabled?: boolean;
  maxLength?: number;
  children?: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children ? (
        <select
          name={name}
          defaultValue={defaultValue}
          required={required}
          disabled={disabled}
        >
          {children}
        </select>
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={defaultValue}
          required={required}
          disabled={disabled}
          maxLength={maxLength}
        />
      )}
    </label>
  );
}
function Form({
  title,
  children,
  onSubmit,
  submit = "Opslaan",
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<void>;
  submit?: string;
  busy?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="panel workspace-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(new FormData(event.currentTarget));
      }}
    >
      <h2>{title}</h2>
      {children}
      <button className="button gold" disabled={busy}>
        {busy ? "Even geduld…" : submit}
      </button>
    </form>
  );
}
function Scope({
  data,
  defaultValue,
  permission,
  personal=false,
}: {
  data: Platform;
  defaultValue?: string;
  permission?:'competitions.manage'|'tournaments.manage';
  personal?:boolean;
}) {
  const manageable = data.clubs.filter((club) => permission?club.clubAccess?.permissions.includes(permission):club.canManage);
  return (
    <Field
      label="Omgeving"
      name="clubId"
      defaultValue={
        defaultValue ??
        (personal?'personal':data.canManageRegistrations ? "" : manageable[0]?.id || "")
      }
    >
      {personal&&<option value="personal">Persoonlijk · geen officiële rankingpunten</option>}
      {(!personal||data.canManageRegistrations)&&<option value="">Namens DartFlow</option>}
      {manageable.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Field>
  );
}
function iso(value: unknown) {
  const raw = text(value);
  const date = new Date(raw.length === 10 ? raw + "T12:00:00" : raw);
  return Number.isNaN(date.getTime())
    ? "Datum volgt"
    : date.toLocaleString("nl-NL", {
        dateStyle: "medium",
        ...(raw.length === 10 ? {} : { timeStyle: "short" }),
      });
}

function ruleInput(form:FormData){
  if(form.get('discipline')==='tactics')return{...readWinByTwo(form),discipline:'tactics' as const,tacticsPreset:form.get('tacticsPreset')==='tactics-3'?'tactics-3' as const:'tactics-5' as const,tacticsMode:form.get('tacticsMode')==='no-score'?'no-score' as const:'standard' as const};
  if(form.get('discipline')==='cricket')return{...readWinByTwo(form),discipline:'cricket' as const,cricketMode:form.get('cricketMode')==='no-score'?'no-score' as const:'standard' as const};
  const inRule=text(form.get('inRule')),outRule=text(form.get('outRule')),home=text(form.get('homeStart')),away=text(form.get('awayStart'));
  return {...readWinByTwo(form),...(['single','double'].includes(inRule)?{inRule}:{}),...(outRule&&outRule!=='double'?{outRule}:{}),...(home||away?{sideStartScores:[Number(home),Number(away)]}:{})};
}
function RulesFields({allowTactics=true,freshX01=false,bot=false}:{allowTactics?:boolean;freshX01?:boolean;bot?:boolean}){
 const[discipline,setDiscipline]=useState('x01');
 if(bot)return <details className="panel"><summary>Openingsregel</summary><X01OpeningField fresh={freshX01}/><p>Dartbot gebruikt dubbel uit. De bot registreert zijn eigen geldige pijlen op de server.</p></details>;
 return <details className="panel"><summary>Discipline, spelregels en handicap</summary><div className="field-grid">{!bot&&<label className="field">Discipline<select name="discipline"value={discipline}onChange={event=>setDiscipline(event.target.value)}><option value="x01">X01</option><option value="cricket">Cricket</option>{allowTactics&&<option value="tactics">Tactics</option>}</select></label>}
 {discipline==='tactics'?<><Field label="Tactics-preset"name="tacticsPreset"defaultValue="tactics-5"><option value="tactics-5">Tactics 5 · 20–10 en bull · 5 treffers</option><option value="tactics-3">Tactics 3 · 20–10 en bull · 3 treffers</option></Field><Field label="Tacticsvariant"name="tacticsMode"defaultValue="standard"><option value="standard">Met punten</option><option value="no-score">Zonder punten · als eerste sluiten</option></Field><p>Tactics 5 vereist bij punten strikt meer punten; een volledig gesloten gelijk veld wordt in dezelfde leg overgespeeld. Tactics 3 mag bij gelijke punten sluiten.</p></>:discipline==='cricket'?<Field label="Cricketvariant"name="cricketMode"defaultValue="standard"><option value="standard">Standaard · marks en punten</option><option value="no-score">No score · als eerste sluiten</option></Field>:<><X01OpeningField fresh={freshX01}/><Field label="Uitgooien" name="outRule" defaultValue="double"><option value="double">Double out</option><option value="straight">Straight out</option><option value="master">Master out</option></Field><Field label="Handicap startscore zijde 1" name="homeStart" type="number"/><Field label="Handicap startscore zijde 2" name="awayStart" type="number"/></>}</div><p>Cricket en Tactics houden eigen marks en statistieken bij. Deze disciplines en afwijkende X01-regels tellen niet voor de landelijke X01-spelersrating.</p></details>;
}

export default function PlatformWorkspace({
  path,
  overview,
  clubId = "",
}: {
  path: string;
  user: Profile;
  overview: Overview | null;
  clubId?: string;
}) {
  const [data, setData] = useState<Platform | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const commandInFlight = useRef(false);
  const pendingRefresh = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async (force = false) => {
    if (pendingRefresh.current) {
      if (!force) return pendingRefresh.current;
      await pendingRefresh.current;
    }
    const task = (async () => {
      try {
        const response = await fetch("/api/platform", {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "De speelomgeving is niet beschikbaar.",
          );
        setData(result);
        setError("");
        setOnline(navigator.onLine);
      } catch (e) {
        setError(
          e instanceof TypeError ? "De verbinding is onderbroken. Je laatst ontvangen stand blijft zichtbaar." : e instanceof Error ? e.message : "De verbinding is onderbroken.",
        );
        setOnline(navigator.onLine);
      }
    })();
    pendingRefresh.current = task;
    try {
      await task;
    } finally {
      if (pendingRefresh.current === task) pendingRefresh.current = null;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 2500);
    const wake = () => {setOnline(navigator.onLine);if(navigator.onLine)void refresh();};
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh]);
  const command: Command = async (action, entity, attempt) => {
    if (commandInFlight.current) return;
    commandInFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: attempt?.requestId || crypto.randomUUID(),
          ...(attempt ? {expectedRevision:attempt.expectedRevision} : entity ? { expectedRevision: entity.revision } : {}),
          action,
        }),
        signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "De actie is niet uitgevoerd.",
        );
      await refresh(true);
      setNotice("Opgeslagen.");
      if (result.matchId)
        navigate(`/wedstrijd/${encodeURIComponent(result.matchId)}`);
      return result as Result;
    } catch (e) {
      setError(e instanceof TypeError ? "De verbinding is onderbroken. Controleer de stand en probeer je bewaarde actie opnieuw." : e instanceof Error ? e.message : "De actie is niet uitgevoerd.");
      return undefined;
    } finally {
      commandInFlight.current = false;
      setBusy(false);
    }
  };
  const pieces = path
    .replace(/^\/app\/?/, "")
    .split("/")
    .filter(Boolean);
  const page = pieces[0] || "home";
  const id = pieces[1];
  if (page === "blog") return <BlogWorkspace />;
  if (page === "platform") return <IntegrationsPanel />;
  if (page === "mail") return <MailWorkspace clubId={clubId} />;
  return (
    <div className="platform-workspace" data-workspace={page}>
      {(!online || error) && (
        <div className="notice error" role="alert">
          {error ||
            "Geen verbinding. De laatst ontvangen stand blijft zichtbaar."}
          <button onClick={() => void refresh()}>Opnieuw proberen</button>
        </div>
      )}
      {notice && (
        <div className="workspace-feedback" role="status">
          ✓ {notice}
        </div>
      )}
      {!data ? (
        <div className="panel loading-panel">
          <span className="loading-ring" />
          <p>Jouw actuele speelomgeving ophalen…</p>
        </div>
      ) : id &&
        ["community", "lobby", "hall", "tournaments", "leagues", "events"].includes(page) &&
        invitationCode() &&
        !(page === "community" ? data.rooms : page==='lobby'?data.lobbies:[...data.leagues,...data.tournaments]).some(
          (e) => e.id === id,
        ) ? (
        <>
          <Title title="Je bent uitgenodigd">
            Open de uitnodiging om deel te nemen met jouw account.
          </Title>
          <section className="panel">
            <Button
              primary
              disabled={busy}
              onClick={() =>
                void command({
                  type: page === "community" ? "room.join" : page==='lobby'?"lobby.join":"competition.register",
                  id,
                  code: invitationCode(),
                })
              }
            >
              Uitnodiging accepteren
            </Button>
          </section>
        </>
      ) : page === "home" || page === "dashboard" ? (
        <Dashboard
          data={data}
          overview={overview}
          organizer={page === "dashboard"}
          clubId={clubId}
        />
      ) : page === "play" || page === "spelen" ? (
        <Play />
      ) : page === 'feed' ? (
        <FeedSpace actorId={data.profile.id} kind={(pieces[1]||'my') as 'my'|'platform'|'club'|'league'|'tournament'} scopeId={pieces[2]||''} />
      ) : page === 'locations' || page === 'reservations' ? (
        <LocationWorkspace />
      ) : page === "training" ? (
        <Training data={data} id={id} command={command} busy={busy} error={error} online={online} />
      ) : page === "practice" || page === "lobby" ? (
        <Lobby data={data} id={id} command={command} busy={busy} onRefresh={()=>refresh(true)} />
      ) : page === "friends" ? (
        <Friends data={data} command={command} busy={busy} />
      ) : page === "clubs" ? (
        <Clubs data={data} id={id} section={pieces[2]} command={command} busy={busy} />
      ) : page === "community" ? (
        <Rooms data={data} id={id} command={command} busy={busy} />
      ) : [
          "events",
          "leagues",
          "hall",
          "tournaments",
          "pools",
          "knockout",
        ].includes(page) ? (
        <Competitions
          data={data}
          page={page}
          id={id}
          command={command}
          busy={busy}
          overview={overview}
        />
      ) : page === "operations" || page === "venue" ? (
        <Operations
          data={data}
          overview={overview}
          command={command}
          busy={busy}
        />
      ) : page === "venue-cast" ? (
        <Cast
          data={data}
          id={id}
          command={command}
          busy={busy}
          overview={overview}
        />
      ) : page === "camera" ? (
        <CameraPreflight />
      ) : page === "premium" ? (
        <PlatformBrandingAdministration/>
      ) : page === "settings" ? (
        <Preferences data={data} command={command} busy={busy} />
      ) : [
          "mymatches",
          "matches",
          "rankings",
          "statistics",
          "players",
          "registrations",
          "reports",
          "manage",
        ].includes(page) ? (
        <Registry
          data={data}
          overview={overview}
          page={page}
          command={command}
          busy={busy}
        />
      ) : (
        <>
          <Title title="Link niet gevonden" />
          <Empty>
            Deze link hoort niet bij een bekende werkruimte. Open je dashboard
            om verder te gaan.
          </Empty>
          <Link to="">Naar Vandaag</Link>
        </>
      )}
    </div>
  );
}

function Dashboard({
  data,
  overview,
  organizer,
  clubId,
}: {
  data: Platform;
  overview: Overview | null;
  organizer: boolean;
  clubId: string;
}) {
  const competitions = [...data.leagues,...data.tournaments].filter(e=>(e.clubId||'')===clubId);
  if (!organizer) return <><GuestClaimsPanel/><RedesignedToday data={data} overview={overview} clubId={clubId}/></>;
  return <><Title title="Organiseren">{new Intl.DateTimeFormat('nl-NL',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Amsterdam'}).format(new Date())} · {data.clubs.find(c=>c.id===clubId)?.name||'Wereldwijd'}</Title><GuestClaimsPanel/>
          <div className="workspace-metrics">
            <Metric label="Evenementen" value={competitions.length} />
            <Metric
              label="Ledenaanvragen"
              value={
                data.clubs
                  .flatMap((c) => c.members)
                  .filter((m) => m.status === "pending").length
              }
            />
            <Metric
              label="Actieve banen"
              value={overview?.boards.filter((b) => b.matchId).length || 0}
            />
            <Metric
              label="Uitslagen in beoordeling"
              value={
                overview?.matches.filter((m) => m.status === "disputed")
                  .length || 0
              }
            />
          </div>
          <div className="workspace-grid">
            <Tile
              title="Wedstrijdleiding"
              to="operations"
              label="Open regie"
              accent
            >
              Inschrijving, check-in, schema, baanoproepen en uitslagen op één
              plek.
            </Tile>
            <Tile title="Evenementen" to="events" label="Beheer evenementen">
              Organiseer een competitie of toernooi en volg de doorstroom.
            </Tile>
            <Tile title="Clubbeheer" to="clubs" label="Open clubdossier">
              Beheer leden, aanvragen en de rollen in jouw verenigingen.
            </Tile>
            <Tile
              title="Schermstudio"
              to="venue-cast/studio"
              label="Open studio"
            >
              Zet een scene klaar en publiceer de regiekeuze naar je
              zaalschermen.
            </Tile>
            <Tile title="Mailbeheer" to="mail" label="Open Mailbeheer">
              Sjablonen, publicaties en de echte verzendstatus van berichten.
            </Tile>
            {data.canManageRegistrations && (
              <Tile
                title="Platformbeheer"
                to="platform/integraties"
                label="Open integraties"
              >
                Koppel e-mail en Google Auth met de rechten van je account.
              </Tile>
            )}
          </div>
  </>;
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel workspace-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Play() {
  return (
    <>
      <Title
        title="Spelen"
        actions={<Link to="lobby">Wedstrijdcode invoeren</Link>}
      />
      <div className="workspace-grid">
        <Tile title="Vrij spelen" to="practice" label="Open speelzaal">
          Speel tegen een vriend of zoek een tegenstander voor een lokale of
          online partij.
        </Tile>
        <Tile title="Solo & training" to="training" label="Kies training">
          Oefen finishes, speel de 170-challenge of neem het op tegen de
          Dartbot.
        </Tile>
        <Tile title="Baanmodus" to="baan" label="Open Baanmodus" accent>
          Scan de QR bij een dartbaan. Voer scores in op je telefoon en volg de
          stand op het zaalscherm.
        </Tile>
      </div>
      <section className="panel">
        <h2>Programma & uitslagen</h2>
        <div className="workspace-row">
          <strong>Mijn wedstrijden</strong>
          <Link to="mymatches">Bekijk wedstrijden</Link>
        </div>
        <div className="workspace-row">
          <strong>Competities & toernooien</strong>
          <Link to="events">Bekijk evenementen</Link>
        </div>
      </section>
    </>
  );
}
function BoundBoardScreen({
  boardId,
  command,
  busy,
}: {
  boardId: string;
  command: Command;
  busy: boolean;
}) {
  const [screenUrl, setScreenUrl] = useState("");
  return (
    <section className="panel">
      <div className="workspace-row">
        <div>
          <strong>Gekoppeld aan het fysieke bord</strong>
          <small>
            Het Oche Live-scherm toont de actuele baan. Via de vaste QR voer je
            scores in.
          </small>
        </div>
        <div className="button-row">
          <a
            className="button ghost small"
            href={`/baan/${encodeURIComponent(boardId)}`}
          >
            Vaste QR openen
          </a>
          {screenUrl ? (
            <a
              className="button gold small"
              href={screenUrl}
              target="_blank"
              rel="noreferrer"
            >
              Alleen-lezen Oche Live openen
            </a>
          ) : (
            <Button
              disabled={busy}
              onClick={() => {
                void command({ type: "board.screen", boardId }).then(
                  (result) => {
                    if (
                      result?.screenUrl &&
                      /^\/scherm\/(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{64})$/.test(
                        result.screenUrl,
                      )
                    )
                      setScreenUrl(result.screenUrl);
                  },
                );
              }}
            >
              Oche Live-scherm koppelen
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
function EventAdministration({entity,data,command,busy}:{entity:Entity;data:Platform;command:Command;busy:boolean}){
 const [ownership,setOwnership]=useState(entity.clubId?'club':entity.kind==='tournament'?'personal':'platform');
 const clubs=data.clubs.filter(club=>club.clubAccess?.permissions?.includes(entity.kind==='league'?'competitions.manage':'tournaments.manage'));
 return <details className="panel"><summary>Kopiëren en medebeheer</summary><form onSubmit={event=>{event.preventDefault();const input=new FormData(event.currentTarget);void command({type:'competition.copy',id:entity.id,name:String(input.get('name')),date:String(input.get('date')||new Date().toISOString().slice(0,10)),ownership,clubId:ownership==='club'?String(input.get('clubId')):null},entity).then(result=>{if(result?.id)navigate(`/app/${entity.kind==='league'?'leagues':'hall'}/${result.id}`);});}}><h2>Een nieuwe editie</h2><p>Neem de opzet over. De nieuwe editie begint met een lege deelnemerslijst, eigen erkenning en zonder uitslagen.</p><Field label="Naam van de nieuwe editie" name="name" defaultValue={`${entity.name} · nieuwe editie`}/><Field label="Datum nieuwe editie" name="date" type="date" defaultValue={new Date().toISOString().slice(0,10)}/><label className="field">Organisatie<select value={ownership} onChange={event=>setOwnership(event.target.value)}>{entity.kind==='tournament'&&<option value="personal">Persoonlijk</option>}{clubs.length>0&&<option value="club">Vereniging</option>}{data.canManageRegistrations&&<option value="platform">DartFlow landelijk</option>}</select></label>{ownership==='club'&&<Field label="Organiserende vereniging" name="clubId" defaultValue={entity.clubId??clubs[0]?.id}>{clubs.map(club=><option key={club.id} value={club.id}>{club.name}</option>)}</Field>}<button className="button" disabled={busy}>Lege editie aanmaken</button></form>{entity.ownerId===data.profile.id&&<><h2>Medebeheerders</h2><p>Een medebeheerder krijgt alleen de toegestane taken voor dit evenement. De organisator en officiële rankingbestemmingen blijven bij deze editie horen.</p>{entity.members.filter(member=>member.attributes?.coOrganizer===true).map(member=><div className="button-row" key={member.id}><span>{member.name}</span><Button disabled={busy} onClick={()=>void command({type:'competition.coorganizer',id:entity.id,userId:member.id,enabled:false},entity)}>Medebeheer intrekken</Button></div>)}<form onSubmit={event=>{event.preventDefault();void command({type:'competition.coorganizer',id:entity.id,userId:String(new FormData(event.currentTarget).get('userId')),enabled:true},entity);}}><Field label="Medebeheerder toevoegen" name="userId"><option value="">Kies een speler</option>{data.players.filter(player=>player.id!==entity.ownerId).map(player=><option key={player.id} value={player.id}>{player.name}</option>)}</Field><button className="button" disabled={busy}>Medebeheer toestaan</button></form></>}</details>;
}

function Training({
  data,
  id,
  command,
  busy,
}: {
  data: Platform;
  id?: string;
  command: Command;
  busy: boolean;
  error: string;
  online: boolean;
}) {
  const entity = data.trainings.find((e) => e.id === id);
  if (!entity)
    return (
      <>
        <Title title="Solo & training">
          Werk aan je dubbels, ritme en volgende finish. Training telt
          uitsluitend mee in je eigen historie.
        </Title>
        <div className="workspace-grid two">
          {[
            {
              mode: "solo",
              name: "Solo X01",
              copy: "Speel 301, 501 of 701 en volg je gemiddelde.",
            },
            {
              mode: "bot",
              name: "Dartbot",
              copy: "Een gesimuleerde tegenstander met jouw gekozen doelgemiddelde.",
            },
            {
              mode: "around",
              name: "Around the board",
              copy: "D1 tot en met D20 en bull, met drie darts per dubbel.",
            },
            {
              mode: "170",
              name: "170-challenge",
              copy: "Gooi 170 uit binnen negen darts.",
            },
          ].map((item) => (
            <Form
              key={item.mode}
              title={item.name}
              submit="Start training"
              busy={busy}
              onSubmit={async (f) => {
                const result = await command({
                  type: "training.create",
                  mode: item.mode,
                  ...ruleInput(f),
                  startScore: number(f.get("startScore"), 501),
                  botAverage: number(f.get("botAverage"), 45),
                });
                if (result?.id) navigate(`/app/training/${result.id}`);
              }}
            >
              <p className="muted-copy">{item.copy}</p>
              {["solo", "bot"].includes(item.mode) && (
                <Field label="Startscore" name="startScore" defaultValue="501">
                  <option>301</option>
                  <option>501</option>
                  <option>701</option>
                </Field>
              )}
              {["solo","bot"].includes(item.mode)&&<RulesFields allowTactics={false} freshX01 bot={item.mode==='bot'}/>}
              {item.mode === "bot" && (
                <Field
                  label="Doelgemiddelde Dartbot"
                  name="botAverage"
                  type="number"
                  defaultValue={45}
                />
              )}
            </Form>
          ))}
        </div>
        <section className="panel">
          <h2>Jouw trainingen</h2>
          {data.trainings.length ? (
            data.trainings.filter(e=>!e.state.discarded).map((e) => (
              <a
                key={e.id}
                className="workspace-row"
                href={`/app/training/${e.id}`}
              >
                <div>
                  <strong>{e.name}</strong>
                  <small>
                    {statusLabel[text(e.state.mode)] || text(e.state.mode)}
                  </small>
                </div>
                <Label value={e.state.completed ? "finished" : "active"} />
              </a>
            ))
          ) : (
            <Empty>Je eerste training begint hier.</Empty>
          )}
        </section>
      </>
    );
  if(entity.state.discarded)return <section className="panel"><h2>Deze oude training is verwijderd</h2><a href="/app/spelen">Nieuwe partij starten</a></section>;
  return <LegacyTrainingOffline key={entity.id} actorId={data.profile.id} actorName={data.profile.name} initial={entity}/>;
}

function Friends({
  data,
  command,
  busy,
}: {
  data: Platform;
  command: Command;
  busy: boolean;
}) {
  const [search,setSearch]=useState(''),[found,setFound]=useState<Profile[]>(data.players),[searchError,setSearchError]=useState(''),[nextOffset,setNextOffset]=useState<number|null>(null),[moreBusy,setMoreBusy]=useState(false);
  const searchRef=useRef(search);searchRef.current=search;
  useEffect(()=>{let active=true;const controller=new AbortController(),timer=setTimeout(()=>{void fetch('/api/players?'+new URLSearchParams({search}),{credentials:'same-origin',cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw Error('Zoeken is niet gelukt. Probeer opnieuw.');return response.json()as Promise<{players:Profile[];nextOffset:number|null}>;}).then(result=>{if(active){setFound(result.players);setNextOffset(result.nextOffset);setSearchError('');}}).catch(error=>{if(active)setSearchError(error instanceof Error?error.message:'Zoeken is niet gelukt.');});},200);return()=>{active=false;clearTimeout(timer);controller.abort();};},[search]);
  const query=search.normalize('NFKC').toLowerCase().replace(/^@/,'');
  return (
    <>
      <Title title="Vrienden">
        Eén vriendenlijst, in iedere club en speelomgeving.
      </Title>
      <Form
        title="Vriend toevoegen"
        submit="Verzoek versturen"
        busy={busy}
        onSubmit={async (f) => {
          await command({
            type: "friend.request",
            userId: text(f.get("userId")),
          });
        }}
      >
        <label className="field">Zoek op displaynaam of gebruikersnaam<input value={search}onChange={e=>setSearch(e.target.value)}type="search"/></label>
        {searchError&&<p role="alert">{searchError}</p>}
        <fieldset className="player-search-results"><legend>Speler kiezen</legend>
          {found.filter(p=>p.id!==data.profile.id&&!data.friends.some(f=>f.id===p.id)&&(!query||[p.displayName,p.username].some(value=>value?.normalize('NFKC').toLowerCase().includes(query)))).map(p=><label className="player-search-result"key={p.id}><input type="radio"name="userId"value={p.id}required/><span className="player-search-avatar"aria-hidden="true">{Array.from(p.displayName||p.username||'S').slice(0,2).join('').toUpperCase()}</span><span><strong>{p.displayName||p.username||'Speler'}</strong>{p.username&&<small>@{p.username}</small>}</span></label>)}
        </fieldset>
        {nextOffset!==null&&<button className="button ghost"type="button"disabled={moreBusy}onClick={async()=>{setMoreBusy(true);const captured=search;try{const response=await fetch('/api/players?'+new URLSearchParams({search,offset:String(nextOffset)}),{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Volgende spelers ophalen is niet gelukt.');const result=await response.json()as{players:Profile[];nextOffset:number|null};if(searchRef.current===captured){setFound(prior=>[...prior,...result.players.filter(player=>!prior.some(p=>p.id===player.id))]);setNextOffset(result.nextOffset);}}catch(error){if(searchRef.current===captured)setSearchError(error instanceof Error?error.message:'Probeer opnieuw.');}finally{setMoreBusy(false);}}}>Meer spelers tonen</button>}
        <a href="/help/profiel-zoeken">Hulp bij het vinden van de juiste speler</a>
      </Form>
      <section className="panel">
        <h2>Vrienden & verzoeken</h2>
        {data.friends.length ? (
          data.friends.map((f) => (
            <div className="workspace-row" key={f.id}>
              <div>
                <strong>{socialIdentityLabel(f)}</strong>
                <small>
                  {f.status === "incoming"
                    ? "Wil vrienden worden"
                    : f.status === "outgoing"
                      ? "Verzoek verstuurd"
                      : f.favorite
                        ? "Favoriete vriend"
                        : "Vriend"}
                </small>
              </div>
              <div className="button-row">
                {f.status === "incoming" ? (
                  <>
                    <Button
                      disabled={busy}
                      primary
                      onClick={() =>
                        void command({ type: "friend.accept", userId: f.id })
                      }
                    >
                      Accepteren
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void command({ type: "friend.reject", userId: f.id })
                      }
                    >
                      Weigeren
                    </Button>
                  </>
                ) : f.status === "friend" ? (
                  <>
                    <a
                      href={`/app/practice?opponent=${f.id}`}
                      className="button gold small"
                    >
                      Uitdagen
                    </a>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void command({ type: "friend.favorite", userId: f.id })
                      }
                    >
                      {f.favorite ? "Geen favoriet" : "Favoriet"}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void command({ type: "friend.remove", userId: f.id })
                      }
                    >
                      Verwijderen
                    </Button>
                  </>
                ) : null}
                <Button
                  disabled={busy}
                  onClick={() =>
                    void command({ type: "friend.block", userId: f.id })
                  }
                >
                  Blokkeren
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(
                      "Waarom wil je deze speler melden?",
                    );
                    if (reason)
                      void command({
                        type: "report.create",
                        userId: f.id,
                        reason,
                      });
                  }}
                >
                  Melden
                </Button>
              </div>
            </div>
          ))
        ) : (
          <Empty>Nog geen vrienden of openstaande verzoeken.</Empty>
        )}
      </section>
      {data.blocked.length > 0 && (
        <section className="panel">
          <h2>Geblokkeerde spelers</h2>
          {data.blocked.map((p) => (
            <div className="workspace-row" key={p.id}>
              <strong>{p.name}</strong>
              <Button
                disabled={busy}
                onClick={() =>
                  void command({ type: "friend.unblock", userId: p.id })
                }
              >
                Deblokkeren
              </Button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
function Clubs({
  data,
  id,
  section,
  command,
  busy,
}: {
  data: Platform;
  id?: string;
  section?: string;
  command: Command;
  busy: boolean;
}) {
  const entity = data.clubs.find(
    (e) => e.id === id || text(e.state.code) === id,
  );
  if (entity) {
    if('clubDetails' in entity&&section!=='banen'){const club=entity as unknown as ClubEntity;return club.clubAccess.isMember&&club.clubDetails.lifecycle==='active'?<ClubhouseWorkspace clubId={entity.id} section={section} actorId={data.profile.id} players={data.players} legacyCommand={(action,current)=>command(action as Action,current as unknown as Entity)} legacyBusy={busy}/>:<><ClubNavigation id={entity.id}/><ClubWorkspace entity={club} actorId={data.profile.id} players={data.players} command={(action,current)=>command(action as Action,current as unknown as Entity)} busy={busy}/></>;}
    const own = entity.members.find((m) => m.id === data.profile.id);
    const manager = entity.canManage === true;
    if (section === "banen") return <>
      <Title title={entity.name} actions={<Link to="clubs">Alle verenigingen</Link>}>{text(entity.state.description)}</Title>
      <ClubNavigation id={entity.id} boards />
      <ClubBoards club={entity} boards={(data.clubBoards || []).filter(board => board.clubId === entity.id)} command={command} busy={busy} />
    </>;
    return (
      <>
        <Title
          title={entity.name}
          actions={<Link to="clubs">Alle verenigingen</Link>}
        >
          {text(entity.state.description)}
        </Title>
        <ClubNavigation id={entity.id} />
        <ShareInvitation section="clubs" id={entity.id} entity={entity} />
        {manager && (
          <EntitySettings entity={entity} command={command} busy={busy} />
        )}
        <section className="panel">
          <div className="workspace-row">
            <span>
              {entity.members.filter((m) => m.status === "active").length} /{" "}
              {text(entity.state.capacity, "—")} leden
            </span>
            <Label value={own?.status || "Geen lid"} />
          </div>
          {!own && (
            <Button
              primary
              disabled={busy}
              onClick={() =>
                void command({ type: "club.request", id: entity.id }, entity)
              }
            >
              Lidmaatschap aanvragen
            </Button>
          )}
          {own && own.role !== "owner" && (
            <Button
              disabled={busy}
              onClick={() =>
                void command({ type: "club.leave", id: entity.id }, entity)
              }
            >
              Vereniging verlaten
            </Button>
          )}
          <h2>Leden & aanvragen</h2>
          {entity.members.map((m) => (
            <div className="workspace-row" key={m.id}>
              <div>
                <strong>{m.name}</strong>
                <small>
                  {statusLabel[m.status] || m.status} ·{" "}
                  {statusLabel[m.role] || m.role}
                </small>
              </div>
              {manager && m.status === "pending" ? (
                <div className="button-row">
                  <Button
                    primary
                    disabled={busy}
                    onClick={() =>
                      void command(
                        { type: "club.approve", id: entity.id, userId: m.id },
                        entity,
                      )
                    }
                  >
                    Goedkeuren
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void command(
                        { type: "club.reject", id: entity.id, userId: m.id },
                        entity,
                      )
                    }
                  >
                    Afwijzen
                  </Button>
                </div>
              ) : manager &&
                m.id !== entity.ownerId &&
                m.status === "active" ? (
                <label className="field compact">
                  Rol
                  <select
                    value={m.role}
                    disabled={busy}
                    onChange={(e) =>
                      void command(
                        {
                          type: "club.role",
                          id: entity.id,
                          userId: m.id,
                          role: e.target.value,
                        },
                        entity,
                      )
                    }
                  >
                    {[
                      "member",
                      "captain",
                      "admin",
                      ...(entity.ownerId === data.profile.id ? ["owner"] : []),
                    ].map((role) => (
                      <option value={role} key={role}>
                        {statusLabel[role]}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>Clubnieuws</h2>
          {list(entity.state.news).map((n) => (
            <article className="workspace-news" key={text(n.id)}>
              <h3>{text(n.title)}</h3>
              <p>{text(n.body)}</p>
              <small>{iso(n.createdAt)}</small>
            </article>
          ))}
          {manager && (
            <Form
              title="Nieuwsbericht plaatsen"
              submit="Publiceren"
              busy={busy}
              onSubmit={async (f) => {
                await command(
                  {
                    type: "club.news",
                    id: entity.id,
                    title: text(f.get("title")),
                    body: text(f.get("body")),
                  },
                  entity,
                );
              }}
            >
              <Field label="Titel" name="title" required />
              <label className="field">
                Bericht
                <textarea name="body" maxLength={4000} required />
              </label>
            </Form>
          )}
        </section>
        <div className="workspace-grid two">
          <Tile title="Clubactiviteiten" to="events" label="Bekijk evenementen">
            Competities en toernooien van je vereniging.
          </Tile>
          <Tile title="Clubkamers" to="community" label="Open kamers">
            Ontmoet clubgenoten, plan een partij en blijf in contact.
          </Tile>
        </div>
      </>
    );
  }
  return (
    <>
      <Title title="Verenigingen">
        Vind je club, gebruik een uitnodiging of begin een eigen vereniging.
      </Title>
      <div className="workspace-grid two">
        <Form
          title="Vereniging oprichten"
          submit="Vereniging aanmaken"
          busy={busy}
          onSubmit={async (f) => {
            const result = await command({
              type: "club.create",
              name: text(f.get("name")),
              description: text(f.get("description")),
              capacity: number(f.get("capacity"), 100),
            });
            if (result?.id)
              navigate(entityUrl("clubs", result.id, result.code));
          }}
        >
          <Field label="Naam" name="name" required />
          <Field label="Omschrijving" name="description" />
          <Field
            label="Maximaal aantal leden"
            name="capacity"
            type="number"
            defaultValue={100}
          />
        </Form>
        <Form
          title="Uitnodigingscode gebruiken"
          submit="Lidmaatschap aanvragen"
          busy={busy}
          onSubmit={async (f) => {
            await joinInvitation(command, "club.request", text(f.get("code")));
          }}
        >
          <Field label="Clubcode" name="code" required />
        </Form>
      </div>
      <div className="workspace-grid">
        {data.clubs.length ? (
          data.clubs.map((c) => (
            <article className="panel workspace-tile" key={c.id} style={{borderTop:`3px solid ${/^#[0-9a-f]{6}$/i.test(text(c.state.primaryColor))?text(c.state.primaryColor):'#b7f62b'}`}}>
              {typeof c.state.logoData==='string'&&c.state.logoData.startsWith('data:image/webp;base64,')&&<img src={c.state.logoData} width={48} height={48} alt={`${c.name} logo`} />}
              <h2>{c.name}</h2>
              <p>{text(c.state.description)}</p>
              <p>{({closed:'Gesloten',invite:'Alleen op uitnodiging',open:'Direct lid worden',intake:'Aanmelden via intake'} as Record<string,string>)[text(c.state.joinPolicy,'intake')]||'Aanmelden via intake'}</p>
              <p>
                {c.members.filter((m) => m.status === "active").length} leden
              </p>
              <Link to={`clubs/${c.id}`} primary>
                Open clubdossier
              </Link>
            </article>
          ))
        ) : (
          <Empty>Er zijn nog geen zichtbare verenigingen.</Empty>
        )}
      </div>
    </>
  );
}
function ClubNavigation({ id, boards = false }: { id: string; boards?: boolean }) {
  return <nav className="button-row club-navigation" aria-label="Vereniging">
    <a className={`button ${boards ? "ghost" : "gold"}`} href={`/app/clubs/${id}`} aria-current={!boards ? "page" : undefined}>Vereniging</a>
    <a className={`button ${boards ? "gold" : "ghost"}`} href={`/app/clubs/${id}/banen`} aria-current={boards ? "page" : undefined}>Banen</a>
  </nav>;
}
function ClubBoards({ club, boards, command, busy }: { club: Entity; boards: ClubBoardView[]; command: Command; busy: boolean }) {
  const [adding, setAdding] = useState(false);
  return <>
    <section className="panel club-boards-intro">
      <div className="section-heading"><div><h2>Vaste verenigingsbanen</h2><p>Een eigen scorebord en vaste QR voor ieder fysiek dartbord. Je kunt direct spelen met een DartFlow-account, zonder evenementinschrijving.</p></div>{club.canManage && <Button primary disabled={busy} onClick={() => setAdding(!adding)}>{adding ? "Toevoegen sluiten" : "Baan toevoegen"}</Button>}</div>
      <p>Het alleen-lezen baanscherm is zichtbaar voor iedereen met de schermlink. Wie mag spelen, bepaal je per baan.</p><p>Fysiek baanbeheer heeft eigen locatierechten. Activeer die eenmalig bij <a className="text-link" href="/app/locations">Banen &amp; locaties</a>. Verenigingsrollen geven geen baanbeheer.</p>
    </section>
    {adding && club.canManage && <Form title="Baan toevoegen" submit="Baan aanmaken" busy={busy} onSubmit={async form => {
      const result = await command({ type: "club-board.create", clubId: club.id, name: text(form.get("name")), access: text(form.get("access"), "all") });
      if (result?.id) setAdding(false);
    }}><Field label="Naam van de baan" name="name" required maxLength={80} /><Field label="Wie mag spelen?" name="access" defaultValue="all"><option value="all">Iedereen met een DartFlow-account</option><option value="club">Alleen leden van deze vereniging</option></Field></Form>}
    <div className="club-boards-grid">{boards.length ? boards.map(board => <ClubBoardCard key={board.id} board={board} command={command} busy={busy} />) : <section className="panel"><Empty>Deze vereniging heeft nog geen vaste banen. Een beheerder kan een baan toevoegen.</Empty></section>}</div>
  </>;
}
function ClubBoardCard({ board, command, busy }: { board: ClubBoardView; command: Command; busy: boolean }) {
  const [name, setName] = useState(board.name);
  const [access, setAccess] = useState(board.access);
  useEffect(() => setName(board.name), [board.name]);
  useEffect(() => setAccess(board.access), [board.access]);
  return <article className="panel club-board-card" aria-label={board.name}>
    <div className="section-heading"><h2>{board.name}</h2><span className="badge" data-live={board.occupied}>{board.blocked ? "Geblokkeerd" : board.occupied ? "Bezet" : "Vrij"}</span></div>
    <p>{board.access === "club" ? "Alleen leden van deze vereniging" : "Iedereen met een DartFlow-account"}</p>
    <ClubBoardQr boardId={board.id} />
    <a className="button gold" href={board.screenUrl} target="_blank" rel="noopener noreferrer">Open baanscherm ↗</a>
    {board.canManage && <ScreenDeviceManager boardId={board.id} boardName={board.name} />}
    {board.canManage && <details className="club-board-settings"><summary>Baan beheren</summary><form onSubmit={event => { event.preventDefault(); void command({ type: "club-board.update", boardId: board.id, name, access }); }}><fieldset disabled={busy}><legend>Instellingen van {board.name}</legend><label className="field">Baannaam<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label><label className="field">Wie mag spelen?<select value={access} onChange={event => setAccess(event.target.value as 'all' | 'club')}><option value="all">Iedereen met een DartFlow-account</option><option value="club">Alleen leden van deze vereniging</option></select></label><button className="button gold">Baaninstellingen opslaan</button></fieldset></form><Button disabled={busy} onClick={() => void command({ type: "club-board.update", boardId: board.id, blocked: !board.blocked })}>{board.blocked ? "Baan vrijgeven" : "Baan blokkeren"}</Button></details>}
  </article>;
}
function Rooms({
  data,
  id,
  command,
  busy,
}: {
  data: Platform;
  id?: string;
  command: Command;
  busy: boolean;
}) {
  const entity = data.rooms.find(
    (e) => e.id === id || text(e.state.code) === id,
  );
  const [message, setMessage] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const messages = entity ? list(entity.state.messages) : [];
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);
  if (entity) {
    const member = entity.members.find(
      (m) => m.id === data.profile.id && m.status === "active",
    );
    const manager = entity.canManage === true;
    return (
      <>
        <Title
          title={entity.name}
          actions={<Link to="community">Alle kamers</Link>}
        >
          <span>
            {statusLabel[entity.visibility] || entity.visibility} ·{" "}
            {entity.members.filter((m) => m.status === "active").length} /{" "}
            {text(entity.state.capacity, 8)} deelnemers
          </span>
        </Title>
        <ShareInvitation section="community" id={entity.id} entity={entity} />
        {manager && (
          <EntitySettings entity={entity} command={command} busy={busy} />
        )}
        {!member ? (
          <section className="panel">
            <p>Sluit aan om berichten te lezen en deel te nemen.</p>
            <Button
              primary
              disabled={busy}
              onClick={() =>
                void command(
                  { type: "room.join", id: entity.id, code: invitationCode() },
                  entity,
                )
              }
            >
              Kamer binnengaan
            </Button>
          </section>
        ) : (
          <div className="workspace-chat-layout">
            <section className="panel workspace-chat">
              <div className="workspace-messages" aria-live="polite">
                {messages.length ? (
                  messages.map((m, i) => (
                    <article
                      className={`workspace-message ${m.authorId === data.profile.id ? "own" : ""}`}
                      key={text(m.id, String(i))}
                    >
                      <header>
                        <strong>
                          {text(
                            m.authorName ||
                              m.name ||
                              data.players.find((p) => p.id === m.authorId)
                                ?.name,
                            "Speler",
                          )}
                        </strong>
                        <time>{iso(m.createdAt)}</time>
                      </header>
                      <p>
                        {m.deleted
                          ? "Bericht verwijderd door een moderator."
                          : text(m.body)}
                      </p>
                      {!m.deleted && m.authorId !== data.profile.id && <SafetyActions targetType="room-message" targetId={text(m.id)} userId={text(m.authorId)} scopeKind="room" scopeId={entity.id} />}
                      {manager && !m.deleted && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void command(
                              {
                                type: "room.moderate",
                                id: entity.id,
                                operation: "delete-message",
                                messageId: m.id,
                              },
                              entity,
                            )
                          }
                        >
                          Bericht verwijderen
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <Empty>Er zijn nog geen berichten. Begin het gesprek.</Empty>
                )}
                <div ref={bottom} />
              </div>
              <CommunityRulesGate><form
                className="workspace-message-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await command(
                      { type: "room.message", id: entity.id, body: message },
                      entity,
                    )
                  )
                    setMessage("");
                }}
              >
                <label className="sr-only" htmlFor="room-message">
                  Bericht
                </label>
                <input
                  id="room-message"
                  maxLength={2000}
                  required
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Schrijf een bericht…"
                />
                <button
                  className="button gold"
                  disabled={busy || !message.trim()}
                >
                  Verstuur
                </button>
              </form></CommunityRulesGate>
            </section>
            <aside className="panel">
              <h2>Deelnemers</h2>
              {entity.members
                .filter((m) => m.status === "active")
                .map((m) => (
                  <div className="workspace-room-member" key={m.id}>
                    <strong>{m.name}</strong>
                    <small>{m.role}</small>
                    {m.id !== data.profile.id && (
                      <div className="button-row">
                        <a
                          className="text-link"
                          href={`/app/practice?opponent=${m.id}`}
                        >
                          Uitdagen ↗
                        </a>
                        {manager &&
                          m.id !== entity.ownerId &&
                          [
                            "mute",
                            "unmute",
                            "remove",
                            "ban",
                            ...(entity.ownerId === data.profile.id
                              ? ["moderator"]
                              : []),
                          ].map((operation) => (
                            <button
                              className="text-button"
                              key={operation}
                              disabled={busy}
                              onClick={() =>
                                void command(
                                  {
                                    type: "room.moderate",
                                    id: entity.id,
                                    userId: m.id,
                                    operation:
                                      operation === "moderator"
                                        ? "role"
                                        : operation,
                                    ...(operation === "moderator"
                                      ? { role: "moderator" }
                                      : {}),
                                  },
                                  entity,
                                )
                              }
                            >
                              {
                                {
                                  mute: "Dempen",
                                  unmute: "Dempen opheffen",
                                  remove: "Verwijderen",
                                  ban: "Verbannen",
                                  moderator: "Moderator maken",
                                }[operation]
                              }
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              {manager &&
                entity.members
                  .filter((m) => m.status === "banned")
                  .map((m) => (
                    <div className="workspace-row" key={m.id}>
                      <strong>{m.name}</strong>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void command(
                            {
                              type: "room.moderate",
                              id: entity.id,
                              userId: m.id,
                              operation: "unban",
                            },
                            entity,
                          )
                        }
                      >
                        Ban opheffen
                      </Button>
                    </div>
                  ))}
              {manager && (
                <Form
                  title="Slow mode"
                  submit="Toepassen"
                  busy={busy}
                  onSubmit={async (f) => {
                    await command(
                      {
                        type: "room.moderate",
                        id: entity.id,
                        operation: "slow-mode",
                        seconds: number(f.get("seconds")),
                      },
                      entity,
                    );
                  }}
                >
                  <Field
                    label="Seconden tussen berichten"
                    name="seconds"
                    type="number"
                    defaultValue={number(entity.state.slowMode)}
                  />
                </Form>
              )}
              <Form
                title="Speler uitnodigen"
                submit="Uitnodigen"
                busy={busy}
                onSubmit={async (f) => {
                  await command(
                    {
                      type: "room.invite",
                      id: entity.id,
                      userId: text(f.get("userId")),
                    },
                    entity,
                  );
                }}
              >
                <Field label="Speler" name="userId" required>
                  <option value="">Kies een speler</option>
                  {data.players
                    .filter(
                      (p) =>
                        !entity.members.some(
                          (m) => m.id === p.id && m.status === "active",
                        ),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </Field>
              </Form>
              <Button
                disabled={busy}
                onClick={() =>
                  void command({ type: "room.leave", id: entity.id }, entity)
                }
              >
                Kamer verlaten
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt(
                    "Wat wil je over deze kamer melden?",
                  );
                  if (reason)
                    void command({
                      type: "report.create",
                      roomId: entity.id,
                      reason,
                    });
                }}
              >
                Kamer melden
              </Button>
            </aside>
          </div>
        )}
      </>
    );
  }
  return (
    <>
      <Title title="Community">
        Ontmoet spelers, praat bij en spreek je volgende partij af.
      </Title>
      <div className="workspace-grid two">
        <Form
          title="Nieuwe kamer"
          submit="Kamer maken"
          busy={busy}
          onSubmit={async (f) => {
            const result = await command({
              type: "room.create",
              name: text(f.get("name")),
              visibility: text(f.get("visibility")),
              clubId: text(f.get("clubId")) || null,
              capacity: number(f.get("capacity"), 8),
              slowMode: number(f.get("slowMode")),
            });
            if (result?.id)
              navigate(entityUrl("community", result.id, result.code));
          }}
        >
          <Field label="Naam" name="name" required />
          <Field label="Zichtbaarheid" name="visibility">
            <option value="public">Openbaar</option>
            <option value="private">Besloten</option>
            <option value="club">Alleen clubleden</option>
          </Field>
          <Scope data={data} />
          <div className="field-grid">
            <Field
              label="Capaciteit (2–64)"
              name="capacity"
              type="number"
              defaultValue={8}
            />
            <Field
              label="Slow mode (seconden)"
              name="slowMode"
              type="number"
              defaultValue={0}
            />
          </div>
        </Form>
        <Form
          title="Kamer via code openen"
          submit="Binnengaan"
          busy={busy}
          onSubmit={async (f) => {
            const result = await joinInvitation(
              command,
              "room.join",
              text(f.get("code")),
            );
            if (result?.id)
              navigate(entityUrl("community", result.id, result.code));
          }}
        >
          <Field label="Kamercode" name="code" required />
        </Form>
      </div>
      <div className="workspace-grid">
        {data.rooms.length ? (
          data.rooms.map((e) => (
            <article className="panel workspace-tile" key={e.id}>
              <Label value={e.visibility} />
              <h2>{e.name}</h2>
              <p>
                {e.members.filter((m) => m.status === "active").length} /{" "}
                {text(e.state.capacity, 8)} deelnemers
              </p>
              <Link to={`community/${e.id}`} primary>
                Open kamer
              </Link>
            </article>
          ))
        ) : (
          <Empty>Er zijn nog geen kamers in jouw speelomgeving.</Empty>
        )}
      </div>
    </>
  );
}
function Lobby({
  data,
  id,
  command,
  busy,
  onRefresh,
}: {
  data: Platform;
  id?: string;
  command: Command;
  busy: boolean;
  onRefresh:()=>Promise<void>;
}) {
  const entity = data.lobbies.find(
    (e) => e.id === id || text(e.state.code) === id,
  );
  if (entity) {
    const ready = record(entity.state.ready);
    const selfActive = entity.members.some(
      (member) => member.id === data.profile.id && member.status === "active",
    );
    return (
      <>
        <Title
          title={entity.name}
          actions={
            typeof entity.state.boardId === "string" ? (
              <a
                className="button ghost small"
                href={`/baan/${encodeURIComponent(entity.state.boardId)}`}
              >
                Vaste baan openen
              </a>
            ) : (
              <Link to="practice">Speelzaal</Link>
            )
          }
        />
        <div className="workspace-grid two play-lobby-layout">
          <section className="panel play-lobby-main">
            <ShareInvitation section="lobby" id={entity.id} entity={entity} />
            <h2>Spelers</h2>
            {entity.ownerId===data.profile.id&&selfActive&&typeof entity.state.boardId==='string'&&['localone','localtwo'].includes(text(entity.state.setup))&&!entity.state.matchId&&!entity.state.closed&&entity.members.filter(member=>member.status==='active').length===1&&<LocalPlayerAdd key={entity.id} lobbyId={entity.id} revision={entity.revision} boardId={entity.state.boardId} disabled={busy} onRefresh={onRefresh}/>}

            <div className="play-lobby-players">
            {entity.members.map((m) => (
              <div className="workspace-row" key={m.id}>
                <strong>{m.name}</strong>
                <Label
                  value={ready[m.id] ? "ready" : "Wacht op gereedmelding"}
                />
              </div>
            ))}
            </div>
            <div className="button-row">
              {!selfActive && !entity.state.closed && !entity.state.matchId && (
                <Button
                  primary
                  disabled={busy}
                  onClick={() =>
                    void command(
                      {
                        type: "lobby.join",
                        id: entity.id,
                        code: invitationCode(),
                      },
                      entity,
                    )
                  }
                >
                  Meedoen
                </Button>
              )}
              <Button
                primary
                disabled={
                  busy ||
                  !selfActive ||
                  Boolean(ready[data.profile.id]) ||
                  entity.state.closed === true ||
                  Boolean(entity.state.matchId)
                }
                onClick={() =>
                  void command({ type: "lobby.ready", id: entity.id }, entity)
                }
              >
                Ik sta klaar aan het bord
              </Button>
              <Button
                primary={Boolean(ready[data.profile.id])}
                disabled={
                  busy ||
                  !selfActive ||
                  entity.state.closed === true ||
                  Boolean(entity.state.matchId) ||
                  entity.members.filter((member) => member.status === "active")
                    .length !== 2 ||
                  entity.members
                    .filter((member) => member.status === "active")
                    .some((member) => !ready[member.id])
                }
                onClick={() =>
                  void command({ type: "lobby.start", id: entity.id }, entity)
                }
              >
                Wedstrijd starten
              </Button>
              {typeof entity.state.matchId === "string" && (
                <a
                  className="button gold"
                  href={`/wedstrijd/${entity.state.matchId}`}
                >
                  Naar wedstrijd
                </a>
              )}
              {entity.ownerId === data.profile.id &&
                !entity.state.matchId &&
                !entity.state.closed && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void command(
                        { type: "lobby.cancel", id: entity.id },
                        entity,
                      )
                    }
                  >
                    Lobby sluiten en baan vrijgeven
                  </Button>
                )}
            </div>
            {entity.state.closed === true && (
              <p role="status">
                Deze lobby is gesloten. De baan is weer vrijgegeven.
              </p>
            )}
          </section>
          <details className="panel play-lobby-settings">
            <summary>Wedstrijdinstellingen</summary>
              {entity.ownerId === data.profile.id &&
                !record(entity.state.settings).startProcedure &&
                !entity.state.matchId &&
                !entity.state.closed && (
                  <label className="field">
                    Eerste gooier
                    <select
                      value={text(entity.state.starterId, entity.ownerId)}
                      disabled={busy}
                      onChange={(event) =>
                        void command(
                          {
                            type: "lobby.starter",
                            id: entity.id,
                            starterId: event.target.value,
                          },
                          entity,
                        )
                      }
                    >
                      {entity.members
                        .filter((member) => member.status === "active")
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}

            {selfActive&&!entity.state.matchId&&!entity.state.closed&&['remote','hybrid'].includes(text(entity.state.setup))&&<label className="field">Mijn fysieke baan (optioneel)<select value={text(record(entity.state.remoteBoardIds)[data.profile.id])} disabled={busy} onChange={event=>{if(event.target.value)void command({type:'lobby.board.bind',id:entity.id,boardId:event.target.value},entity);}}><option value="">Thuis zonder gekoppeld baanscherm</option>{(data.clubBoards??[]).filter(board=>(!board.occupied&&!board.blocked&&!board.closed&&!board.closePending)||board.id===record(entity.state.remoteBoardIds)[data.profile.id]).map(board=><option key={board.id} value={board.id}>{board.name}</option>)}</select><small>Deze vaste baan volgt dezelfde live stand en deadline als je tegenstander.</small></label>}
        {typeof entity.state.boardId === "string" &&
          !entity.state.closed &&
          selfActive && (
            <BoundBoardScreen
              boardId={entity.state.boardId}
              command={command}
              busy={busy}
            />
          )}

            <h3>Bordcontrole</h3>
            <p>
              {text(record(entity.state.settings).discipline, 'x01') === 'x01' ? <>
                X01 {text(record(entity.state.settings).startScore, 501)} · {record(entity.state.settings).inRule === 'double' ? 'dubbel in' : 'enkel in'} · {record(entity.state.settings).outRule === 'straight' ? 'vrij uit' : record(entity.state.settings).outRule === 'master' ? 'master uit' : 'dubbel uit'}
              </> : text(record(entity.state.settings).discipline) === 'tactics' ? 'Tactics' : 'Cricket'}
              {' · '}best of {text(record(entity.state.settings).bestOfLegs, 3)}
            </p>
            <p>
              {
                (
                  {
                    localone: "Samen aan één bord",
                    localtwo: "Twee borden op locatie",
                    remote: "Ieder thuis",
                    hybrid: "Hybride opstelling",
                  } as Record<string, string>
                )[text(entity.state.setup)]
              }
            </p>
            <Link to="camera">Camera en microfoon controleren</Link>
            <p className="muted-copy">
              Start pas als beide spelers klaar zijn. Scores worden door de
              server verwerkt en gedeeld.
            </p>
          </details>
        </div>
      </>
    );
  }
  return (
    <>
      <Title title="Vrij spelen">
        Daag iemand uit en kies jullie speelopstelling.
      </Title>
      <div className="workspace-grid two">
        <Form
          title="Nieuwe wedstrijd"
          submit="Lobby openen"
          busy={busy}
          onSubmit={async (f) => {
            const result = await command({
              type: "lobby.create",
              ...ruleInput(f),
              startProcedure: text(f.get("startProcedure"), "bull"),
              setOpener: text(f.get("setOpener"), "continuous"),
              decidingLeg: text(f.get("decidingLeg"), "continue"),
              name: text(f.get("name")) || "Vrije wedstrijd",
              opponentId: text(f.get("opponentId")) || undefined,
              setup: text(f.get("setup")),
              startScore: number(f.get("startScore"), 501),
              bestOfLegs: number(f.get("bestOfLegs"), 3),
            });
            if (result?.id)
              navigate(entityUrl("lobby", result.id, result.code));
          }}
        >
          <Field label="Wedstrijdnaam" name="name" />
          <RulesFields freshX01/>
          <StartProcedureFields/>
          <Field
            label="Tegenstander"
            name="opponentId"
            defaultValue={
              typeof location === "undefined"
                ? ""
                : new URLSearchParams(location.search).get("opponent") || ""
            }
          >
            <option value="">Via uitnodigingscode</option>
            {data.players
              .filter((p) => p.id !== data.profile.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Field>
          <Field label="Speelopstelling" name="setup">
            <option value="localone">Samen aan één bord</option>
            <option value="localtwo">Twee borden op locatie</option>
            <option value="remote">Ieder thuis</option>
            <option value="hybrid">Hybride</option>
          </Field>
          <div className="field-grid">
            <Field label="Startscore" name="startScore" defaultValue="501">
              <option>301</option>
              <option>501</option>
              <option>701</option>
            </Field>
            <Field label="Best of legs" name="bestOfLegs" defaultValue="3">
              {[1, 3, 5, 7, 9].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Field>
          </div>
        </Form>
        <Form
          title="Wedstrijdcode invoeren"
          submit="Aansluiten"
          busy={busy}
          onSubmit={async (f) => {
            const result = await joinInvitation(
              command,
              "lobby.join",
              text(f.get("code")),
            );
            if (result?.id)
              navigate(entityUrl("lobby", result.id, result.code));
          }}
        >
          <Field label="Wedstrijdcode" name="code" required />
          <p className="muted-copy">Vul de vier tekens in of plak de uitnodigingslink. Bestaande links blijven bruikbaar zolang ze geldig zijn.</p>
        </Form>
      </div>
      <section className="panel">
        <h2>Jouw lobby’s</h2>
        {data.lobbies.length ? (
          data.lobbies.map((e) => (
            <a className="workspace-row" href={`/app/lobby/${e.id}`} key={e.id}>
              <strong>{e.name}</strong>
              <Label value={e.state.status || "lobby"} />
            </a>
          ))
        ) : (
          <Empty>Nodig een speler uit om samen een partij te beginnen.</Empty>
        )}
      </section>
    </>
  );
}
function Competitions({
  data,
  page,
  id,
  command,
  busy,
  overview,
}: {
  data: Platform;
  page: string;
  id?: string;
  command: Command;
  busy: boolean;
  overview: Overview | null;
}) {
  const [create, setCreate] = useState("");
  const [entryCode, setEntryCode] = useState(invitationCode);
  const entities =
    page === "leagues"
      ? data.leagues
      : page === "events"
        ? [...data.leagues, ...data.tournaments]
        : data.tournaments;
  const eventStatus=(event:Entity)=>{
    const value=String(event.state.status??'');
    if(event.state.archived===true)return 'archived';
    if(event.state.cancelled===true)return 'cancelled';
    if(event.state.closed===true||event.state.completed===true)return 'completed';
    if(['finished','completed','cancelled','canceled','archived'].includes(value))return value;
    if(list(event.state.fixtures).some(fixture=>fixture.status==='live'))return 'live';
    if(list(event.state.fixtures).some(fixture=>['scheduled','proposed'].includes(text(fixture.status))))return 'planned';
    return value||'open';
  };
  const statusPriority=(event:Entity)=>{
    const value=eventStatus(event);
    if(['finished','completed','cancelled','canceled','archived'].includes(value))return 3;
    if(['active','live','playing','started'].includes(value))return 0;
    return value==='draft'?2:1;
  };
  const listedEntities=[...entities].sort((a,b)=>statusPriority(a)-statusPriority(b)||(Date.parse(String(a.state.startsAt??a.state.date))||Infinity)-(Date.parse(String(b.state.startsAt??b.state.date))||Infinity)||a.name.localeCompare(b.name,'nl'));
  const entity = entities.find((e) => e.id === id);
  if (entity) {
    const manager = entity.canManage === true;
    const member = entity.members.find((m) => m.id === data.profile.id);
    const fixtures = list(entity.state.fixtures);
    const standings = list(entity.state.standings);
    const communityAccess=manager||(member?.status==='active'&&member.attributes?.registered===true);
    return (
      <>
        <Title
          title={entity.name}
          actions={<Link to="events">Alle evenementen</Link>}
        >
          {iso(entity.state.date)} ·{" "}
          {entity.kind === "league" ? "Competitie" : "Toernooi"} ·{" "}
          {text(entity.state.format, "Poules en knock-out")}
          {entity.state.location ? ` · ${text(entity.state.location)}` : ""}
        </Title>
        {manager&&entity.state.format==='swiss'&&<section className="panel"><h2>Zwitserse ronden</h2><p>Geplaatste ronden: {Math.max(0,...fixtures.map(f=>number(f.round,0)))} · gepubliceerd maximum: {text(record(entity.state.tournamentRules).swissRounds)}</p><Button disabled={busy||entity.state.completed===true} onClick={()=>void command({type:'competition.next-round',id:entity.id},entity)}>Volgende ronde vaststellen</Button></section>}
        {entity.state.format==='swiss'&&entity.state.completed===true&&!entity.state.championId&&<p className="notice">De hoogste sportieve plaats is gedeeld. Volg het gepubliceerde reglement voor een beslissingspartij op een titel- of kwalificatiegrens.</p>}
        <RankingEventPanel entityId={entity.id} participant={member?.status==='active'&&member.attributes?.registered===true}/>
        {entity.kind==='tournament'&&<TournamentManagementPanel key={`${entity.id}:${record(entity.state.tournamentRules).draw?record(record(entity.state.tournamentRules).draw).revision:'initial'}`}entity={entity}canManage={manager}busy={busy}command={(action,expectedRevision)=>command(action,entity,expectedRevision===undefined?undefined:{requestId:crypto.randomUUID(),expectedRevision})}/>}
        {manager&&<EventAdministration entity={entity} data={data} command={command} busy={busy}/>}
        {manager&&entity.kind==='tournament'&&<OrganizerParticipantsPanel entityId={entity.id}revision={entity.revision}players={[data.profile,...data.players]}/>}
        {communityAccess&&<><FeedSpace actorId={data.profile.id} kind={entity.kind as 'league'|'tournament'} scopeId={entity.id} compact/><ScopedChat kind={entity.kind as 'league'|'tournament'} scopeId={entity.id} actorId={data.profile.id} label={entity.kind==='tournament'?'Toernooichat':'Competitiechat'}/></>}
        {manager && (
          <CompetitionControls
            entity={entity}
            overview={overview}
            command={command}
            busy={busy}
          />
        )}
        <ShareInvitation
          section={entity.kind === "league" ? "leagues" : "hall"}
          id={entity.id}
          entity={entity}
        />
        {typeof entity.state.roomId === "string" &&
          (manager ||
            (member?.status === "active" &&
              member.attributes?.registered === true)) && (
            <Link to={`community/${entity.state.roomId}`}>
              {entity.kind === "tournament" ? "Toernooikamer" : "Spelerslounge"}{" "}
              openen
            </Link>
          )}
        <section className="panel">
          {entity.state.eligibility === "code" && (
            <label className="field">
              Inschrijfcode
              <input
                value={entryCode}
                onChange={(event) => setEntryCode(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </label>
          )}
          <div className="button-row">
            {!member ||
            member.status === "left" ||
            member.attributes?.registered === false ? (
              <Button
                primary
                disabled={busy}
                onClick={() =>
                  void command(
                    {
                      type: "competition.register",
                      id: entity.id,
                      code: entryCode || invitationCode(),
                    },
                    entity,
                  )
                }
              >
                Inschrijven
              </Button>
            ) : (
              <>
                <Label value={member.status} />
                <Button
                  primary
                  disabled={busy || member.status !== "active"}
                  onClick={() =>
                    void command(
                      { type: "competition.checkin", id: entity.id },
                      entity,
                    )
                  }
                >
                  Ik ben aanwezig
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void command(
                      { type: "competition.withdraw", id: entity.id },
                      entity,
                    )
                  }
                >
                  Afmelden
                </Button>
              </>
            )}
            {manager && (
              <>
                <Button
                  disabled={busy}
                  onClick={() => {
                    void command(
                      { type: "competition.invite", id: entity.id },
                      entity,
                    ).then((result) => {
                      if (result?.code)
                        navigate(
                          entityUrl(
                            entity.kind === "league" ? "leagues" : "hall",
                            entity.id,
                            result.code,
                          ),
                        );
                    });
                  }}
                >
                  Uitnodigingslink maken
                </Button>
                {entity.kind!=='tournament'&&<Button
                  disabled={busy}
                  onClick={() =>
                    void command(
                      { type: "competition.plan", id: entity.id },
                      entity,
                    )
                  }
                >
                  Schema genereren
                </Button>}
                <Button
                  primary
                  disabled={busy}
                  onClick={() =>
                    void command(
                      { type: "competition.autoplan", id: entity.id },
                      entity,
                    )
                  }
                >
                  Banen automatisch toewijzen
                </Button>
                <Link to={`venue-cast/studio?event=${entity.id}`}>
                  Schermstudio
                </Link>
              </>
            )}
          </div>
          <div className="workspace-tabs">
            {manager && <a href="#banen" onClick={()=>{document.querySelector<HTMLDetailsElement>(".competition-settings")?.setAttribute("open","");}}>Banen</a>}
            <a href="#programma">Programma</a>
            <a href="#deelnemers">Deelnemers</a>
            <a href="#stand">Stand</a>
          </div>
          <h2 id="programma">Programma</h2>
          {fixtures.length ? (
            fixtures.map((f, i) => {
              const players = Array.isArray(f.players) ? f.players : [];
              return (
                <div className="workspace-fixture" key={text(f.id, String(i))}>
                  <div>
                    <strong>
                      {players
                        .map((p) =>
                          typeof p === "object"
                            ? text(record(p).name)
                            : p === null
                              ? "Winnaar volgt"
                              : entity.members.find((member) => member.id === p)
                                  ?.name ||
                                (p === data.profile.id
                                  ? data.profile.name
                                  : data.players.find((x) => x.id === p)
                                      ?.name) ||
                                "Speler",
                        )
                        .join(" — ") || text(f.name, "Wedstrijd")}
                    </strong>
                    <small>
                      {({winners:'Winnaarsschema',losers:'Verliezersschema',final:'Finale',reset:'Resetfinale',swiss:'Zwitsers',pool:'Poule',knockout:'Knock-out',league:'Competitie'} as Record<string,string>)[text(f.phase)]??text(f.phase)} ·{' '}
                      {text(f.roundLabel || f.round)} ·{" "}
                      {f.time || f.proposedTime
                        ? iso(f.proposedTime || f.time)
                        : "Speeltijd volgt"}{" "}
                      {f.boardId ? `· Baan ${text(f.boardId)}` : ""}
                    </small>
                  </div>
                  <Label value={f.status || "planned"} />
                  <div className="button-row">
                    {typeof f.matchId === "string" ? (
                      <>
                        <a
                          className="button gold small"
                          href={`/wedstrijd/${f.matchId}`}
                        >
                          Open wedstrijd
                        </a>
                        {entity.kind === "tournament" && (
                          <a
                            className="button ghost small"
                            href={`/wedstrijd/${f.matchId}?tablet=1`}
                          >
                            Schrijftablet
                          </a>
                        )}
                      </>
                    ) : (
                      <>
                        <Button
                          primary
                          disabled={busy||players.some(player=>!player)||['bye','void'].includes(text(f.status))}
                          onClick={() =>
                            void command(
                              {
                                type: "fixture.start",
                                id: entity.id,
                                fixtureId: f.id,
                              },
                              entity,
                            )
                          }
                        >
                          Wedstrijd openen
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => {
                            const time = window.prompt(
                              "Voorstel speeltijd (JJJJ-MM-DDTHH:MM)",
                            );
                            if (time)
                              void command(
                                {
                                  type: "fixture.propose",
                                  id: entity.id,
                                  fixtureId: f.id,
                                  time,
                                },
                                entity,
                              );
                          }}
                        >
                          Speeltijd voorstellen
                        </Button>
                        {f.status === "proposed" && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void command(
                                {
                                  type: "fixture.accept",
                                  id: entity.id,
                                  fixtureId: f.id,
                                },
                                entity,
                              )
                            }
                          >
                            Tijd accepteren
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  {typeof f.pairingNotice==='string'&&<p className="notice">{f.pairingNotice}</p>}
                  {manager && !['confirmed','bye','void'].includes(text(f.status)) && (
                    <FixtureControls
                      entity={entity}
                      fixture={f}
                      overview={overview}
                      command={command}
                      busy={busy}
                    />
                  )}
                </div>
              );
            })
          ) : (
            <Empty>
              Het programma verschijnt zodra de organisator het schema heeft
              gemaakt.
            </Empty>
          )}
          <h2 id="deelnemers">Deelnemers</h2>
          {entity.members.length ? (
            entity.members.map((m) => (
              <div className="workspace-row" key={m.id}>
                <strong>{m.name}</strong>
                <Label
                  value={
                    m.status === "pending"
                      ? "pending"
                      : m.attributes?.registered
                        ? m.attributes.checkedIn
                          ? "Ingecheckt"
                          : m.status === "waitlisted"
                            ? "waitlisted"
                            : "registered"
                        : m.status === "waitlisted"
                          ? "waitlisted"
                          : m.role === "owner"
                            ? "Wedstrijdleiding"
                            : m.status
                  }
                />
                {manager &&
                  entity.kind === "tournament" &&
                  m.status === "pending" && (
                    <Button
                      primary
                      disabled={busy}
                      onClick={() =>
                        void command(
                          {
                            type: "competition.approve",
                            id: entity.id,
                            userId: m.id,
                          },
                          entity,
                        )
                      }
                    >
                      Aanmelding goedkeuren
                    </Button>
                  )}
                {manager &&
                  entity.kind === "tournament" &&
                  m.attributes?.registered === true &&
                  ["pending", "active", "waitlisted"].includes(m.status) && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          "Waarom wordt deze toernooiaanmelding geweigerd?",
                        );
                        if (reason?.trim())
                          void command(
                            {
                              type: "competition.reject",
                              id: entity.id,
                              userId: m.id,
                              reason: reason.trim(),
                            },
                            entity,
                          );
                      }}
                    >
                      Aanmelding weigeren
                    </Button>
                  )}
                {manager && m.status === "waitlisted" && (
                  <Button
                    primary
                    disabled={busy}
                    onClick={() =>
                      void command(
                        {
                          type: "competition.promote",
                          id: entity.id,
                          userId: m.id,
                        },
                        entity,
                      )
                    }
                  >
                    Doorplaatsen
                  </Button>
                )}
                {manager &&
                  m.attributes?.registered === true &&
                  m.status === "active" && (
                    <div className="button-row">
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void command(
                            {
                              type: "competition.checkin",
                              id: entity.id,
                              userId: m.id,
                            },
                            entity,
                          )
                        }
                      >
                        Inchecken
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void command(
                            {
                              type: "competition.available",
                              id: entity.id,
                              userId: m.id,
                              available: m.attributes?.available === false,
                            },
                            entity,
                          )
                        }
                      >
                        {m.attributes.available === false
                          ? "Gereed melden"
                          : "Rust / niet beschikbaar"}
                      </Button>
                    </div>
                  )}
              </div>
            ))
          ) : (
            <Empty>
              De inschrijving is geopend. Er zijn nog geen deelnemers.
            </Empty>
          )}
          <h2 id="stand">Stand</h2>
          {standings.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Speler</th>
                    <th>Gespeeld</th>
                    <th>Gewonnen</th>
                    {!String(entity.state.format).startsWith('double-elimination')&&<th>Punten</th>}
                    {entity.state.format==='swiss'&&<><th>Buchholz</th><th>Legsaldo</th><th>Byes</th></>}
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => (
                    <tr key={i}>
                      <td>{text(s.position,String(i+1))}{s.shared===true?' =':''}</td>
                      <td>
                        {text(
                          s.name ||
                            entity.members.find(member=>member.id===(s.playerId??s.id))?.name||data.players.find((p) => p.id === (s.playerId??s.id))?.name,
                        )}
                      </td>
                      <td>{text(s.played)}</td>
                      <td>{text(s.won)}</td>
                      {!String(entity.state.format).startsWith('double-elimination')&&<td>{text(s.points)}</td>}
                      {entity.state.format==='swiss'&&<><td>{text(s.buchholz)}</td><td>{number(s.legsFor,0)-number(s.legsAgainst,0)}</td><td>{text(s.byes,'0')}</td></>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Bevestigde resultaten bepalen de stand.</Empty>
          )}
        </section>
      </>
    );
  }
  return (
    <>
      <Title
        title={
          page === "leagues"
            ? "Competities"
            : page === "events"
              ? "Evenementen"
              : "Toernooien"
        }
        actions={
          <>
            <Button onClick={() => setCreate("league")}>
              Nieuwe competitie
            </Button>
            <Button primary onClick={() => setCreate("tournament")}>
              Nieuw toernooi
            </Button>
          </>
        }
      >
        Bekijk programma’s, standen en inschrijvingen.
      </Title>
      {create && (
        <Form
          title={
            create === "league" ? "Competitie aanmaken" : "Toernooi aanmaken"
          }
          submit="Evenement aanmaken"
          busy={busy}
          onSubmit={async (f) => {
            const result = await command({
              type: `${create}.create`,
              drawCheckedInOnly:true,
              ...ruleInput(f),
              name: text(f.get("name")),
              clubId: text(f.get("clubId"))==='personal'?null:text(f.get("clubId")) || null,
              ownership:text(f.get("clubId"))==='personal'?'personal':text(f.get("clubId"))?'club':'platform',
              ...(create==='tournament'?{visibility:text(f.get('visibility'),'private')}:{}),
              capacity: number(f.get("capacity"), 32),
              ...(text(f.get("eligibility"))
                ? { eligibility: text(f.get("eligibility")) }
                : {}),
              format: text(f.get("format")),
              startScore: number(f.get("startScore"), 501),
              bestOfLegs: number(f.get("bestOfLegs"), 3),
              ...(text(f.get("swissRounds"))?{swissRounds:number(f.get("swissRounds"),1)}:{}),
              date: text(f.get("date")),
              location: text(f.get("location")),
              ...(create === "tournament"
                ? { approvalRequired: f.get("approvalRequired") === "on" }
                : {}),
              boards: number(f.get("boards"), 4),
              poolCount:number(f.get('poolCount'),4),
              ...(create==='tournament'?{planning:readTournamentPlanning(f),thirdPlace:f.get('thirdPlace')==='on',consolation:f.get('consolation')==='on',consolationTitle:text(f.get('consolationTitle'),'Troostbeker'),acceptPlanningWarnings:f.get('acceptPlanningWarnings')==='on',startProcedure:text(f.get('startProcedure'),'bull'),setOpener:text(f.get('setOpener'),'continuous'),decidingLeg:text(f.get('decidingLeg'),'continue')}:{}),
            });
            if (result?.id)
              navigate(
                entityUrl(
                  create === "league" ? "leagues" : "hall",
                  result.id,
                  result.code,
                ),
              );
          }}
        >
          <Field label="Naam" name="name" required />
          <RulesFields/>
          <OrganizerDrafts actorId={data.profile.id}kind={create==='tournament'?'tournament':'season'}/>
          <Field label="Locatie" name="location" />
          {create==='tournament'&&<><StartProcedureFields/><Field label="Aantal poules" name="poolCount" type="number"defaultValue={4}/><label className="workspace-checkbox"><input type="checkbox"name="thirdPlace"/>Bronzen wedstrijd voor de verliezende halvefinalisten</label><ConsolationFields/><TournamentPlanning/></>}
          <Field label="Zwitserse ronden (leeg voor automatisch)" name="swissRounds" type="number"/>
          <Scope data={data} personal={create==='tournament'} permission={create==='league'?'competitions.manage':'tournaments.manage'} />
          {create==='tournament'&&<><p>Je kunt zelfstandig een persoonlijk toernooi organiseren. Uitslagen blijven buiten officiële ratings en circuits.</p><Field label="Zichtbaarheid" name="visibility" defaultValue="private"><option value="private">Besloten · alleen deelnemers en genodigden</option><option value="public">Openbaar · zichtbaar bij ontdekken</option></Field><a href="/help/start-zonderclub">Hulp bij zelfstandig organiseren</a></>}
          {create === "tournament" && (
            <label className="workspace-checkbox">
              <input name="approvalRequired" type="checkbox" />
              Aanmeldingen eerst door de organisatie laten goedkeuren
            </label>
          )}
          <Field label="Toelating" name="eligibility">
            <option value="">Standaard van de omgeving</option>
            <option value="all">Open inschrijving</option>
            <option value="club">Alleen clubleden</option>
            <option value="code">Alleen via inschrijfcode</option>
          </Field>
          <div className="field-grid">
            <Field label="Datum" name="date" type="date" required />
            <Field
              label="Capaciteit"
              name="capacity"
              type="number"
              defaultValue={32}
            />
            <Field label="Format" name="format">
              {create === "league" ? (
                <>
                  <option value="best5">Round robin · best of 5</option>
                  <option value="best7">Round robin · best of 7</option>
                  <option value="fixed8">
                    8 vaste legs · gelijkspel mogelijk
                  </option>
                  <option value="fixed10">
                    10 vaste legs · gelijkspel mogelijk
                  </option>
                </>
              ) : (
                <>
                  <option value="pools-knockout">Poules → knock-out</option>
                  <option value="knockout">Single elimination</option><option value="double-elimination-reset">Dubbele eliminatie · resetfinale</option><option value="double-elimination-single">Dubbele eliminatie · enkele finale</option><option value="swiss">Zwitsers</option>
                </>
              )}
            </Field>
            <Field
              label="Aantal banen"
              name="boards"
              type="number"
              defaultValue={4}
            />
            <Field label="Startscore" name="startScore" defaultValue="501">
              <option>301</option>
              <option>501</option>
            </Field>
            <Field label="Best of legs" name="bestOfLegs" defaultValue="3">
              {[1, 3, 5, 7, 9].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Field>
          </div>
          <Button onClick={() => setCreate("")}>Annuleren</Button>
        </Form>
      )}
      {page === "events" && (
        <div className="workspace-grid">
          <Tile title="Competities" to="leagues" label="Bekijk competities">
            {data.leagues.length} competities · programma’s, tijdvoorstellen en
            standen.
          </Tile>
          <Tile title="Toernooien" to="hall" label="Bekijk toernooien">
            {data.tournaments.length} toernooien · check-in, poules en
            knock-out.
          </Tile>
          <Tile
            title="Speeldagen"
            to="operations"
            label="Naar wedstrijdleiding"
          >
            Inschrijving, baanindeling en alle wedstrijden op locatie.
          </Tile>
        </div>
      )}
      <div className="workspace-grid">
        {entities.length ? (
          listedEntities.map((e) => (
            <article className="panel workspace-tile" key={e.id} data-status={eventStatus(e)}>
              <Label value={eventStatus(e)} />
              <h2>{e.name}</h2>
              <p>{iso(e.state.date)}</p>
              <p>
                {
                  e.members.filter(
                    (m) => m.status === "active" || m.status === "registered",
                  ).length
                }{" "}
                / {text(e.state.capacity, 32)} deelnemers
              </p>
              <Link
                to={`${e.kind === "league" ? "leagues" : "hall"}/${e.id}`}
                primary
              >
                Open {e.kind === "league" ? "competitie" : "toernooi"}
              </Link>
            </article>
          ))
        ) : (
          <Empty>Er zijn nog geen evenementen in deze omgeving.</Empty>
        )}
      </div>
    </>
  );
}
function Operations({
  data,
  overview,
  command,
  busy,
}: {
  data: Platform;
  overview: Overview | null;
  command: Command;
  busy: boolean;
}) {
  return (
    <>
      <Title
        title="Wedstrijdleiding"
        actions={<Link to="events">Evenement maken</Link>}
      >
        Van check-in tot de laatste bevestigde uitslag.
      </Title>
      <div className="workspace-grid">
        <Tile
          title="Deelnemers & check-in"
          to="registrations"
          label="Open deelnemers"
        >
          Bekijk inschrijvingen en wie er klaarstaat om te spelen.
        </Tile>
        <Tile title="Schema & baanoproepen" to="events" label="Open speeldagen">
          Genereer het schema en wijs beschikbare banen toe.
        </Tile>
        <Tile
          title="Schermstudio"
          to="venue-cast/studio"
          label="Open studio"
          accent
        >
          Publieke zaalweergave en OBS volgen de gepubliceerde regiekeuze.
        </Tile>
      </div>
      <section className="panel">
        <h2>Banen op locatie</h2>
        {overview?.boards.length ? (
          overview.boards.map((b) => (
            <div className="workspace-row" key={b.id}>
              <div>
                <strong>{b.name}</strong>
                <small>
                  {b.blocked
                    ? "Geblokkeerd"
                    : b.matchId
                      ? "Wedstrijd gekoppeld"
                      : "Vrij"}
                </small>
              </div>
              <a className="button ghost small" href={`/baan/${b.id}`}>
                Telefoon / QR
              </a>
              <a className="button ghost small" href={`/baanscherm/${b.id}`} target="_blank" rel="noopener noreferrer">Open baanscherm ↗</a>
              {overview.permissions.canManage && <ScreenDeviceManager boardId={b.id} boardName={b.name} />}
              {b.matchId && (
                <>
                  <a
                    className="button gold small"
                    href={`/wedstrijd/${b.matchId}`}
                  >
                    Open scorekaart
                  </a>
                  <a
                    className="button ghost small"
                    href={`/wedstrijd/${b.matchId}?tablet=1`}
                  >
                    Schrijftablet
                  </a>
                </>
              )}
            </div>
          ))
        ) : (
          <Empty>Banen verschijnen na het aanmaken van een speeldag.</Empty>
        )}
      </section>
      <section className="panel">
        <h2>Jouw speeldagen</h2>
        {[...data.leagues, ...data.tournaments]
          .filter((e) => e.ownerId === data.profile.id)
          .map((e) => (
            <div className="workspace-row" key={e.id}>
              <strong>{e.name}</strong>
              <div className="button-row">
                <Link
                  to={`${e.kind === "league" ? "leagues" : "hall"}/${e.id}`}
                >
                  Open regie
                </Link>
                <Button
                  disabled={busy}
                  primary
                  onClick={() =>
                    void command({ type: "competition.autoplan", id: e.id }, e)
                  }
                >
                  Automatisch indelen
                </Button>
              </div>
            </div>
          ))}
      </section>
    </>
  );
}
function Cast({
  data,
  command,
  busy,
  overview,
}: {
  data: Platform;
  id?: string;
  command: Command;
  busy: boolean;
  overview?: Overview | null;
}) {
  const [selected, setSelected] = useState(() =>
    typeof location === "undefined"
      ? ""
      : new URLSearchParams(location.search).get("event") || "",
  );
  const events = [...data.tournaments, ...data.leagues].filter(
    (e) => e.canManage,
  );
  const entity = events.find((e) => e.id === selected) || events[0];
  const [scene, setScene] = useState("hall");
  const [boardId, setBoardId] = useState("");
  const [outputUrl, setOutputUrl] = useState("");
  const [grantId, setGrantId] = useState("");
  const program = record(entity?.state.cast);
  const labels: Record<string, string> = {
    hall: "Zaaloverzicht",
    board: "Bordscore",
    "180": "180!",
    finish: "Finish",
    result: "Uitslag",
    next: "Volgende partij",
    break: "Pauze",
  };
  const boards =
    overview?.boards.filter((b) => b.eventId === entity?.state.eventId) || [];
  async function share() {
    if (!entity) return;
    const result = await command({ type: "cast.share", id: entity.id }, entity);
    if (result?.url) setOutputUrl(new URL(result.url, location.origin).href);
    if (result?.grantId) setGrantId(result.grantId);
  }
  return (
    <>
      <Title title="Schermstudio">
        Zet een scene klaar in preview en schakel daarna het programma live.
      </Title>
      {!entity ? (
        <section className="panel">
          <Empty>
            Maak een speeldag om een zaal- of OBS-scherm te koppelen.
          </Empty>
          <Link to="events">Naar evenementen</Link>
        </section>
      ) : (
        <>
          <section className="panel">
            <label className="field">
              Speeldag
              <select
                value={entity.id}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setOutputUrl("");
                  setGrantId("");
                  setBoardId("");
                }}
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="workspace-grid two">
              <div className="workspace-cast-preview">
                <Label value="Preview" />
                <h2>{labels[scene]}</h2>
                <p>{entity.name}</p>
                {scene === "board" && (
                  <strong>
                    {boards.find((b) => b.id === boardId)?.name ||
                      "Kies een baan"}
                  </strong>
                )}
              </div>
              <div className="workspace-cast-preview live">
                <Label value="Programma" />
                <h2>
                  {labels[text(program.scene, "hall")] || text(program.scene)}
                </h2>
                <p>
                  {program.updatedAt
                    ? iso(program.updatedAt)
                    : "Nog geen scene gepubliceerd"}
                </p>
              </div>
            </div>
            <div className="field-grid">
              <label className="field">
                Scene
                <select
                  value={scene}
                  onChange={(e) => setScene(e.target.value)}
                >
                  {Object.entries(labels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Baan
                <select
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                >
                  <option value="">Automatisch / alle banen</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="button-row">
              <Button
                disabled={busy}
                onClick={() =>
                  void command(
                    {
                      type: "cast.update",
                      id: entity.id,
                      scene,
                      live: false,
                      ...(boardId ? { boardId } : {}),
                    },
                    entity,
                  )
                }
              >
                Preview klaarzetten
              </Button>
              <Button
                primary
                disabled={busy}
                onClick={() =>
                  void command(
                    {
                      type: "cast.update",
                      id: entity.id,
                      scene,
                      live: true,
                      ...(boardId ? { boardId } : {}),
                    },
                    entity,
                  )
                }
              >
                Zet preview live
              </Button>
            </div>
            <div className="divider" />
            <h3>Schermen koppelen</h3>
            <p className="muted-copy">
              Een uitgegeven schermlink geeft uitsluitend leestoegang tot deze
              speeldag. Open de link op het zaalapparaat of gebruik de
              OBS-uitgang als Browser Source.
            </p>
            <Button primary disabled={busy} onClick={() => void share()}>
              Schermlinks uitgeven
            </Button>
            {grantId && (
              <Button
                disabled={busy}
                onClick={() => {
                  void command(
                    { type: "cast.revoke", id: entity.id, grantId },
                    entity,
                  ).then((result) => {
                    if (result) {
                      setGrantId("");
                      setOutputUrl("");
                    }
                  });
                }}
              >
                Schermlinks intrekken
              </Button>
            )}
            {outputUrl && (
              <div className="cast-share-links">
                {["hall", "obs", "public"].map((view) => (
                  <div className="workspace-row" key={view}>
                    <div>
                      <strong>
                        {view === "hall"
                          ? "Zaalscherm / VeyoCast"
                          : view === "obs"
                            ? "OBS Browser Source"
                            : "Publieksweergave"}
                      </strong>
                      <small>
                        {outputUrl}?view={view}
                      </small>
                    </div>
                    <a
                      className="button ghost small"
                      target="_blank"
                      rel="noreferrer"
                      href={`${outputUrl}?view=${view}`}
                    >
                      Openen ↗
                    </a>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
function Preferences({
  data,
  command,
  busy,
}: {
  data: Platform;
  command: Command;
  busy: boolean;
}) {
  return (
    <>
      <Title title="Instellingen">
        Kies hoe anderen jou vinden en contact met je opnemen.
      </Title>
      <ProfileStatisticsLinks/>
      <section className="panel"><ThemePreferencePicker/></section>
      <ScoreInputSettings actorId={data.profile.id}/>
      <PlayerPinSettings user={data.profile}/>
      <Form
        title="Jouw profiel"
        busy={busy}
        onSubmit={async (form) => {
          await command({
            type: "profile.update",
            username: text(form.get("username")),
            fullName:text(form.get("fullName")),
            displayName:text(form.get('displayName')),
            showPublicStatistics:form.get('showPublicStatistics')==='on',
          });
        }}
      >
        <ProfileIdentityFields user={data.profile}disabled={busy}/>
        <label className="workspace-checkbox"><input name="showPublicStatistics" type="checkbox" defaultChecked={data.profile.showPublicStatistics===true}/>Historische profielcijfers tonen op openbare Oche Live-baanschermen</label>
      </Form>
      <Form
        title="Privacy"
        busy={busy}
        onSubmit={async (f) => {
          await command({
            type: "preferences.update",
            discoverable: f.get("discoverable") === "on",
            allowRequests: f.get("allowRequests") === "on",
          });
        }}
      >
        <label className="workspace-checkbox">
          <input
            name="discoverable"
            type="checkbox"
            defaultChecked={data.preferences.discoverable !== false}
          />
          Zichtbaar in de spelerszoeker
        </label>
        <label className="workspace-checkbox">
          <input
            name="allowRequests"
            type="checkbox"
            defaultChecked={data.preferences.allowRequests !== false}
          />
          Vriendschapsverzoeken ontvangen
        </label>
      </Form>
      <section className="panel" id="meldingen"><h2>Meldingen</h2><p>Beheer inbox, e-mail en push in één compact overzicht.</p><a className="button" href="/app/settings/notifications">Meldingsinstellingen openen</a><a className="button ghost" href="/app/notifications">Jouw meldingen</a></section>
      <section className="panel">
        <h2>Jouw account</h2>
        <p>{data.profile.name}</p>
        <p className="muted-copy">
          Eén profiel voor training, wedstrijden, clubs en evenementen.
        </p>
        <Link to="friends">Geblokkeerde spelers beheren</Link>
      </section>
    </>
  );
}
function CameraPreflight() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(false);
  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setActive(false);
  }, []);
  useEffect(() => () => stop(), [stop]);
  async function start() {
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera en microfoon vereisen een beveiligde HTTPS-verbinding.",
        );
      stop();
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      if (video.current) video.current.srcObject = stream.current;
      setActive(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Toegang tot camera of microfoon is geweigerd.",
      );
    }
  }
  return (
    <>
      <Title title="Camera & microfoon">
        Controleer je beeld en microfoon voordat je op afstand speelt.
      </Title>
      <section className="panel">
        <video
          className="workspace-camera"
          ref={video}
          autoPlay
          muted
          playsInline
        />
        <div className="button-row">
          <Button primary onClick={() => void start()}>
            Camera en microfoon testen
          </Button>
          <Button onClick={stop} disabled={!active}>
            Test stoppen
          </Button>
        </div>
        {active && (
          <p role="status">
            Camera en microfoon zijn beschikbaar. Deze test deelt je beeld niet
            met andere spelers.
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <Link to="practice">Naar een wedstrijdlobby</Link>
      </section>
    </>
  );
}
function Registry({
  data,
  overview,
  page,
  command,
  busy,
}: {
  data: Platform;
  overview: Overview | null;
  page: string;
  command: Command;
  busy: boolean;
}) {
  const names: Record<string, string> = {
    mymatches: "Mijn wedstrijden",
    matches: "Wedstrijden",
    rankings: "Ranglijsten",
    statistics: "Statistieken",
    players: "Spelers",
    registrations: "Inschrijvingen",
    reports: "Meldingen & geschillen",
    manage: "Clubbeheer",
  };
  const csv = () => {
    const rows = [
      ["Speler", "Gespeeld", "Gewonnen", "Punten"],
      ...(overview?.standings || []).map((s) => [
        s.name,
        s.played,
        s.won,
        s.points,
      ]),
    ];
    const value = rows
      .map((row) =>
        row
          .map(
            (v) =>
              '"' +
              (/^[=+\-@]/.test(String(v)) ? "'" : "") +
              String(v).replace(/"/g, '""') +
              '"',
          )
          .join(";"),
      )
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + value], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "dartflow-stand.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  const matches =
    (page === "reports" ||
    (page === "matches" && overview?.permissions.canManage)
      ? overview?.matches || []
      : data.matches || overview?.matches || []
    ).filter((m) =>
      page === "reports"
        ? m.status === "disputed"
        : m.players.some((p) => p.id === data.profile.id),
    ) || [];
  return (
    <>
      <Title
        title={names[page] || "Overzicht"}
        actions={
          page === "rankings" ? (
            <Button onClick={csv}>CSV exporteren</Button>
          ) : undefined
        }
      />
      {page === "manage" ? (
        <div className="workspace-grid">
          <Tile title="Verenigingen" to="clubs" label="Clubdossier">
            Leden, aanvragen, rollen en clubinstellingen.
          </Tile>
          <Tile title="Mailbeheer" to="mail" label="Open mail">
            Sjablonen, berichten en verzendstatus.
          </Tile>
          <Tile
            title="Platformintegraties"
            to="platform/integraties"
            label="Integraties"
          >
            Resend en Google Auth voor bevoegde platformbeheerders.
          </Tile>
        </div>
      ) : page === "players" ? (
        <section className="panel">
          {data.players.length ? (
            data.players.map((p) => (
              <div className="workspace-row" key={p.id}>
                <strong>{p.name}</strong>
                <a
                  href={`/app/practice?opponent=${p.id}`}
                  className="button ghost small"
                >
                  Uitdagen
                </a>
              </div>
            ))
          ) : (
            <Empty>Geen zichtbare spelers.</Empty>
          )}
        </section>
      ) : page === "rankings" ? (
        <section className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Speler</th>
                <th>Gespeeld</th>
                <th>Gewonnen</th>
                <th>Punten</th>
              </tr>
            </thead>
            <tbody>
              {overview?.standings.map((s, i) => (
                <tr key={s.playerId}>
                  <td>{i + 1}</td>
                  <td>{s.name}</td>
                  <td>{s.played}</td>
                  <td>{s.won}</td>
                  <td>{s.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!overview?.standings.length && (
            <Empty>
              Een ranglijst ontstaat uit bevestigde competitieve resultaten.
            </Empty>
          )}
        </section>
      ) : page === "statistics" ? (
        <PlayerStatisticsPanel/>
      ) : page === "registrations" ? (
        <section className="panel">
          <h2>Spelersregistratie</h2>
          {data.canManageRegistrations ? (
            (data.registrations || []).map((r) => (
              <div className="workspace-row" key={text(r.userId)}>
                <div>
                  <strong>{text(r.name)}</strong>
                  <small>{text(r.reason)}</small>
                </div>
                <Label value={r.status} />
                {r.status === "pending" && (
                  <div className="button-row">
                    <Button
                      primary
                      disabled={busy}
                      onClick={() =>
                        void command({
                          type: "registration.review",
                          userId: r.userId,
                          approved: true,
                          reason: "Aanvraag goedgekeurd.",
                        })
                      }
                    >
                      Goedkeuren
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt("Reden van afwijzing");
                        if (reason)
                          void command({
                            type: "registration.review",
                            userId: r.userId,
                            approved: false,
                            reason,
                          });
                      }}
                    >
                      Afwijzen
                    </Button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <>
              <p className="muted-copy">
                Vraag deelname aan het spelersregister aan met jouw bestaande
                account.
              </p>
              <Button
                primary
                disabled={busy}
                onClick={() => void command({ type: "registration.request" })}
              >
                Registratie aanvragen
              </Button>
            </>
          )}
          <h2>Evenementdeelnemers</h2>
          {[...data.tournaments, ...data.leagues].flatMap((e) =>
            e.members
              .filter((m) => m.attributes?.registered)
              .map((m) => (
                <div className="workspace-row" key={`${e.id}-${m.id}`}>
                  <div>
                    <strong>{m.name}</strong>
                    <small>{e.name}</small>
                  </div>
                  <Label value={m.status} />
                </div>
              )),
          )}
        </section>
      ) : (
        <>
          <section className="panel">
            {matches.map((m) => (
              <a
                className="workspace-row"
                key={m.id}
                href={`/wedstrijd/${m.id}`}
              >
                <div>
                  <strong>{m.players.map((p) => p.name).join(" — ")}</strong>
                  <small>{m.legs.join(" — ")} legs</small>
                </div>
                <Label value={m.status} />
              </a>
            ))}
            {!matches.length && (
              <Empty>
                {page === "reports"
                  ? "Geen openstaande scoregeschillen."
                  : "Je wedstrijden en bevestigde uitslagen verschijnen hier."}
              </Empty>
            )}
          </section>
          {page !== "reports" && !!data.history?.length && (
            <OwnResults history={data.history} />
          )}
          {page === "reports" && (
            <section className="panel">
              <h2>Moderatiemeldingen</h2>
              {(data.reports || []).length ? (
                (data.reports || []).map((r) => (
                  <div className="workspace-report" key={text(r.id)}>
                    <div className="section-heading">
                      <strong>
                        {text(r.roomName || r.reporterName, "Melding")}
                      </strong>
                      <Label value={r.status} />
                    </div>
                    <p>{text(r.reason)}</p>
                    <p className="muted-copy">Categorie: {text(r.category, 'other')} · Type: {text(r.targetType, 'user')} · Referentie: {text(r.contentId, 'onbekend')}</p>
                    {Boolean(r.decision) && (
                      <p className="muted-copy">
                        Beslissing: {text(r.decision)}
                      </p>
                    )}
                    {r.canManage === true && r.status !== "resolved" && (
                      <Form
                        title="Melding afhandelen"
                        submit="Beslissing vastleggen"
                        busy={busy}
                        onSubmit={async (f) => {
                          await command({
                            type: "report.resolve",
                            reportId: r.id,
                            reason: text(f.get("reason")),
                            operation: text(f.get("operation")),
                          });
                        }}
                      >
                        <Field label="Actie" name="operation"><option value="no-action">Geen verwijdering, beoordeling vastleggen</option><option value="remove-content">Gemelde inhoud verwijderen</option><option value="warn">Waarschuwing vastleggen</option></Field>
                        <Field label="Beoordeling" name="reason" required />
                      </Form>
                    )}
                  </div>
                ))
              ) : (
                <Empty>Geen zichtbare moderatiemeldingen.</Empty>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

function CompetitionControls({
  entity,
  overview,
  command,
  busy,
}: {
  entity: Entity;
  overview: Overview | null;
  command: Command;
  busy: boolean;
}) {
  const boards =
    overview?.boards.filter((b) => b.eventId === entity.state.eventId) || [];
  const registrationLocked =
    entity.members.some((member) => member.attributes?.registered === true) ||
    list(entity.state.fixtures).length > 0;
  const localTime = (value: unknown) => {
    if (!value) return "";
    const date = new Date(text(value));
    return Number.isNaN(date.getTime())
      ? ""
      : new Date(date.getTime() - date.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
  };
  return (
    <details className="panel competition-settings">
      <summary>Instellingen & baanbeheer</summary>
      <Form
        title="Speeldaginstellingen"
        busy={busy}
        onSubmit={async (f) => {
          const startsAt = text(f.get("startsAt")),
            checkInAt = text(f.get("checkInAt"));
          await command(
            {
              type: "competition.settings",
              id: entity.id,
              name: text(f.get("name")),
              description: text(f.get("description")),
              location: text(f.get("location")),
              date: text(f.get("date")),
              capacity: number(
                f.get("capacity"),
                number(entity.state.capacity, 32),
              ),
              ...(!registrationLocked
                ? {
                    eligibility: text(f.get("eligibility")),
                    ...(entity.kind === "tournament"
                      ? { approvalRequired: f.get("approvalRequired") === "on" }
                      : {}),
                  }
                : {}),
              paused: f.get("paused") === "on",
              autoSchedule: f.get("autoSchedule") === "on",
              requireWriter: f.get("requireWriter") === "on",
              callSeconds: number(f.get("callSeconds"), 120),
              restSeconds: number(f.get("restSeconds"), 90),
              cooldownSeconds: number(f.get("cooldownSeconds"), 30),
              ...(startsAt
                ? { startsAt: new Date(startsAt).toISOString() }
                : {}),
              ...(checkInAt
                ? { checkInAt: new Date(checkInAt).toISOString() }
                : {}),
            },
            entity,
          );
        }}
      >
        <Field
          label="Evenementnaam"
          name="name"
          defaultValue={entity.name}
          required
        />
        <Field
          label="Locatie"
          name="location"
          defaultValue={text(entity.state.location)}
        />
        {entity.kind === "tournament" && (
          <label className="workspace-checkbox">
            <input
              name="approvalRequired"
              type="checkbox"
              defaultChecked={entity.state.approvalRequired === true}
              disabled={registrationLocked}
            />
            Aanmeldingen eerst door de organisatie laten goedkeuren
          </label>
        )}
        <div className="field-grid">
          <Field
            label="Datum"
            name="date"
            type="date"
            defaultValue={text(entity.state.date)}
            required
          />
          <Field
            label="Capaciteit"
            name="capacity"
            type="number"
            defaultValue={number(entity.state.capacity, 32)}
          />
          <Field
            label="Toelating"
            name="eligibility"
            disabled={registrationLocked}
            defaultValue={text(
              entity.state.eligibility,
              entity.clubId ? "club" : "all",
            )}
          >
            <option value="all">Open inschrijving</option>
            <option value="club">Alleen clubleden</option>
            <option value="code">Alleen via inschrijfcode</option>
          </Field>
        </div>
        <label className="field">
          Omschrijving
          <textarea
            name="description"
            defaultValue={text(entity.state.description)}
            maxLength={2000}
          />
        </label>
        <div className="field-grid">
          <Field
            label="Start evenement"
            name="startsAt"
            type="datetime-local"
            defaultValue={localTime(entity.state.startsAt)}
          />
          <Field
            label="Start check-in"
            name="checkInAt"
            type="datetime-local"
            defaultValue={localTime(entity.state.checkInAt)}
          />
          <Field
            label="Oproep vervalt na (seconden)"
            name="callSeconds"
            type="number"
            defaultValue={number(entity.state.callSeconds, 120)}
          />
          <Field
            label="Spelersrust (seconden)"
            name="restSeconds"
            type="number"
            defaultValue={number(entity.state.restSeconds, 90)}
          />
          <Field
            label="Baancooldown (seconden)"
            name="cooldownSeconds"
            type="number"
            defaultValue={number(entity.state.cooldownSeconds, 30)}
          />
        </div>
        <label className="workspace-checkbox">
          <input
            name="paused"
            type="checkbox"
            defaultChecked={entity.state.paused === true}
          />
          Speeldag pauzeren
        </label>
        <label className="workspace-checkbox">
          <input
            name="autoSchedule"
            type="checkbox"
            defaultChecked={entity.state.autoSchedule === true}
          />
          Automatische baantoewijzing aan
        </label>
        <label className="workspace-checkbox">
          <input
            name="requireWriter"
            type="checkbox"
            defaultChecked={entity.state.requireWriter !== false}
          />
          Een beschikbare externe schrijver vereisen
        </label>
        <p className="muted-copy">
          Een tijd voor evenement of check-in maakt geplande herinneringen
          mogelijk. Geef lokale tijd op; de server bewaart UTC.
        </p>
      </Form>
      <h2 id="banen">Toernooiregie · Banen</h2>
      {boards.map((board) => (
        <div className="workspace-row" key={board.id}>
          <div>
            <strong>{board.name}</strong>
            <small>
              {board.matchId
                ? "Live partij"
                : board.blocked
                  ? "Geblokkeerd"
                  : "Vrij"}
            </small>
          </div>
          <a className="button ghost small" href={`/baanscherm/${board.id}`} target="_blank" rel="noopener noreferrer">Open baanscherm ↗</a>
          <ScreenDeviceManager boardId={board.id} boardName={board.name} />
          <div className="button-row">
            <Button
              disabled={busy || !!board.matchId}
              onClick={() =>
                void command(
                  {
                    type: "board.block",
                    id: entity.id,
                    boardId: board.id,
                    blocked: !board.blocked,
                  },
                  entity,
                )
              }
            >
              {board.blocked ? "Deblokkeren" : "Blokkeren"}
            </Button>
            <Button
              disabled={busy || !!board.matchId}
              onClick={() => {
                const reason = window.prompt("Reden van reservering");
                if (reason)
                  void command(
                    {
                      type: "board.reserve",
                      id: entity.id,
                      boardId: board.id,
                      reserved: true,
                      reason,
                    },
                    entity,
                  );
              }}
            >
              Reserveren
            </Button>
            <Button
              disabled={busy || !!board.matchId}
              onClick={() =>
                void command(
                  {
                    type: "board.reserve",
                    id: entity.id,
                    boardId: board.id,
                    reserved: false,
                  },
                  entity,
                )
              }
            >
              Reservering opheffen
            </Button>
          </div>
        </div>
      ))}
    </details>
  );
}

function FixtureControls({
  entity,
  fixture,
  overview,
  command,
  busy,
}: {
  entity: Entity;
  fixture: RecordValue;
  overview: Overview | null;
  command: Command;
  busy: boolean;
}) {
  const ids = Array.isArray(fixture.players)
    ? fixture.players.filter((id): id is string => typeof id === "string")
    : [];
  const boards =
    overview?.boards.filter(
      (board) => board.eventId === entity.state.eventId,
    ) || [];
  return (
    <details className="fixture-controls">
      <summary>Indelen & beslissen</summary>
      {fixture.status==='scheduled'&&<Form title="Vrijblijvende vooroproep" submit="Vooroproep tonen" busy={busy} onSubmit={async(data)=>{await command({type:'fixture.precall',id:entity.id,fixtureId:fixture.id,boardId:text(data.get('boardId')),showOnDisplay:true},entity);}}><p>Laat deelnemers zich voorbereiden zodra de lopende partij kan eindigen. De baan en spelers worden pas bij de definitieve oproep gereserveerd.</p><Field label="Bezette baan voor vooroproep" name="boardId" required><option value="">Kies een baan</option>{boards.filter(board=>!board.blocked&&board.matchId).map(board=><option key={board.id} value={board.id}>{board.name}</option>)}</Field>{Object.entries((entity.state.preCalls??{}) as Record<string,{fixtureId:string}>).filter(([,call])=>call.fixtureId===fixture.id).map(([boardId])=><Button key={boardId} disabled={busy} onClick={()=>void command({type:'fixture.precall',id:entity.id,boardId,enabled:false},entity)}>Vooroproep annuleren</Button>)}</Form>}

      <Form
        title="Baan handmatig toewijzen"
        submit="Partij oproepen"
        busy={busy}
        onSubmit={async (data) => {
          await command(
            {
              type: "fixture.assign",
              id: entity.id,
              fixtureId: fixture.id,
              boardId: text(data.get("boardId")),
              writerId: text(data.get("writerId")) || undefined,
            },
            entity,
          );
        }}
      >
        <div className="field-grid">
          <Field label="Baan" name="boardId" required>
            <option value="">Kies een vrije baan</option>
            {boards.map((board) => (
              <option
                key={board.id}
                value={board.id}
                disabled={board.blocked || !!board.matchId}
              >
                {board.name}
                {board.blocked
                  ? " · geblokkeerd"
                  : board.matchId
                    ? " · bezet"
                    : ""}
              </option>
            ))}
          </Field>
          <Field label="Externe schrijver" name="writerId">
            <option value="">Spelers schrijven zelf</option>
            {entity.members
              .filter(
                (member) =>
                  member.status === "active" &&
                  member.attributes?.registered === true &&
                  !ids.includes(member.id),
              )
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </Field>
        </div>
      </Form>
      {!fixture.matchId && (
        <Form
          title="Walkover vastleggen"
          submit="Walkover vaststellen"
          busy={busy}
          onSubmit={async (data) => {
            await command(
              {
                type: "fixture.walkover",
                id: entity.id,
                fixtureId: fixture.id,
                winnerId: text(data.get("winnerId")),
                reason: text(data.get("reason")),
              },
              entity,
            );
          }}
        >
          <Field label="Winnaar" name="winnerId" required>
            <option value="">Kies de aangewezen speler</option>
            {ids.map((id) => (
              <option key={id} value={id}>
                {entity.members.find((member) => member.id === id)?.name ||
                  "Speler"}
              </option>
            ))}
          </Field>
          <Field label="Reden van beslissing" name="reason" required />
        </Form>
      )}
    </details>
  );
}

function EntitySettings({
  entity,
  command,
  busy,
}: {
  entity: Entity;
  command: Command;
  busy: boolean;
}) {
  return (
    <details className="panel competition-settings">
      <summary>
        {entity.kind === "club"
          ? "Verenigingsinstellingen"
          : "Kamerinstellingen"}
      </summary>
      <Form
        title="Profiel & capaciteit"
        busy={busy}
        onSubmit={async (form) => {
          await command(
            {
              type: entity.kind === "club" ? "club.settings" : "room.settings",
              id: entity.id,
              name: text(form.get("name")),
              description: text(form.get("description")),
              capacity: number(
                form.get("capacity"),
                entity.kind === "club" ? 64 : 8,
              ),
            },
            entity,
          );
        }}
      >
        <Field label="Naam" name="name" defaultValue={entity.name} required />
        <label className="field">
          Omschrijving
          <textarea
            name="description"
            defaultValue={text(entity.state.description)}
            maxLength={2000}
          />
        </label>
        <Field
          label="Capaciteit"
          name="capacity"
          type="number"
          defaultValue={number(entity.state.capacity, 64)}
        />
        <p className="muted-copy">
          De capaciteit kan niet lager worden dan het aantal actieve deelnemers.
        </p>
      </Form>
    </details>
  );
}

function OwnResults({ history }: { history: ResultView[] }) {
  return (
    <section className="panel">
      <h2>Bevestigde uitslagen</h2>
      <p className="muted-copy">
        Je bevestigde resultaten blijven in je eigen historie bewaard.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Wedstrijd</th>
              <th>Legs</th>
              <th>Sets</th>
              <th>Uitslag</th>
            </tr>
          </thead>
          <tbody>
            {history.map((result) => (
              <tr key={result.matchId}>
                <td>
                  <strong>
                    {result.players.map((player) => player.name).join(" — ")}
                  </strong>
                </td>
                <td>{result.legs.join(" — ")}</td>
                <td>{result.sets.join(" — ")}</td>
                <td>
                  {result.players.find(
                    (player) => player.id === result.winnerId,
                  )?.name || "Gelijkspel"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
