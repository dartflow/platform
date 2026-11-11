"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Overview, Profile, MatchView, ResultView } from "@/lib/types";
import MailWorkspace from "./mail-workspace";
import IntegrationsPanel from "./integrations-panel";
import { MailPreferences } from "./mail-policy-panel";

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
};
type Platform = {
  profile: Profile;
  matches?: MatchView[];
  history?: ResultView[];
  players: Profile[];
  clubs: Entity[];
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
type Command = (action: Action, entity?: Entity) => Promise<Result | undefined>;

function inviteDetails(value: string): { id?: string; code: string } {
  try {
    const url = new URL(value, location.origin);
    if (url.pathname.startsWith("/app/")) {
      return {
        id: url.pathname.split("/").filter(Boolean).at(-1),
        code: url.searchParams.get("code") || "",
      };
    }
  } catch {
    /* A plain invitation code is valid input. */
  }
  return { code: value.trim() };
}
function ShareInvitation({ section, id }: { section: string; id: string }) {
  const code = invitationCode();
  return code ? (
    <div className="notice">
      <strong>Uitnodiging</strong>
      <p>
        Deel deze link met de bedoelde spelers. De code verloopt na zeven dagen.
      </p>
      <a className="text-link" href={entityUrl(section, id, code)}>
        {typeof location === "undefined" ? "" : location.origin}
        {entityUrl(section, id, code)}
      </a>
    </div>
  ) : null;
}
function invitationCode() {
  return typeof location === "undefined"
    ? ""
    : new URLSearchParams(location.search).get("code") || "";
}
function entityUrl(section: string, id: string, code?: string) {
  return `/app/${section}/${id}${code ? `?code=${encodeURIComponent(code)}` : ""}`;
}
async function joinInvitation(command: Command, type: string, value: string) {
  const parsed = inviteDetails(value);
  let id = parsed.id;
  if (!id) {
    const resolved = await command({
      type: "invitation.resolve",
      code: parsed.code,
    });
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
  children,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  disabled?: boolean;
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
}: {
  data: Platform;
  defaultValue?: string;
}) {
  const manageable = data.clubs.filter((club) => club.canManage);
  return (
    <Field
      label="Omgeving"
      name="clubId"
      defaultValue={
        defaultValue ??
        (data.canManageRegistrations ? "" : manageable[0]?.id || "")
      }
    >
      <option value="">Wereldwijd</option>
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
          e instanceof Error ? e.message : "De verbinding is onderbroken.",
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
    const wake = () => void refresh();
    window.addEventListener("online", wake);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", wake);
    };
  }, [refresh]);
  const command: Command = async (action, entity) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          ...(entity ? { expectedRevision: entity.revision } : {}),
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
      setError(e instanceof Error ? e.message : "De actie is niet uitgevoerd.");
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const pieces = path
    .replace(/^\/app\/?/, "")
    .split("/")
    .filter(Boolean);
  const page = pieces[0] || "home";
  const id = pieces[1];
  if (page === "platform") return <IntegrationsPanel />;
  if (page === "mail") return <MailWorkspace clubId={clubId} />;
  return (
    <div className="platform-workspace">
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
        ["community", "lobby"].includes(page) &&
        invitationCode() &&
        !(page === "community" ? data.rooms : data.lobbies).some(
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
                  type: page === "community" ? "room.join" : "lobby.join",
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
      ) : page === "training" ? (
        <Training data={data} id={id} command={command} busy={busy} />
      ) : page === "practice" || page === "lobby" ? (
        <Lobby data={data} id={id} command={command} busy={busy} />
      ) : page === "friends" ? (
        <Friends data={data} command={command} busy={busy} />
      ) : page === "clubs" ? (
        <Clubs data={data} id={id} command={command} busy={busy} />
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
  const personalMatches = data.matches || overview?.matches || [];
  const current = personalMatches.find(
    (m) =>
      m.status === "live" && m.players.some((p) => p.id === data.profile.id),
  );
  const results =
    personalMatches.filter(
      (m) =>
        m.status === "result" &&
        m.players.some(
          (p, i) => p.id === data.profile.id && !m.confirmations[i],
        ),
    ) || [];
  const competitions = [...data.leagues, ...data.tournaments].filter(
    (e) => (e.clubId || "") === clubId,
  );
  const scopedTraining = data.trainings.filter(
    (e) => e.ownerId === data.profile.id,
  );
  return (
    <>
      <Title title={organizer ? "Organiseren" : "Vandaag"}>
        {new Intl.DateTimeFormat("nl-NL", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "Europe/Amsterdam",
        }).format(new Date())}{" "}
        · {data.clubs.find((c) => c.id === clubId)?.name || "Wereldwijd"}
      </Title>
      {organizer ? (
        <>
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
        </>
      ) : (
        <>
          <div className="workspace-dashboard-grid">
            <section className="panel workspace-active workspace-tile">
              <p className="eyebrow">JOUW WEDSTRIJD</p>
              <h2>
                {current
                  ? "Actieve wedstrijd"
                  : results.length
                    ? "Uitslag bevestigen"
                    : "Klaar voor je volgende partij?"}
              </h2>
              {current ? (
                <>
                  <div className="workspace-active-score">
                    {current.players.map((p, i) => (
                      <div key={p.id}>
                        <span className="avatar">
                          {p.name
                            .split(" ")
                            .map((x) => x[0])
                            .slice(0, 2)
                            .join("")}
                        </span>
                        <strong>{p.name}</strong>
                        <b>
                          {current.legs[i]}
                          <small> legs</small>
                        </b>
                      </div>
                    ))}
                  </div>
                  <a className="button gold" href={`/wedstrijd/${current.id}`}>
                    Hervat je partij ↗
                  </a>
                </>
              ) : results[0] ? (
                <a className="button gold" href={`/wedstrijd/${results[0].id}`}>
                  Bevestig je uitslag ↗
                </a>
              ) : (
                <>
                  <p>
                    Speel een oefenleg, nodig een vriend uit of scan de QR-code
                    bij de baan.
                  </p>
                  <Link to="play" primary>
                    Naar Spelen
                  </Link>
                </>
              )}
            </section>
            <section className="panel workspace-shortcuts">
              <h2>Direct spelen</h2>
              <Link to="practice">
                Oefenwedstrijd <small>Lokaal of online</small>
              </Link>
              <Link to="lobby">Wedstrijdcode invoeren</Link>
              <a href="/spelen" className="button ghost">
                Baanmodus op locatie ↗
              </a>
            </section>
          </div>
          <div className="workspace-grid two">
            <section className="panel">
              <div className="section-heading">
                <h2>Jouw programma</h2>
                <Link to="events">Alle evenementen</Link>
              </div>
              {competitions.length ? (
                competitions.slice(0, 4).map((e) => (
                  <a
                    className="workspace-row"
                    key={e.id}
                    href={`/app/${e.kind === "league" ? "leagues" : "hall"}/${e.id}`}
                  >
                    <div>
                      <strong>{e.name}</strong>
                      <small>{iso(e.state.date)}</small>
                    </div>
                    <Label value={e.state.status || "open"} />
                  </a>
                ))
              ) : (
                <Empty>Je hebt hier nog geen competitie of toernooi.</Empty>
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <h2>Vrienden</h2>
                <Link to="friends">Bekijk vrienden</Link>
              </div>
              {data.friends.filter((f) => f.status === "friend").length ? (
                data.friends
                  .filter((f) => f.status === "friend")
                  .slice(0, 4)
                  .map((f) => (
                    <div className="workspace-row" key={f.id}>
                      <strong>{f.name}</strong>
                      <Label value={f.favorite ? "Favoriet" : "Vriend"} />
                    </div>
                  ))
              ) : (
                <Empty>Voeg een vriend toe en daag elkaar uit.</Empty>
              )}
            </section>
          </div>
          <div className="workspace-metrics">
            <Metric
              label="Bevestigde uitslagen"
              value={data.history?.length || overview?.history.length || 0}
            />
            <Metric label="Trainingen" value={scopedTraining.length} />
            <Metric
              label="Vriendschapsverzoeken"
              value={data.friends.filter((f) => f.status === "incoming").length}
            />
            <Metric
              label="Eigen verenigingen"
              value={
                data.clubs.filter((c) =>
                  c.members.some(
                    (m) => m.id === data.profile.id && m.status === "active",
                  ),
                ).length
              }
            />
          </div>
        </>
      )}
    </>
  );
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
            Het Sprint-scherm toont de actuele baan. Via de vaste QR voer je
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
              Alleen-lezen Sprint openen
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
              Sprint-scherm koppelen
            </Button>
          )}
        </div>
      </div>
    </section>
  );
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
}) {
  const entity = data.trainings.find((e) => e.id === id);
  const [score, setScore] = useState("");
  const [double, setDouble] = useState(false);
  const [visitDarts, setVisitDarts] = useState("3");
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
            data.trainings.map((e) => (
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
  const game = record(entity.state.game);
  const remain = Array.isArray(game.remaining) ? game.remaining : [];
  const visits = list(game.visits);
  const finished =
    entity.state.completed === true ||
    entity.state.status === "finished" ||
    game.status === "finished";
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
            <Link to="training">Alle trainingen</Link>
          )
        }
      />
      {typeof entity.state.boardId === "string" &&
        !finished &&
        entity.state.boardHeld === true && (
          <BoundBoardScreen
            boardId={entity.state.boardId}
            command={command}
            busy={busy}
          />
        )}
      <div className="workspace-grid two">
        <section className="panel training-console">
          <Label value={entity.state.mode} />
          <p className="eyebrow">
            {finished ? "TRAINING AFGEROND" : "JOUW RESTSCORE"}
          </p>
          <strong className="training-remaining">
            {entity.state.mode === "around"
              ? finished
                ? "✓"
                : Array.isArray(entity.state.rounds) &&
                    entity.state.rounds.length === 20
                  ? "Bull"
                  : text(
                      Array.isArray(entity.state.rounds)
                        ? entity.state.rounds.length + 1
                        : 1,
                    )
              : remain.length
                ? text(remain[0])
                : text(
                    entity.state.mode === "around"
                      ? Math.min(
                          21,
                          Array.isArray(entity.state.rounds)
                            ? entity.state.rounds.length + 1
                            : 1,
                        )
                      : entity.state.target || entity.state.remaining,
                    "—",
                  )}
          </strong>
          {entity.state.mode === "around" ? (
            <>
              <p>
                Drie darts op dubbel{" "}
                {Array.isArray(entity.state.rounds) &&
                entity.state.rounds.length === 20
                  ? "Bull"
                  : text(
                      Array.isArray(entity.state.rounds)
                        ? entity.state.rounds.length + 1
                        : 1,
                    )}
              </p>
              <div className="button-row">
                {[0, 1, 2, 3].map((hits) => (
                  <Button
                    key={hits}
                    disabled={busy || finished}
                    primary={hits > 0}
                    onClick={() =>
                      void command(
                        {
                          type: "training.score",
                          id: entity.id,
                          hits,
                          darts: 3,
                        },
                        entity,
                      )
                    }
                  >
                    {hits} geraakt
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await command(
                  {
                    type: "training.score",
                    id: entity.id,
                    score: number(score),
                    darts: number(visitDarts, 3),
                    doubleConfirmed: double,
                  },
                  entity,
                );
                if (result) {
                  setScore("");
                  setDouble(false);
                }
              }}
            >
              <label className="field">
                Beurtscore
                <input
                  autoComplete="off"
                  type="number"
                  min="0"
                  max="180"
                  inputMode="numeric"
                  required
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  disabled={finished || busy}
                />
              </label>
              <label className="field">
                Gegooide darts
                <select
                  value={visitDarts}
                  onChange={(event) => setVisitDarts(event.target.value)}
                  disabled={finished || busy}
                >
                  {[1, 2, 3].map((count) => (
                    <option key={count}>{count}</option>
                  ))}
                </select>
              </label>
              <label className="workspace-checkbox">
                <input
                  type="checkbox"
                  checked={double}
                  onChange={(e) => setDouble(e.target.checked)}
                />
                Laatste dart is een dubbel
              </label>
              <div className="button-row">
                {[26, 45, 60, 100, 140, 180].map((n) => (
                  <Button
                    disabled={busy || finished}
                    key={n}
                    onClick={() => setScore(String(n))}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <button className="button gold full" disabled={busy || finished}>
                {busy ? "Opslaan…" : "Score invoeren"}
              </button>
            </form>
          )}
          <div className="button-row">
            {finished && (
              <Button
                primary
                disabled={busy}
                onClick={() => {
                  void command({
                    type:
                      typeof entity.state.boardId === "string"
                        ? "board.start"
                        : "training.create",
                    ...(typeof entity.state.boardId === "string"
                      ? { boardId: entity.state.boardId }
                      : {}),
                    mode: entity.state.mode,
                    startScore:
                      entity.state.mode === "170"
                        ? 501
                        : number(game.startScore, 501),
                    botAverage: number(entity.state.botAverage, 45),
                  }).then((result) => {
                    if (result?.id) navigate(`/app/training/${result.id}`);
                  });
                }}
              >
                Opnieuw trainen
              </Button>
            )}
            <Button
              disabled={
                busy ||
                (entity.state.mode === "around"
                  ? !Array.isArray(entity.state.rounds) ||
                    !entity.state.rounds.length
                  : !Array.isArray(entity.state.undo) ||
                    !entity.state.undo.length)
              }
              onClick={() =>
                void command({ type: "training.undo", id: entity.id }, entity)
              }
            >
              Laatste beurt terug
            </Button>
            <Button
              disabled={busy || finished}
              onClick={() =>
                void command({ type: "training.finish", id: entity.id }, entity)
              }
            >
              Training bewaren en beëindigen
            </Button>
          </div>
        </section>
        <section className="panel">
          <h2>Trainingsoverzicht</h2>
          {entity.state.mode === "170" && (
            <p>
              Nog {Math.max(0, 9 - number(list(game.stats)[0]?.darts))} darts in
              deze poging.
            </p>
          )}
          {entity.state.mode === "around" &&
            Array.isArray(entity.state.rounds) && (
              <div className="workspace-scroll">
                {entity.state.rounds.map((hits, index) => (
                  <div className="workspace-row" key={index}>
                    <strong>{index === 20 ? "Bull" : `D${index + 1}`}</strong>
                    <span>{number(hits)} / 3 raak</span>
                  </div>
                ))}
              </div>
            )}
          {entity.state.mode === "bot" && remain.length > 1 && (
            <p>
              Dartbot resterend: <strong>{text(remain[1])}</strong>
            </p>
          )}
          <p className="muted-copy">
            {text(entity.state.checkout || game.checkout)}
          </p>
          <div className="workspace-scroll">
            {visits.length ? (
              visits
                .slice()
                .reverse()
                .map((v, i) => (
                  <div className="workspace-row" key={i}>
                    <span>
                      {number(v.playerIndex) === 1 ? "Dartbot" : "Jij"} ·{" "}
                      {number(v.darts, 3)} darts
                    </span>
                    <strong>{v.bust ? "BUST" : text(v.score)}</strong>
                    <span>{text(v.remainingAfter)} rest</span>
                  </div>
                ))
            ) : (
              <Empty>Je opgeslagen beurten verschijnen hier.</Empty>
            )}
          </div>
        </section>
      </div>
    </>
  );
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
        <Field label="Speler" name="userId" required>
          <option value="">Kies een speler</option>
          {data.players
            .filter(
              (p) =>
                p.id !== data.profile.id &&
                !data.friends.some((f) => f.id === p.id),
            )
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Field>
      </Form>
      <section className="panel">
        <h2>Vrienden & verzoeken</h2>
        {data.friends.length ? (
          data.friends.map((f) => (
            <div className="workspace-row" key={f.id}>
              <div>
                <strong>{f.name}</strong>
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
  command,
  busy,
}: {
  data: Platform;
  id?: string;
  command: Command;
  busy: boolean;
}) {
  const entity = data.clubs.find(
    (e) => e.id === id || text(e.state.code) === id,
  );
  if (entity) {
    const own = entity.members.find((m) => m.id === data.profile.id);
    const manager = entity.canManage === true;
    return (
      <>
        <Title
          title={entity.name}
          actions={<Link to="clubs">Alle verenigingen</Link>}
        >
          {text(entity.state.description)}
        </Title>
        <ShareInvitation section="clubs" id={entity.id} />
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
            <article className="panel workspace-tile" key={c.id}>
              <h2>{c.name}</h2>
              <p>{text(c.state.description)}</p>
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
        <ShareInvitation section="community" id={entity.id} />
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
              <form
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
              </form>
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
}: {
  data: Platform;
  id?: string;
  command: Command;
  busy: boolean;
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
        {typeof entity.state.boardId === "string" &&
          !entity.state.closed &&
          selfActive && (
            <BoundBoardScreen
              boardId={entity.state.boardId}
              command={command}
              busy={busy}
            />
          )}
        <div className="workspace-grid two">
          <section className="panel">
            <h2>Wedstrijdlobby</h2>
            <p className="muted-copy">
              Deel de code of uitnodigingslink met je tegenstander.
            </p>
            <strong className="workspace-code">
              {invitationCode() || entity.id}
            </strong>
            <p>
              <a
                className="text-link"
                href={entityUrl("lobby", entity.id, invitationCode())}
              >
                {typeof location !== "undefined"
                  ? `${location.origin}${entityUrl("lobby", entity.id, invitationCode())}`
                  : entityUrl("lobby", entity.id)}
              </a>
            </p>
            {entity.members.map((m) => (
              <div className="workspace-row" key={m.id}>
                <strong>{m.name}</strong>
                <Label
                  value={ready[m.id] ? "ready" : "Wacht op gereedmelding"}
                />
              </div>
            ))}
            <div className="button-row">
              {entity.ownerId === data.profile.id &&
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
                disabled={
                  busy ||
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
          <section className="panel">
            <h2>Bordcontrole</h2>
            <p>
              {text(record(entity.state.settings).startScore, 501)} · dubbel uit
              · best of {text(record(entity.state.settings).bestOfLegs, 3)}
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
          </section>
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
  const entity = entities.find((e) => e.id === id);
  if (entity) {
    const manager = entity.canManage === true;
    const member = entity.members.find((m) => m.id === data.profile.id);
    const fixtures = list(entity.state.fixtures);
    const standings = list(entity.state.standings);
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
                <Button
                  disabled={busy}
                  onClick={() =>
                    void command(
                      { type: "competition.plan", id: entity.id },
                      entity,
                    )
                  }
                >
                  Schema genereren
                </Button>
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
                          disabled={busy}
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
                  {manager && f.status !== "confirmed" && (
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
                    <th>Punten</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((s, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        {text(
                          s.name ||
                            data.players.find((p) => p.id === s.playerId)?.name,
                        )}
                      </td>
                      <td>{text(s.played)}</td>
                      <td>{text(s.won)}</td>
                      <td>{text(s.points)}</td>
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
              name: text(f.get("name")),
              clubId: text(f.get("clubId")) || null,
              capacity: number(f.get("capacity"), 32),
              ...(text(f.get("eligibility"))
                ? { eligibility: text(f.get("eligibility")) }
                : {}),
              format: text(f.get("format")),
              startScore: number(f.get("startScore"), 501),
              bestOfLegs: number(f.get("bestOfLegs"), 3),
              date: text(f.get("date")),
              location: text(f.get("location")),
              ...(create === "tournament"
                ? { approvalRequired: f.get("approvalRequired") === "on" }
                : {}),
              boards: number(f.get("boards"), 4),
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
          <Field label="Locatie" name="location" />
          <Scope data={data} />
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
                  <option value="knockout">Single elimination</option>
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
          entities.map((e) => (
            <article className="panel workspace-tile" key={e.id}>
              <Label value={e.state.status || "open"} />
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
      <Form
        title="Jouw profiel"
        busy={busy}
        onSubmit={async (form) => {
          await command({
            type: "profile.update",
            name: text(form.get("name")),
          });
        }}
      >
        <Field
          label="Zichtbare naam"
          name="name"
          defaultValue={data.profile.name}
          required
        />
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
      <MailPreferences />
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
        <div className="workspace-metrics">
          {Object.entries({
            played: "Gespeeld",
            won: "Gewonnen",
            drawn: "Gelijk",
            average: "Gemiddelde",
            oneEighties: "180’s",
            highestFinish: "Hoogste finish",
            totalDarts: "Gegooide darts",
            trainingSessions: "Trainingen",
          }).map(([key, label]) => (
            <Metric
              key={key}
              label={label}
              value={number(data.statistics?.[key])}
            />
          ))}
        </div>
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
                          });
                        }}
                      >
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
