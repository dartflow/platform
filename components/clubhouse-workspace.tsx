"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import type { ClubEntity } from "@/lib/club-types";
import type { PlatformEntity } from "@/lib/platform-types";
import type {
  ClubhouseView as View,
  ClubhousePage as Page,
  ClubhouseCommand,
  ClubTeam,
  ClubTask,
  ClubActivity,
  ClubBranding,
  BrandingDesign,
} from "@/lib/clubhouse-types";
import { deriveThemeTokens } from "@/lib/clubhouse-theme-domain";
import { FeedWorkspace } from "./feed-workspace";
import { ClubWorkspace } from "./club-ui";
import CompetitionWizard from "./competition-wizard";
import { ThemePreferencePicker, useClubhouseTheme } from "./clubhouse-theme";
import ClubhouseChat from "./clubhouse-chat";

export const CLUBHOUSE_NAV: { page: Page; slug: string; label: string }[] = [
  { page: "overview", slug: "", label: "Overzicht" },
  { page: "feed", slug: "feed", label: "Verenigingsfeed" },
  { page: "calendar", slug: "agenda", label: "Agenda" },
  { page: "members", slug: "leden", label: "Leden" },
  { page: "teams", slug: "teams", label: "Teams" },
  { page: "competitions", slug: "competities", label: "Competities" },
  { page: "matches", slug: "partijen", label: "Partijen" },
  { page: "locations", slug: "locaties", label: "Locaties & banen" },
  { page: "tasks", slug: "taken", label: "Taken & vrijwilligers" },
  { page: "dues", slug: "contributie", label: "Contributie" },
  { page: "manage", slug: "beheer", label: "Verenigingsbeheer" },
];
const pageFor = (slug?: string): Page =>
  CLUBHOUSE_NAV.find((x) => x.slug === slug || x.page === slug)?.page ??
  "overview";
const date = (value: string | null | undefined, short = false) =>
  value
    ? new Date(value).toLocaleString("nl-NL", {
        timeZone: "Europe/Amsterdam",
        ...(short
          ? { day: "numeric", month: "short" }
          : { dateStyle: "medium", timeStyle: "short" }),
      })
    : "Nog niet gepland";
const localDate = (value: string) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
const value = (f: FormData, key: string) => String(f.get(key) ?? "");
const checked = (f: FormData, key: string) => f.getAll(key).map(String);
const message = (e: unknown) =>
  e instanceof Error ? e.message : "De actie kon niet worden voltooid.";
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.error ?? "Dit verenigingsonderdeel is niet beschikbaar."),
      { status: response.status },
    );
  return data;
}
type Action = ClubhouseCommand["action"];
type Send = (
  action: Omit<Action, "clubId"> & { type: string },
  revision?: number,
) => Promise<boolean>;
type Props = {
  clubId: string;
  section?: string;
  actorId: string;
  players: { id: string; name: string }[];
  legacyCommand: (
    action: { type: string; [key: string]: unknown },
    entity?: PlatformEntity,
  ) => Promise<unknown>;
  legacyBusy: boolean;
};
function Empty({ children }: { children: ReactNode }) {
  return <div className="ch-empty">{children}</div>;
}
function Field({
  label,
  name,
  type = "text",
  defaultValue = "",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  required?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        maxLength={type === "text" ? 160 : undefined}
      />
    </label>
  );
}
function Description({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <label className="field">
      Omschrijving
      <textarea
        name="description"
        defaultValue={defaultValue}
        maxLength={4000}
      />
    </label>
  );
}
function MembersSelect({
  members,
  name,
  label,
  selected = [],
}: {
  members: ClubEntity["members"];
  name: string;
  label: string;
  selected?: string[];
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="ch-selection-list">
        {members
          .filter((m) => m.status === "active")
          .map((m) => (
            <label className="ch-selection" key={m.id}>
              <input
                type="checkbox"
                name={name}
                value={m.id}
                defaultChecked={selected.includes(m.id)}
              />
              {m.name}
            </label>
          ))}
      </div>
    </fieldset>
  );
}

export default function ClubhouseWorkspace({
  clubId,
  section,
  actorId,
  players,
  legacyCommand,
  legacyBusy,
}: Props) {
  const page = pageFor(section),
    base = `/app/clubs/${clubId}`;
  const [data, setData] = useState<View | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [wizard, setWizard] = useState(false);
  const [now] = useState(() => Date.now());
  const active = useRef(true),
    generation = useRef(0),
    pending = useRef<ClubhouseCommand | null>(null);
  const theme = useClubhouseTheme();
  const stopRequests = useCallback(() => {
    active.current = false;
    generation.current++;
  }, []);
  const refresh = useCallback(async () => {
    const n = ++generation.current;
    try {
      const next = await api<View>(`/api/clubhouse/${clubId}?page=${page}`);
      if (active.current && n === generation.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (active.current && n === generation.current) {
        setError(message(e));
        if ([401, 403, 404].includes((e as { status: number }).status))
          setData(null);
      }
    }
  }, [clubId, page]);
  useEffect(() => {
    active.current = true;
    setData(null);
    void refresh();
    setWizard(
      new URLSearchParams(location.search).has("nieuw") ||
        new URLSearchParams(location.search).has("concept"),
    );
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20000);
    const focus = () => void refresh();
    window.addEventListener("online", focus);
    window.addEventListener("focus", focus);
    window.addEventListener("dartflow-clubhouse-changed", focus);
    return () => {
      stopRequests();
      clearInterval(timer);
      window.removeEventListener("online", focus);
      window.removeEventListener("focus", focus);
      window.removeEventListener("dartflow-clubhouse-changed", focus);
    };
  }, [refresh, stopRequests]);
  const send: Send = async (action, revision) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    const next: ClubhouseCommand = {
      requestId: crypto.randomUUID(),
      ...(revision !== undefined ? { expectedRevision: revision } : {}),
      action: { ...action, clubId },
    };
    if (
      pending.current &&
      JSON.stringify(pending.current.action) !== JSON.stringify(next.action)
    ) {
      setError(
        "Een eerdere actie is nog niet bevestigd. Probeer die eerst opnieuw.",
      );
      setBusy(false);
      return false;
    }
    const command = pending.current ?? next;
    pending.current = command;
    try {
      await api("/api/clubhouse/actions", command);
      pending.current = null;
      await refresh();
      if (
        action.type.startsWith("branding.") ||
        action.type.startsWith("entitlement.")
      )
        await theme.refresh();
      setNotice("Opgeslagen.");
      return true;
    } catch (e) {
      setError(message(e));
      if ((e as { status: number }).status < 500) pending.current = null;
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <section className="panel">
        <h1>Verenigingsomgeving</h1>
        <p>{error || "Actuele verenigingsgegevens ophalen…"}</p>
        {error && (
          <button className="button ghost" onClick={() => void refresh()}>
            Opnieuw ophalen
          </button>
        )}
        <a className="button ghost" href="/app/clubs">
          Alle verenigingen
        </a>
      </section>
    );
  const href = (next: Page) =>
    `${base}/${CLUBHOUSE_NAV.find((x) => x.page === next)?.slug ?? ""}`.replace(
      /\/$/,
      "",
    );
  const permitted = data.pages.includes(page),
    can = (permission: string) =>
      data.permissions.includes(permission as View["permissions"][number]);
  const legacy = (tab: string) => (
    <ClubWorkspace
      key={tab}
      entity={data.club}
      actorId={actorId}
      players={players}
      command={async (action, entity) => {
        const result = await legacyCommand(action, entity);
        await refresh();
        return result;
      }}
      busy={legacyBusy}
      initialTab={tab}
      embedded
    />
  );
  return (
    <div className="ch-workspace" data-club-id={data.club.id}>
      <header className="ch-page-heading">
        <div>
          <p className="ch-eyebrow">Jouw vereniging · DartFlow Clubhouse</p>
          <h1>{data.club.name}</h1>
          <p>
            {String(
              data.club.state.description ?? "Samen spelen, samen regelen.",
            )}
          </p>
        </div>
        <a className="button ghost" href="/app/clubs">
          Vereniging wisselen
        </a>
      </header>
      <nav className="ch-page-nav" aria-label="Verenigingsonderdelen">
        {CLUBHOUSE_NAV.filter((item) => data.pages.includes(item.page)).map(
          (item) => (
            <a
              href={href(item.page)}
              key={item.page}
              aria-current={page === item.page ? "page" : undefined}
            >
              {item.label}
              {item.page === "members" &&
                data.club.clubAccess.canApprove &&
                data.club.clubDetails.requests.some(
                  (r) => r.status === "pending",
                ) && (
                  <span className="ch-status">
                    {
                      data.club.clubDetails.requests.filter(
                        (r) => r.status === "pending",
                      ).length
                    }
                  </span>
                )}
            </a>
          ),
        )}
      </nav>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {pending.current && !busy && (
        <button
          className="button ghost"
          onClick={() =>
            void send(
              pending.current!.action,
              pending.current!.expectedRevision,
            )
          }
        >
          Dezelfde actie opnieuw proberen
        </button>
      )}
      {!permitted ? (
        <Empty>Je hebt momenteel geen toegang tot dit onderdeel.</Empty>
      ) : (
        <>
          {page === "overview" && (
            <>
              <div className="ch-grid">
                <section className="panel ch-hero">
                  <div>
                    <p className="ch-eyebrow">Meer dan alleen darts</p>
                    <h2>
                      Jouw club.
                      <br />
                      Jouw thuisbasis.
                    </h2>
                    <p>
                      Bekijk wat er speelt, spreek af met je team en regel samen
                      de clubavond.
                    </p>
                    <a className="button gold" href={href("feed")}>
                      Ontdek de verenigingsfeed ↗
                    </a>
                  </div>
                  {data.theme.effective.logoData && (
                    <img
                      className="ch-hero-logo"
                      src={data.theme.effective.logoData}
                      alt={`Logo ${data.club.name}`}
                    />
                  )}
                </section>
                <section className="panel">
                  <p className="ch-eyebrow">Volgende wedstrijd</p>
                  {data.nextMatch ? (
                    <>
                      <h2>{data.nextMatch.name}</h2>
                      <p>{data.nextMatch.playerNames.join(" – ")}</p>
                      <p>{date(data.nextMatch.startsAt)}</p>
                      {data.nextMatch.canOpen && (
                        <a
                          className="button ghost"
                          href={
                            data.nextMatch.seasonId
                              ? `/app/competities/${data.nextMatch.seasonId}`
                              : `/wedstrijd/${data.nextMatch.matchId ?? data.nextMatch.id}`
                          }
                        >
                          Bekijk wedstrijd
                        </a>
                      )}
                    </>
                  ) : (
                    <Empty>Er staat nog geen volgende wedstrijd gepland.</Empty>
                  )}
                </section>
              </div>
              <div className="ch-grid ch-kpis">
                {[
                  ["Leden", data.metrics.members],
                  ["Bevestigde teamontmoetingen", data.metrics.teamMatches],
                  [
                    "Bevestigde individuele uitslagen",
                    data.metrics.individualMatches,
                  ],
                  ["Actieve teams", data.metrics.activeTeams],
                ].map(([label, count]) => (
                  <section className="panel ch-kpi" key={label}>
                    <p>{label}</p>
                    <strong>{count}</strong>
                    <small>
                      {label === "Leden" || label === "Actieve teams"
                        ? "Actuele stand"
                        : `${date(data.metrics.period.from, true)} – ${date(data.metrics.period.to, true)}`}
                    </small>
                  </section>
                ))}
              </div>
              <div className="ch-grid">
                <section className="panel">
                  <div className="workspace-row">
                    <h2>Op de clubagenda</h2>
                    <a href={href("calendar")}>Bekijk agenda ↗</a>
                  </div>
                  <div className="ch-list">
                    {data.activities
                      .filter((a) => Date.parse(a.endsAt) >= now)
                      .slice(0, 4)
                      .map((activity) => (
                        <a
                          className="ch-list-item"
                          key={activity.id}
                          href={`${href("calendar")}?activiteit=${activity.id}`}
                        >
                          <div>
                            <strong>{activity.title}</strong>
                            <small>
                              {date(activity.startsAt)} · {activity.location}
                            </small>
                          </div>
                          <span>›</span>
                        </a>
                      ))}
                  </div>
                  {!data.activities.length && (
                    <Empty>Er zijn nog geen clubactiviteiten.</Empty>
                  )}
                </section>
                <section className="panel">
                  <div className="workspace-row">
                    <h2>Samen geregeld</h2>
                    <a href={href("tasks")}>Alle taken ↗</a>
                  </div>
                  {data.tasks
                    .filter((task) => task.status !== "done")
                    .slice(0, 4)
                    .map((task) => (
                      <div className="ch-list-item" key={task.id}>
                        <div>
                          <strong>{task.title}</strong>
                          <small>
                            {task.deadline
                              ? date(task.deadline)
                              : "Geen vaste deadline"}{" "}
                            · {task.volunteerIds.length}/{task.capacity}{" "}
                            vrijwilligers
                          </small>
                        </div>
                        <a href={href("tasks")}>Bekijk</a>
                      </div>
                    ))}
                  {!data.tasks.some((t) => t.status !== "done") && (
                    <Empty>Geen open taken. Samen goed geregeld.</Empty>
                  )}
                  {data.club.clubAccess.canApprove &&
                    data.club.clubDetails.requests.some(
                      (r) => r.status === "pending",
                    ) && (
                      <p className="notice">
                        <a href={href("members")}>
                          Er wachten lidmaatschapsaanvragen op beoordeling.
                        </a>
                      </p>
                    )}
                </section>
              </div>
              <ClubhouseFeedSummary feed={data.feed} href={href("feed")} />
              {Array.isArray(data.club.state.news) &&
                data.club.state.news.length > 0 && (
                  <details className="panel">
                    <summary>Eerder verenigingsnieuws</summary>
                    {data.club.state.news.map((raw, index) => {
                      const item = raw as {
                        id?: string;
                        title?: string;
                        body?: string;
                      };
                      return (
                        <article key={item.id ?? index}>
                          <h3>{String(item.title ?? "Verenigingsnieuws")}</h3>
                          <p style={{ whiteSpace: "pre-wrap" }}>
                            {String(item.body ?? "")}
                          </p>
                        </article>
                      );
                    })}
                  </details>
                )}
            </>
          )}
          {page === "feed" && (
            <FeedWorkspace
              path={`/app/feed/club/${clubId}`}
              userId={actorId}
              embedded
            />
          )}
          {page === "calendar" && (
            <Calendar view={data} busy={busy} send={send} clubId={clubId} />
          )}
          {page === "members" && (
            <>
              <MemberActions
                view={data}
                actorId={actorId}
                busy={busy}
                send={send}
              />
              {legacy("leden")}
              {data.club.clubAccess.canApprove && legacy("aanvragen")}
              <section className="panel">
                <h2>Mijn lidmaatschap</h2>
                {data.club.clubAccess.isOwner ? (
                  <p>
                    Draag het eigendom eerst over via{" "}
                    <a href={href("manage")}>Verenigingsbeheer</a> als je de
                    vereniging wilt verlaten.
                  </p>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const result = await legacyCommand(
                        { type: "club.leave", id: clubId },
                        data.club,
                      );
                      if (
                        result &&
                        typeof result === "object" &&
                        "ok" in result &&
                        result.ok === true
                      )
                        window.location.assign(
                          new URL("/app/clubs", window.location.origin).href,
                        );
                    }}
                  >
                    <p>
                      Na vertrek vervallen je toegang tot de besloten feed, chat
                      en clubhuisstijl. Historische uitslagen blijven bewaard.
                    </p>
                    <label className="check">
                      <input type="checkbox" required />
                      Ik wil mijn lidmaatschap beëindigen.
                    </label>
                    <button className="button ghost" disabled={legacyBusy}>
                      Vereniging verlaten
                    </button>
                  </form>
                )}
              </section>
            </>
          )}
          {page === "teams" && <Teams view={data} busy={busy} send={send} />}
          {page === "competitions" &&
            (wizard ? (
              <CompetitionWizard
                clubId={clubId}
                actorId={actorId}
                onClose={() => {
                  history.replaceState({}, "", href("competitions"));
                  setWizard(false);
                }}
              />
            ) : (
              <>
                <section className="panel">
                  <div className="workspace-row">
                    <div>
                      <h2>Verenigingscompetities</h2>
                      <p>
                        Interne competities van {data.club.name}, met echte
                        deelnemers en planning.
                      </p>
                    </div>
                    {can("competitions.manage") && (
                      <button
                        className="button gold"
                        onClick={() => setWizard(true)}
                      >
                        Nieuwe competitie
                      </button>
                    )}
                  </div>
                  <div className="ch-card-links">
                    {data.competitions.map((competition) => (
                      <a
                        className="panel"
                        key={competition.id}
                        href={`/app/competities/${competition.id}`}
                      >
                        <h3>{competition.name}</h3>
                        <span className="ch-status">{competition.status}</span>
                        <p>
                          {competition.format} ·{" "}
                          {competition.participants.length} spelers ·{" "}
                          {competition.teams.length} teams
                        </p>
                      </a>
                    ))}
                  </div>
                  {!data.competitions.length && (
                    <Empty>Er zijn nog geen interne competities.</Empty>
                  )}
                </section>
                <section className="panel">
                  <h2>Leagues tussen verenigingen</h2>
                  <p>
                    De bestaande leagues houden hun eigen deelnemers, planning
                    en wedstrijdleiding.
                  </p>
                  <a className="button ghost" href="/app/leagues">
                    Bestaande leagues bekijken
                  </a>
                </section>
              </>
            ))}
          {page === "matches" && (
            <section className="panel">
              <h2>Partijen & teamontmoetingen</h2>
              <p>
                Teamontmoetingen en hun individuele onderdelen blijven
                afzonderlijk herkenbaar.
              </p>
              {data.matches.map((match) => (
                <div className="ch-list-item" key={match.id}>
                  <div>
                    <strong>{match.name}</strong>
                    <p>{match.playerNames.join(" – ")}</p>
                    <small>
                      {date(match.startsAt)} · {match.status}
                    </small>
                  </div>
                  {match.canOpen && (
                    <a
                      className="button ghost"
                      href={
                        match.seasonId
                          ? `/app/competities/${match.seasonId}`
                          : `/wedstrijd/${match.matchId ?? match.id}`
                      }
                    >
                      Openen
                    </a>
                  )}
                </div>
              ))}
              {!data.matches.length && (
                <Empty>Geen partijen zichtbaar binnen deze vereniging.</Empty>
              )}
            </section>
          )}
          {page === "locations" && (
            <>
              <section className="panel">
                <h2>Locaties, banen & Oche Live</h2>
                <p>
                  Deze planningskoppelingen zijn aan de vereniging toegekend.
                  Fysiek locatie- en baanbeheer wordt afzonderlijk
                  gecontroleerd.
                </p>
                {data.locations.map((location) => (
                  <article className="panel" key={location.id}>
                    <h3>{location.name}</h3>
                    <small>{location.timezone}</small>
                    <div className="ch-card-links">
                      {location.boards.map((board) => (
                        <div className="panel" key={board.id}>
                          <h4>{board.name}</h4>
                          <div className="button-row">
                            <a
                              className="button ghost"
                              href={`/baan/${board.id}`}
                            >
                              Baan openen
                            </a>
                            <a
                              className="button ghost"
                              href={`/baanscherm/${board.id}`}
                            >
                              Oche Live bekijken
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
                {!data.locations.length && (
                  <Empty>Er zijn nog geen actieve planningskoppelingen.</Empty>
                )}
                <div className="button-row">
                  <a className="button ghost" href="/app/locations">
                    Mijn locaties & reserveringen
                  </a>
                  <a
                    className="button ghost"
                    href={`/app/clubs/${clubId}/banen`}
                  >
                    Verenigingsbanen beheren
                  </a>
                  <a className="button ghost" href="/app/schermen">
                    Mijn Oche Live-schermen
                  </a>
                </div>
              </section>
              <PlanningAccess clubId={clubId} />
            </>
          )}
          {page === "tasks" && (
            <Tasks view={data} actorId={actorId} busy={busy} send={send} />
          )}
          {page === "dues" && (
            <section className="panel">
              <h2>Contributie</h2>
              <Empty>
                Er is nog geen contributieadministratie gekoppeld aan deze
                vereniging.
              </Empty>
            </section>
          )}
          {page === "manage" && (
            <Manage
              view={data}
              actorId={actorId}
              busy={busy}
              send={send}
              legacy={legacy}
            />
          )}
        </>
      )}
      {data.channels.length > 0 && (
        <ClubhouseChat
          clubId={clubId}
          actorId={actorId}
          channels={data.channels}
          canManage={can("channels.manage")}
          teams={data.teams}
        />
      )}
    </div>
  );
}
function TeamEditor({
  team,
  view,
  busy,
  send,
  onDone,
}: {
  team?: ClubTeam;
  view: View;
  busy: boolean;
  send: Send;
  onDone: () => void;
}) {
  return (
    <form
      className="panel ch-form"
      key={team?.id ?? "new"}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (
          await send(
            {
              type: "team.save",
              ...(team ? { id: team.id } : {}),
              name: value(f, "name"),
              captainId: value(f, "captainId"),
              memberIds: checked(f, "members"),
              reserveIds: checked(f, "reserves"),
            },
            team?.revision ?? 0,
          )
        )
          onDone();
      }}
    >
      <h3>{team ? "Team bewerken" : "Nieuw team"}</h3>
      <Field label="Teamnaam" name="name" defaultValue={team?.name} required />
      <label className="field">
        Aanvoerder
        <select name="captainId" defaultValue={team?.captainId ?? ""} required>
          <option value="">Kies een actief lid</option>
          {view.club.members
            .filter((m) => m.status === "active")
            .map((m) => (
              <option value={m.id} key={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
      <MembersSelect
        members={view.club.members}
        name="members"
        label="Vaste spelers (inclusief aanvoerder)"
        selected={team?.memberIds}
      />
      <MembersSelect
        members={view.club.members}
        name="reserves"
        label="Reserves"
        selected={team?.reserveIds}
      />
      <div className="button-row">
        <button className="button gold" disabled={busy}>
          Team opslaan
        </button>
        <button type="button" className="button ghost" onClick={onDone}>
          Annuleren
        </button>
      </div>
    </form>
  );
}
function Teams({
  view,
  busy,
  send,
}: {
  view: View;
  busy: boolean;
  send: Send;
}) {
  const [edit, setEdit] = useState<ClubTeam | null | undefined>(undefined);
  const canManage = view.permissions.includes("teams.manage");
  return (
    <>
      <section className="panel">
        <div className="workspace-row">
          <h2>Verenigingsteams</h2>
          {canManage && (
            <button className="button gold" onClick={() => setEdit(null)}>
              Nieuw team
            </button>
          )}
        </div>
        <div className="ch-card-links">
          {view.teams
            .filter((t) => t.active)
            .map((team) => (
              <article className="panel" key={team.id}>
                <h3>{team.name}</h3>
                <p>
                  Aanvoerder:{" "}
                  {view.club.members.find((m) => m.id === team.captainId)
                    ?.name ?? "Speler"}
                </p>
                <p>
                  {team.memberIds
                    .map(
                      (id) =>
                        view.club.members.find((m) => m.id === id)?.name ??
                        "Speler",
                    )
                    .join(", ")}
                </p>
                <small>{team.reserveIds.length} reserves</small>
                {canManage && (
                  <div className="button-row">
                    <button
                      className="button ghost"
                      onClick={() => setEdit(team)}
                    >
                      Team bewerken
                    </button>
                    <button
                      className="button ghost"
                      disabled={busy}
                      onClick={() =>
                        void send(
                          { type: "team.archive", id: team.id },
                          team.revision,
                        )
                      }
                    >
                      Team archiveren
                    </button>
                  </div>
                )}
              </article>
            ))}
        </div>
        {!view.teams.some((t) => t.active) && (
          <Empty>Er zijn nog geen actieve verenigingsteams.</Empty>
        )}
      </section>
      {edit !== undefined && (
        <TeamEditor
          team={edit ?? undefined}
          view={view}
          busy={busy}
          send={send}
          onDone={() => setEdit(undefined)}
        />
      )}
    </>
  );
}
function Tasks({
  view,
  actorId,
  busy,
  send,
}: {
  view: View;
  actorId: string;
  busy: boolean;
  send: Send;
}) {
  const [filter, setFilter] = useState("open"),
    [edit, setEdit] = useState<ClubTask | null | undefined>(undefined);
  const canManage = view.permissions.includes("tasks.manage"),
    members = view.club.members.filter((m) => m.status === "active");
  return (
    <>
      <section className="panel">
        <div className="workspace-row">
          <h2>Taken & vrijwilligers</h2>
          {canManage && (
            <button className="button gold" onClick={() => setEdit(null)}>
              Nieuwe taak
            </button>
          )}
        </div>
        <label className="field">
          Taken tonen
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="open">Open en bezig</option>
            <option value="all">Alle taken</option>
            <option value="done">Afgerond</option>
          </select>
        </label>
        {view.tasks
          .filter(
            (t) =>
              filter === "all" ||
              (filter === "done" ? t.status === "done" : t.status !== "done"),
          )
          .map((task) => (
            <article className="panel" key={task.id}>
              <div className="workspace-row">
                <h3>{task.title}</h3>
                <span className="ch-status">
                  {task.status === "done"
                    ? "Afgerond"
                    : task.status === "in_progress"
                      ? "Bezig"
                      : "Open"}
                </span>
              </div>
              <p>{task.description}</p>
              {(task.startsAt || task.endsAt || task.function) && (
                <p>
                  {task.function}
                  {task.startsAt
                    ? ` · ${date(task.startsAt)} – ${date(task.endsAt)}`
                    : ""}
                </p>
              )}
              {task.activityId && (
                <p>
                  Bij activiteit:{" "}
                  {view.activities.find((a) => a.id === task.activityId)
                    ?.title ?? "Clubactiviteit"}
                </p>
              )}
              <p>
                {task.deadline
                  ? `Deadline ${date(task.deadline)}`
                  : "Geen vaste deadline"}{" "}
                · Eigenaar:{" "}
                {members.find((m) => m.id === task.ownerId)?.name ??
                  "Niet toegewezen"}
              </p>
              <small>
                {task.volunteerIds.length}/{task.capacity} vrijwilligers:{" "}
                {task.volunteerIds
                  .map(
                    (id) => members.find((m) => m.id === id)?.name ?? "Speler",
                  )
                  .join(", ")}
              </small>
              <div className="button-row">
                {task.status !== "done" && (
                  <button
                    className="button ghost"
                    disabled={
                      busy ||
                      (!task.volunteerIds.includes(actorId) &&
                        task.volunteerIds.length >= task.capacity)
                    }
                    onClick={() =>
                      void send({
                        type: task.volunteerIds.includes(actorId)
                          ? "task.withdraw"
                          : "task.volunteer",
                        id: task.id,
                      })
                    }
                  >
                    {task.volunteerIds.includes(actorId)
                      ? "Afmelden als vrijwilliger"
                      : "Ik help mee"}
                  </button>
                )}
                {(canManage || task.ownerId === actorId) && (
                  <div className="button-row">
                    {task.status !== "in_progress" &&
                      task.status !== "done" && (
                        <button
                          className="button ghost"
                          disabled={busy}
                          onClick={() =>
                            void send(
                              {
                                type: "task.status",
                                id: task.id,
                                status: "in_progress",
                              },
                              task.revision,
                            )
                          }
                        >
                          Taak oppakken
                        </button>
                      )}
                    {task.status !== "done" ? (
                      <button
                        className="button ghost"
                        disabled={busy}
                        onClick={() =>
                          void send(
                            {
                              type: "task.status",
                              id: task.id,
                              status: "done",
                            },
                            task.revision,
                          )
                        }
                      >
                        Taak afronden
                      </button>
                    ) : (
                      <button
                        className="button ghost"
                        disabled={busy}
                        onClick={() =>
                          void send(
                            {
                              type: "task.status",
                              id: task.id,
                              status: "open",
                            },
                            task.revision,
                          )
                        }
                      >
                        Taak heropenen
                      </button>
                    )}
                  </div>
                )}
                {canManage && (
                  <button
                    className="button ghost"
                    onClick={() => setEdit(task)}
                  >
                    Taak bewerken
                  </button>
                )}
              </div>
              {task.privateNote !== undefined && (
                <details>
                  <summary>Beheernotitie & activiteiten</summary>
                  <p>{task.privateNote}</p>
                  {task.activity.map((item, index) => (
                    <p key={index}>
                      {date(item.at)} ·{" "}
                      {members.find((m) => m.id === item.actorId)?.name ??
                        "Beheerder"}{" "}
                      · {item.action}
                    </p>
                  ))}
                </details>
              )}
            </article>
          ))}
        {!view.tasks.length && (
          <Empty>
            Nog geen taken. Zodra er iets te regelen is, verschijnt het hier.
          </Empty>
        )}
      </section>
      {edit !== undefined && (
        <form
          className="panel ch-form"
          key={edit?.id ?? "new"}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await send(
                {
                  type: "task.save",
                  ...(edit ? { id: edit.id } : {}),
                  title: value(f, "title"),
                  description: value(f, "description"),
                  ownerId: value(f, "ownerId") || null,
                  deadline: value(f, "deadline")
                    ? new Date(value(f, "deadline")).toISOString()
                    : null,
                  status: value(f, "status"),
                  capacity: Number(value(f, "capacity")),
                  privateNote: value(f, "privateNote"),
                  startsAt: value(f, "startsAt")
                    ? new Date(value(f, "startsAt")).toISOString()
                    : null,
                  endsAt: value(f, "endsAt")
                    ? new Date(value(f, "endsAt")).toISOString()
                    : null,
                  function: value(f, "function"),
                  activityId: value(f, "activityId") || null,
                },
                edit?.revision ?? 0,
              )
            )
              setEdit(undefined);
          }}
        >
          <h3>{edit ? "Taak bewerken" : "Nieuwe taak"}</h3>
          <Field
            label="Titel"
            name="title"
            defaultValue={edit?.title}
            required
          />
          <Description defaultValue={edit?.description} />
          <label className="field">
            Taakeigenaar
            <select name="ownerId" defaultValue={edit?.ownerId ?? ""}>
              <option value="">Nog niet toegewezen</option>
              {members.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Deadline (tijd van dit toestel)"
            name="deadline"
            type="datetime-local"
            defaultValue={edit?.deadline ? toLocalInput(edit.deadline) : ""}
          />
          <div className="ch-form-grid">
            <Field
              label="Vrijwilligersfunctie"
              name="function"
              defaultValue={edit?.function}
            />
            <Field
              label="Taak begint (tijd van dit toestel)"
              name="startsAt"
              type="datetime-local"
              defaultValue={edit?.startsAt ? toLocalInput(edit.startsAt) : ""}
            />
            <Field
              label="Taak eindigt (tijd van dit toestel)"
              name="endsAt"
              type="datetime-local"
              defaultValue={edit?.endsAt ? toLocalInput(edit.endsAt) : ""}
            />
            <label className="field">
              Gekoppelde activiteit
              <select name="activityId" defaultValue={edit?.activityId ?? ""}>
                <option value="">Geen gekoppelde activiteit</option>
                {view.activities.map((activity) => (
                  <option value={activity.id} key={activity.id}>
                    {activity.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Field
            label="Aantal vrijwilligers"
            name="capacity"
            type="number"
            defaultValue={edit?.capacity ?? 1}
          />
          <label className="field">
            Status
            <select name="status" defaultValue={edit?.status ?? "open"}>
              <option value="open">Open</option>
              <option value="in_progress">Bezig</option>
              <option value="done">Afgerond</option>
            </select>
          </label>
          <label className="field">
            Privé beheernotitie
            <textarea
              name="privateNote"
              defaultValue={edit?.privateNote ?? ""}
            />
          </label>
          <div className="button-row">
            <button className="button gold" disabled={busy}>
              Taak opslaan
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => setEdit(undefined)}
            >
              Annuleren
            </button>
          </div>
        </form>
      )}
    </>
  );
}
function toLocalInput(instant: string) {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function Calendar({
  view,
  busy,
  send,
  clubId,
}: {
  view: View;
  busy: boolean;
  send: Send;
  clubId: string;
}) {
  const [month, setMonth] = useState(() => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), 1);
    }),
    [selected, setSelected] = useState<ClubActivity | null>(null),
    [edit, setEdit] = useState<ClubActivity | null | undefined>(undefined),
    [feed, setFeed] = useState<{ url: string; expiresAt: string } | null>(null),
    [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const requestedActivity = useRef("");
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("activiteit");
    if (!id || requestedActivity.current === id) return;
    requestedActivity.current = id;
    const activity = view.activities.find((item) => item.id === id);
    if (activity) {
      setSelected(activity);
      const d = new Date(activity.startsAt);
      setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    } else
      setError("Deze activiteit is niet beschikbaar binnen deze vereniging.");
  }, [view.activities]);
  const canManage = view.permissions.includes("calendar.manage"),
    first = new Date(month),
    start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
  const activities = view.activities.filter(
    (a) =>
      new Date(a.startsAt)
        .toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" })
        .slice(0, 7) ===
      `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
  );
  const subscribe = async (revoke = false) => {
    try {
      const result = await api<{ url?: string; expiresAt?: string }>(
        `/api/clubhouse/${clubId}/calendar-feed`,
        { revoke },
      );
      setFeed(
        result.url && result.expiresAt
          ? { url: result.url, expiresAt: result.expiresAt }
          : null,
      );
      setError("");
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <>
      <section className="panel">
        <div className="workspace-row">
          <h2>Clubagenda</h2>
          {canManage && (
            <button className="button gold" onClick={() => setEdit(null)}>
              Activiteit toevoegen
            </button>
          )}
        </div>
        <div className="ch-month-nav">
          <button
            className="button ghost"
            aria-label="Vorige maand"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            ←
          </button>
          <h3>
            {month.toLocaleDateString("nl-NL", {
              month: "long",
              year: "numeric",
            })}
          </h3>
          <button
            className="button ghost"
            aria-label="Volgende maand"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            →
          </button>
        </div>
        <div className="ch-calendar" aria-label="Maandoverzicht">
          {["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"].map((day) => (
            <div className="ch-calendar-label" key={day}>
              {day}
            </div>
          ))}
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={`ch-calendar-day ${day.getMonth() !== month.getMonth() ? "is-outside" : ""}`}
            >
              <time dateTime={day.toLocaleDateString("en-CA")}>
                {day.getDate()}
              </time>
              {view.activities
                .filter(
                  (a) =>
                    localDate(a.startsAt) === day.toLocaleDateString("en-CA"),
                )
                .map((activity) => (
                  <button
                    key={activity.id}
                    onClick={() => setSelected(activity)}
                  >
                    {activity.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
        <div className="ch-list">
          {activities.map((activity) => (
            <div className="ch-list-item" key={activity.id}>
              <div>
                <strong>{activity.title}</strong>
                <p>
                  {date(activity.startsAt)} ·{" "}
                  {activity.location || "Locatie volgt"}
                </p>
                <small>
                  {activity.registered}/{activity.capacity} deelnemers
                  {activity.waitlisted
                    ? ` · ${activity.waitlisted} op de wachtlijst`
                    : ""}
                </small>
              </div>
              <button
                className="button ghost"
                onClick={() => setSelected(activity)}
              >
                Details & aanmelden
              </button>
            </div>
          ))}
        </div>
        {!activities.length && (
          <Empty>Deze maand staan er geen clubactiviteiten gepland.</Empty>
        )}
        <p>
          Beschikbaarheid voor een teamwedstrijd regel je bij de betreffende
          ontmoeting, los van deze activiteiteninschrijving.
        </p>
        <details>
          <summary>Agenda exporteren of volgen</summary>
          <p>
            Een download is een momentopname. Een persoonlijke feed blijft
            vernieuwen totdat je de koppeling intrekt.
          </p>
          <a
            className="button ghost"
            href={`/api/clubhouse/${clubId}/calendar.ics`}
            download
          >
            Eenmalige ICS downloaden
          </a>
          <button className="button ghost" onClick={() => void subscribe()}>
            Persoonlijke agendafeed maken
          </button>
          {feed && (
            <div>
              <label className="field">
                Privé agendafeed
                <input
                  readOnly
                  value={feed.url}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
              <p>
                Behandel deze koppeling als privé. Geldig tot{" "}
                {date(feed.expiresAt)}.
              </p>
            </div>
          )}
          <button className="button ghost" onClick={() => void subscribe(true)}>
            Mijn eerdere agendafeeds intrekken
          </button>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
        </details>
      </section>
      {selected && (
        <section className="panel" aria-label="Activiteitdetails">
          <div className="workspace-row">
            <h2>{selected.title}</h2>
            <button className="button ghost" onClick={() => setSelected(null)}>
              Details sluiten
            </button>
          </div>
          <p>{selected.description}</p>
          <p>
            Activiteit:{" "}
            {(
              {
                club: "Clubavond",
                training: "Training",
                match: "Wedstrijd",
                social: "Sociaal",
                meeting: "Vergadering",
                other: "Anders",
              } as Record<string, string>
            )[selected.type] ?? selected.type}
          </p>
          {selected.lastChange && (
            <p className="notice">
              Laatste wijziging: {selected.lastChange} ·{" "}
              {date(selected.updatedAt)}
            </p>
          )}
          <p>
            {date(selected.startsAt)} – {date(selected.endsAt)} ·{" "}
            {selected.timeZone}
          </p>
          <p>
            {selected.location || "Locatie volgt"} · Organisator:{" "}
            {selected.organizerName || view.club.name}
          </p>
          <p>
            {selected.registered}/{selected.capacity} deelnemers ·{" "}
            {selected.waitlisted} op de wachtlijst
          </p>
          <p>
            {selected.myStatus === "registered"
              ? "Je bent aangemeld."
              : selected.myStatus === "waitlisted"
                ? "Je staat op de wachtlijst."
                : ""}
          </p>
          {Date.parse(selected.startsAt) > now && (
            <button
              className="button gold"
              disabled={busy}
              onClick={async () => {
                if (
                  await send({
                    type: selected.myStatus
                      ? "activity.leave"
                      : "activity.join",
                    id: selected.id,
                  })
                )
                  setSelected(null);
              }}
            >
              {selected.myStatus
                ? "Afmelden"
                : selected.registered >= selected.capacity
                  ? "Op de wachtlijst"
                  : "Aanmelden"}
            </button>
          )}
          {selected.canManage && (
            <button
              className="button ghost"
              onClick={() => {
                setEdit(selected);
                setSelected(null);
              }}
            >
              Activiteit bewerken
            </button>
          )}
          <details>
            <summary>Deelnemers</summary>
            {selected.participants.map((p) => (
              <p key={p.userId}>
                {p.name} ·{" "}
                {p.status === "waitlisted" ? "Wachtlijst" : "Aangemeld"}
              </p>
            ))}
          </details>
        </section>
      )}
      {edit !== undefined && (
        <form
          className="panel ch-form"
          key={edit?.id ?? "new"}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              await send(
                {
                  type: "activity.save",
                  ...(edit ? { id: edit.id } : {}),
                  title: value(f, "title"),
                  description: value(f, "description"),
                  startsAt: new Date(value(f, "startsAt")).toISOString(),
                  endsAt: new Date(value(f, "endsAt")).toISOString(),
                  timeZone: value(f, "timeZone"),
                  capacity: Number(value(f, "capacity")),
                  location: value(f, "location"),
                  organizerName: value(f, "organizerName"),
                  organizerId: value(f, "organizerId") || null,
                  activityType: value(f, "activityType"),
                  lastChange: value(f, "lastChange"),
                },
                edit?.revision ?? 0,
              )
            )
              setEdit(undefined);
          }}
        >
          <h3>{edit ? "Activiteit bewerken" : "Nieuwe activiteit"}</h3>
          <Field
            label="Titel"
            name="title"
            required
            defaultValue={edit?.title}
          />
          <Description defaultValue={edit?.description} />
          <label className="field">
            Soort activiteit
            <select name="activityType" defaultValue={edit?.type ?? "club"}>
              {[
                ["club", "Clubavond"],
                ["training", "Training"],
                ["match", "Wedstrijd"],
                ["social", "Sociaal"],
                ["meeting", "Vergadering"],
                ["other", "Anders"],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Verantwoordelijk lid
            <select name="organizerId" defaultValue={edit?.organizerId ?? ""}>
              <option value="">Nog niet toegewezen</option>
              {view.club.members
                .filter((m) => m.status === "active")
                .map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>
          {edit && (
            <label className="field">
              Wijzigingsnotitie voor deelnemers
              <input
                name="lastChange"
                maxLength={1000}
                required
                placeholder="Wat is er veranderd?"
              />
            </label>
          )}
          <div className="ch-form-grid">
            <Field
              label="Begint (tijd van dit toestel)"
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={edit ? toLocalInput(edit.startsAt) : ""}
            />
            <Field
              label="Eindigt (tijd van dit toestel)"
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={edit ? toLocalInput(edit.endsAt) : ""}
            />
            <Field
              label="Tijdzone voor weergave"
              name="timeZone"
              defaultValue={edit?.timeZone ?? "Europe/Amsterdam"}
              required
            />
            <Field
              label="Capaciteit"
              name="capacity"
              type="number"
              defaultValue={edit?.capacity ?? 20}
              required
            />
            <Field
              label="Locatie"
              name="location"
              defaultValue={edit?.location}
            />
            <Field
              label="Organisator"
              name="organizerName"
              defaultValue={edit?.organizerName ?? view.club.name}
            />
          </div>
          <div className="button-row">
            <button className="button gold" disabled={busy}>
              Activiteit opslaan
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => setEdit(undefined)}
            >
              Annuleren
            </button>
          </div>
        </form>
      )}
    </>
  );
}
function MemberActions({
  view,
  actorId,
  busy,
  send,
}: {
  view: View;
  actorId: string;
  busy: boolean;
  send: Send;
}) {
  const [search, setSearch] = useState("");
  return (
    <section className="panel">
      <h2>Ledenoverzicht</h2>
      <label className="field">
        Leden zoeken
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Publieke naam of gebruikersnaam"
        />
      </label>
      {view.club.members
        .filter((m) =>
          m.name
            .toLocaleLowerCase("nl")
            .includes(search.toLocaleLowerCase("nl")),
        )
        .map((member) => (
          <div className="ch-list-item" key={member.id}>
            <div>
              <strong>{member.name}</strong>
              <small>
                {(
                  {
                    active: "Actief",
                    pending: "In behandeling",
                    invited: "Uitgenodigd",
                    banned: "Geschorst",
                    left: "Vertrokken",
                  } as Record<string, string>
                )[member.status] ?? member.status}
              </small>
            </div>
            {view.permissions.includes("members.manage") &&
              member.id !== actorId &&
              member.id !== view.club.ownerId &&
              (member.role === "member" || view.club.clubAccess.isOwner) && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void send({
                      type: value(f, "action"),
                      userId: member.id,
                      reason: value(f, "reason"),
                    });
                  }}
                >
                  <label className="field">
                    Lidmaatschapsactie
                    <select name="action">
                      <option value="member.suspend">Schorsen</option>
                      <option value="member.restore">Herstellen</option>
                      <option value="member.remove">Verwijderen</option>
                    </select>
                  </label>
                  <label className="field">
                    Reden
                    <input name="reason" required maxLength={1000} />
                  </label>
                  <button className="button ghost" disabled={busy}>
                    Uitvoeren
                  </button>
                </form>
              )}
          </div>
        ))}
    </section>
  );
}
function Ownership({
  view,
  actorId,
  busy,
  send,
}: {
  view: View;
  actorId: string;
  busy: boolean;
  send: Send;
}) {
  const offer = view.ownershipTransfer;
  return (
    <section className="panel">
      <h2>Eigendom van de vereniging</h2>
      <p>
        Een overdracht wordt pas definitief als het geselecteerde actieve lid
        deze aanvaardt. Je eigen rechten veranderen pas op dat moment.
      </p>
      {offer && (
        <div className="notice">
          <p>
            Openstaande overdracht aan{" "}
            {view.club.members.find((m) => m.id === offer.recipientId)?.name ??
              "een actief lid"}
            , geldig tot {date(offer.expiresAt)}.
          </p>
          {offer.recipientId === actorId && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send({ type: "ownership.accept", transferId: offer.id });
              }}
            >
              <label className="check">
                <input type="checkbox" required />
                Ik aanvaard de verantwoordelijkheid en het exclusieve eigendom.
              </label>
              <button className="button gold" disabled={busy}>
                Eigendom aanvaarden
              </button>
            </form>
          )}
          {view.club.clubAccess.isOwner && (
            <button
              className="button ghost"
              disabled={busy}
              onClick={() => void send({ type: "ownership.cancel" })}
            >
              Overdracht intrekken
            </button>
          )}
        </div>
      )}
      {view.club.clubAccess.isOwner && !offer && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send({
              type: "ownership.offer",
              recipientId: value(new FormData(e.currentTarget), "recipientId"),
            });
          }}
        >
          <label className="field">
            Eigendom aanbieden aan
            <select name="recipientId" required defaultValue="">
              <option value="">Kies een actief lid</option>
              {view.club.members
                .filter((m) => m.status === "active" && m.id !== actorId)
                .map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>
          <button className="button ghost" disabled={busy}>
            Overdracht aanbieden
          </button>
        </form>
      )}
    </section>
  );
}
function Branding({
  branding,
  clubName,
  busy,
  send,
}: {
  branding: ClubBranding;
  clubName: string;
  busy: boolean;
  send: Send;
}) {
  const [design, setDesign] = useState<BrandingDesign>(
      () =>
        branding.draft ??
        branding.published ?? {
          name: clubName,
          primary: "#C7F36A",
          secondary: "#72B5A0",
          logoData: null,
        },
    ),
    [mode, setMode] = useState<"dark" | "light">("dark"),
    [error, setError] = useState("");
  let tokens;
  try {
    tokens = deriveThemeTokens(design, mode === "dark");
  } catch {
    tokens = deriveThemeTokens(
      { primary: "#C7F36A", secondary: "#72B5A0" },
      mode === "dark",
    );
  }
  const previewStyle = {
    "--preview-bg": tokens.background,
    "--preview-text": tokens.text,
    "--preview-border": tokens.border,
    "--preview-primary": tokens.primary,
    "--preview-ink": tokens.onPrimary,
  } as CSSProperties;
  const changed = JSON.stringify(design) !== JSON.stringify(branding.draft);
  return (
    <section className="panel">
      <h2>Clubhuisstijl</h2>
      <p>
        {branding.entitlement?.effective
          ? `Premium is actief tot ${date(branding.entitlement.endsAt)}.`
          : "Een actief premiumrecht is nodig om de huisstijl te publiceren. Een ontwerp kun je alvast bewaren."}
      </p>
      <p>
        {branding.published
          ? `Gepubliceerd: ${branding.published.name} · versie ${branding.publishedRevision}`
          : "Er is nog geen gepubliceerde huisstijl."}
      </p>
      <div className="ch-grid">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await send({ type: "branding.save", design }, branding.revision)
            )
              setError("");
          }}
        >
          <label className="field">
            Naam huisstijl
            <input
              value={design.name}
              maxLength={80}
              required
              onChange={(e) => setDesign({ ...design, name: e.target.value })}
            />
          </label>
          <div className="ch-form-grid">
            <label className="field">
              Primaire kleur
              <input
                type="color"
                value={design.primary}
                onChange={(e) =>
                  setDesign({ ...design, primary: e.target.value })
                }
              />
            </label>
            <label className="field">
              Secundaire kleur
              <input
                type="color"
                value={design.secondary}
                onChange={(e) =>
                  setDesign({ ...design, secondary: e.target.value })
                }
              />
            </label>
          </div>
          <label className="field">
            Logo (PNG, JPEG of WebP, maximaal 96 kB)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 96 * 1024) {
                  setError("Het logo is groter dan 96 kB.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setDesign({ ...design, logoData: String(reader.result) });
                  setError("");
                };
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {design.logoData && (
            <button
              type="button"
              className="button ghost"
              onClick={() => setDesign({ ...design, logoData: null })}
            >
              Logo uit ontwerp verwijderen
            </button>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button
            className="button gold"
            disabled={busy || !branding.canManage}
          >
            Ontwerp opslaan
          </button>
        </form>
        <div>
          <label className="field">
            Lokale voorvertoning
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "light" | "dark")}
            >
              <option value="dark">Donker</option>
              <option value="light">Licht</option>
            </select>
          </label>
          <div className="ch-theme-preview" style={previewStyle}>
            {design.logoData && (
              <img
                className="ch-logo-preview"
                src={design.logoData}
                alt="Voorvertoning logo"
              />
            )}
            <h3>{design.name}</h3>
            <p>Jouw club. Jouw thuisbasis.</p>
            <button type="button">Voorbeeld van een actie</button>
            <p>Alleen deze voorvertoning gebruikt je onopgeslagen ontwerp.</p>
          </div>
        </div>
      </div>
      <p>
        Publiceren past de gevalideerde stijl toe op de vereniging en de
        persoonlijke omgeving van leden die deze club kiezen. Een gedeeld Oche
        Live-scherm behoudt zijn schermstijl.
      </p>
      <button
        className="button gold"
        disabled={
          busy ||
          changed ||
          !branding.draft ||
          !branding.canManage ||
          !branding.entitlement?.effective
        }
        onClick={() =>
          void send({ type: "branding.publish" }, branding.revision)
        }
      >
        Opgeslagen huisstijl publiceren
      </button>
      {changed && <p>Sla het ontwerp eerst op voordat je publiceert.</p>}
    </section>
  );
}
function Manage({
  view,
  actorId,
  busy,
  send,
  legacy,
}: {
  view: View;
  actorId: string;
  busy: boolean;
  send: Send;
  legacy: (tab: string) => ReactNode;
}) {
  return (
    <>
      {view.branding && (
        <Branding
          key={view.branding.revision}
          branding={view.branding}
          clubName={view.club.name}
          busy={busy}
          send={send}
        />
      )}
      <Ownership view={view} actorId={actorId} busy={busy} send={send} />
      {view.permissions.includes("chat.moderate") && (
        <ModerationReports view={view} busy={busy} send={send} />
      )}
      {view.club.clubAccess.canManageRoles && legacy("rollen")}
      {view.club.clubAccess.canEditSettings && legacy("instellingen")}
      <section className="panel">
        <ThemePreferencePicker />
      </section>
    </>
  );
}
export function PlatformBrandingAdministration() {
  const [clubs, setClubs] = useState<
      { id: string; name: string; branding: ClubBranding }[] | null
    >(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setClubs(
        (
          await api<{
            clubs: { id: string; name: string; branding: ClubBranding }[];
          }>("/api/theme/admin")
        ).clubs,
      );
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const send = async (clubId: string, type: string, f?: FormData) => {
    setBusy(true);
    try {
      await api("/api/clubhouse/actions", {
        requestId: crypto.randomUUID(),
        action: {
          type,
          clubId,
          ...(f
            ? {
                startsAt: new Date(value(f, "startsAt")).toISOString(),
                endsAt: new Date(value(f, "endsAt")).toISOString(),
              }
            : {}),
        },
      });
      await load();
      setError("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h2>Premiumrechten beheren</h2>
      <p>
        Dit beheer registreert alleen de effectieve periode van een recht. Het
        start geen betaling of abonnement.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {clubs?.map((club) => (
        <details className="panel" key={club.id}>
          <summary>
            {club.name} ·{" "}
            {club.branding.entitlement?.effective ? "Actief" : "Niet actief"}
          </summary>
          {club.branding.entitlement && (
            <p>
              {date(club.branding.entitlement.startsAt)} –{" "}
              {date(club.branding.entitlement.endsAt)}
              {club.branding.entitlement.revokedAt ? " · Ingetrokken" : ""}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(
                club.id,
                "entitlement.grant",
                new FormData(e.currentTarget),
              );
            }}
          >
            <Field
              label="Begint (tijd van dit toestel)"
              name="startsAt"
              type="datetime-local"
              required
            />
            <Field
              label="Eindigt (tijd van dit toestel)"
              name="endsAt"
              type="datetime-local"
              required
            />
            <button className="button gold" disabled={busy}>
              Premiumperiode toekennen
            </button>
          </form>
          {club.branding.entitlement?.effective && (
            <button
              className="button ghost"
              disabled={busy}
              onClick={() => void send(club.id, "entitlement.revoke")}
            >
              Recht intrekken
            </button>
          )}
        </details>
      ))}
    </section>
  );
}
function PlanningAccess({ clubId }: { clubId: string }) {
  const [context, setContext] = useState<
      import("@/lib/competition-wizard-types").CompetitionWizardContext | null
    >(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setContext(await api(`/api/competition-wizard/${clubId}`));
    } catch {
      /* No planning-management access does not hide the club's readable locations. */
    }
  }, [clubId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (
    !context ||
    (!context.managedLocations.length &&
      !context.grants.some((g) => g.canManage))
  )
    return null;
  return (
    <section className="panel">
      <h2>Planningsrechten toekennen</h2>
      <p>
        Als locatiebeheerder bepaal je welke eigen banen deze vereniging mag
        inplannen. Dit geeft geen fysiek baan- of locatiebeheer.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {context.managedLocations.map((location) => (
        <form
          className="panel"
          key={location.id}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const f = new FormData(e.currentTarget);
            try {
              const existing = context.grants.find(
                (g) => g.locationId === location.id && g.status === "active",
              );
              await api("/api/competition-wizard", {
                requestId: crypto.randomUUID(),
                action: {
                  type: "planning.grant",
                  clubId,
                  locationId: location.id,
                  expectedRevision: existing?.revision ?? 0,
                  boardIds: checked(f, "boardIds"),
                  windows: [
                    {
                      weekday: Number(value(f, "weekday")),
                      startTime: value(f, "startTime"),
                      endTime: value(f, "endTime"),
                    },
                  ],
                  reason: value(f, "reason"),
                },
              });
              await load();
              setError("");
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>{location.name}</h3>
          {location.boards
            .filter((b) => b.active)
            .map((board) => (
              <label className="check" key={board.id}>
                <input type="checkbox" name="boardIds" value={board.id} />
                {board.name}
              </label>
            ))}
          <div className="ch-form-grid">
            <label className="field">
              Weekdag
              <select name="weekday" defaultValue={5}>
                {[
                  "Zondag",
                  "Maandag",
                  "Dinsdag",
                  "Woensdag",
                  "Donderdag",
                  "Vrijdag",
                  "Zaterdag",
                ].map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Vanaf"
              name="startTime"
              type="time"
              defaultValue="19:00"
              required
            />
            <Field
              label="Tot"
              name="endTime"
              type="time"
              defaultValue="23:00"
              required
            />
            <Field label="Reden / afspraak" name="reason" required />
          </div>
          <button className="button gold" disabled={busy}>
            Planningskoppeling opslaan
          </button>
        </form>
      ))}
      {context.grants
        .filter((g) => g.canManage && g.status === "active")
        .map((grant) => (
          <form
            key={grant.id}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/api/competition-wizard", {
                  requestId: crypto.randomUUID(),
                  action: {
                    type: "planning.revoke",
                    id: grant.id,
                    expectedRevision: grant.revision,
                    reason: value(new FormData(e.currentTarget), "reason"),
                  },
                });
                await load();
                setError("");
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              {grant.boardIds.length} banen gekoppeld · versie {grant.revision}
            </p>
            <Field label="Reden intrekken" name="reason" required />
            <button className="button ghost" disabled={busy}>
              Planningskoppeling intrekken
            </button>
          </form>
        ))}
    </section>
  );
}
function ClubhouseFeedSummary({
  feed,
  href,
}: {
  feed: View["feed"];
  href: string;
}) {
  const posts = (feed?.posts ?? []).slice(0, 3);
  return (
    <section className="panel">
      <div className="workspace-row">
        <h2>Uit het clubhuis</h2>
        <a href={href}>Naar de feed ↗</a>
      </div>
      {posts.map((post) => (
        <a
          className="ch-list-item"
          key={post.id}
          href={`${href}?post=${encodeURIComponent(post.id)}`}
        >
          <div>
            <strong>{post.authorName}</strong>
            <small>{date(post.createdAt)}</small>
            <p>{post.body.slice(0, 220)}</p>
            <small>
              {post.likes} reacties met een hartje · {post.replyCount}{" "}
              antwoorden
            </small>
          </div>
          <span aria-hidden="true">›</span>
        </a>
      ))}
      {!posts.length && (
        <Empty>Er staan nog geen berichten in de verenigingsfeed.</Empty>
      )}
      <a className="button ghost" href={href}>
        Open verenigingsfeed
      </a>
    </section>
  );
}

function ModerationReports({
  view,
  busy,
  send,
}: {
  view: View;
  busy: boolean;
  send: Send;
}) {
  return (
    <section className="panel">
      <h2>Meldingen beoordelen</h2>
      <p>
        Beoordeel de inhoud en leg een reden vast. Meldingen over jezelf blijven
        buiten dit overzicht.
      </p>
      {!(view.reports ?? []).length && (
        <Empty>Er zijn geen meldingen om te beoordelen.</Empty>
      )}
      {(view.reports ?? []).map((report) => (
        <article className="panel" key={report.id}>
          <h3>
            {report.category} · {report.status}
          </h3>
          <p>{report.reason}</p>
          <small>
            Gemeld door {report.reporterName} · {date(report.createdAt)}
          </small>
          {report.decision && <p>Besluit: {report.decision}</p>}
          {report.status !== "resolved" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const f = new FormData(event.currentTarget);
                void send({
                  type: "report.resolve",
                  reportId: report.id,
                  operation: value(f, "operation"),
                  reason: value(f, "reason"),
                });
              }}
            >
              <label className="field">
                Besluit
                <select name="operation">
                  <option value="no-action">Geen maatregel</option>
                  <option value="warn">Waarschuwing</option>
                  {report.contentId && (
                    <option value="remove-content">Inhoud verwijderen</option>
                  )}
                </select>
              </label>
              <label className="field">
                Reden van het besluit
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={1000}
                />
              </label>
              <button className="button" disabled={busy}>
                Besluit vastleggen
              </button>
            </form>
          )}
        </article>
      ))}
    </section>
  );
}
