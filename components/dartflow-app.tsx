"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import PlatformWorkspace from "./platform-workspace";
import ScoreConsole from "./score-console";
import {InstallDartflow} from "./pwa-install";
import SprintDisplay from "./sprint-display";
import OcheCelebration, {useOcheCelebration} from "./oche-celebration";
import ClubBoardScreen from "./club-board-screen";
import PublicCast from "./public-cast";
import ReadOnlyAlias from "./read-only-alias";
import { MediaRoom } from "./media-room";
import {ScopedChat} from "./community-space";
import OfflineReplayPanel from "./offline-replay-panel";
import WorkspaceTools from "./workspace-tools";
import type {
  BoardView,
  EventView,
  MatchAction,
  MatchView,
  Overview,
  Profile,
  PublicSnapshot,
  ResultView,
} from "../lib/types";
import {requiresDisplayName,validDisplayName} from "../lib/display-name";
import BoardActivityNotice from './board-activity-notice';
import {safeNext} from "../lib/config";

type Session = {
  user: Profile | null;
  local: boolean;
  localUsers?: Profile[];
  environment?: string;
  canManagePlatform?: boolean;
  requiresDisplayName?: boolean;
};
type IconName =
  | "home"
  | "target"
  | "calendar"
  | "sliders"
  | "club"
  | "history"
  | "arrow"
  | "chevron"
  | "menu"
  | "close"
  | "check"
  | "logout"
  | "screen"
  | "qr"
  | "refresh"
  | "users"
  | "shield"
  | "bolt";
const labels: Record<string, string> = {
  planned: "Gepland",
  interrupted: "Onderbroken",
  abandoned: "Verlopen",
  called: "Opgeroepen",
  ready: "Gereed",
  live: "Live",
  result: "Uitslag bevestigen",
  confirmed: "Bevestigd",
  disputed: "In beoordeling",
};
const actionLabels: Record<string, string> = {
  score: "Score",
  undo: "Correctie",
  "take-over": "Schrijver overnemen",
  accept: "Deelname bevestigen",
  confirm: "Uitslag bevestigen",
  start: "Wedstrijd starten",
  call: "Baan oproepen",
  dispute: "Uitslag betwisten",
  resolve: "Beoordeling",
  release: "Baan vrijgeven",
  recover: "Uitslag herstellen",
};

function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
        <path d="m13 11 8-8m-4 0h4v4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4m10-4v4M3 11h18M7 15h2m4 0h2m-8 3h2" />
      </>
    ),
    sliders: (
      <>
        <path d="M4 5h16M4 12h16M4 19h16" />
        <circle cx="9" cy="5" r="2" />
        <circle cx="16" cy="12" r="2" />
        <circle cx="8" cy="19" r="2" />
      </>
    ),
    club: (
      <>
        <path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M9 9h.01M15 9h.01" />
      </>
    ),
    history: (
      <>
        <path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    menu: <path d="M3 6h18M3 12h18M3 18h18" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    logout: (
      <>
        <path d="M9 4H4v16h5m4-4 4-4-4-4m-5 4h13" />
      </>
    ),
    screen: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M12 17v4m-5 0h10" />
      </>
    ),
    qr: (
      <>
        <path d="M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h2v2h-2zm4 0h2v6h-6v-2m-4-8v2m4-2h6M3 12h6" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7a9 9 0 0 0-15-1L3 9m0-6v6h6m-5 8a9 9 0 0 0 15 1l2-3m0 6v-6h-6" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7Z" />,
  };
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function Badge({
  children,
  live = false,
  muted = false,
}: {
  children: ReactNode;
  live?: boolean;
  muted?: boolean;
}) {
  return (
    <span className={`badge ${live ? "live" : ""} ${muted ? "muted" : ""}`}>
      {live && <i />}
      {children}
    </span>
  );
}
function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar">
      {name
        .split(" ")
        .map((v) => v[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}
function Empty({
  title,
  children,
  icon = "target",
}: {
  title: string;
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function hardNavigate(path: string) {
  window.location.assign(new URL(path, window.location.origin).href);
}
function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error: unknown }).error;
    return typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : fallback;
  }
  return fallback;
}
async function request<T>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      messageFrom(
        result,
        "Dit kon niet worden uitgevoerd. Probeer het opnieuw.",
      ),
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return result as T;
}
function latestRevision<T>(previous: T | null, incoming: T): T {
  if (
    previous &&
    incoming &&
    typeof previous === "object" &&
    typeof incoming === "object"
  ) {
    const before = previous as Record<string, unknown>,
      after = incoming as Record<string, unknown>;
    if (
      typeof before.id === "string" &&
      before.id === after.id &&
      typeof before.revision === "number" &&
      typeof after.revision === "number" &&
      after.revision < before.revision
    )
      return previous;
  }
  return incoming;
}
function usePolled<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<number>(0);
  const [online, setOnline] = useState(true);
  const busy = useRef(false);
  const currentUrl = useRef(url);
  currentUrl.current = url;
  const accept = useCallback((incoming: T) => {
    setData((previous) => latestRevision(previous, incoming));
    setError("");
    setUpdated(Date.now());
  }, []);
  const refresh = useCallback(async () => {
    if (!url || busy.current) return;
    busy.current = true;
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      if (!response.ok) {
        if (
          currentUrl.current === url &&
          [401, 403, 404, 410].includes(response.status)
        )
          setData(null);
        throw new Error(
          messageFrom(result, "De gegevens zijn niet beschikbaar."),
        );
      }
      if (currentUrl.current !== url) return;
      setData((previous) => latestRevision(previous, result as T));
      setError("");
      setUpdated(Date.now());
    } catch (e) {
      if (currentUrl.current === url)
        setError(e instanceof Error ? e.message : "Verbinding verbroken.");
    } finally {
      busy.current = false;
    }
  }, [url]);
  useEffect(() => {
    setData(null);
    setUpdated(0);
    setError("");
    void refresh();
    const wake = () => {
      setOnline(navigator.onLine);
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(
      wake,
      url?.startsWith("/api/matches/") || url?.startsWith("/api/screen/")
        ? 700
        : 2000,
    );
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    setOnline(navigator.onLine);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh, url]);
  return {
    data,
    error,
    updated,
    online,
    refresh,
    accept,
    stale: !online || Boolean(error),
  };
}
function Connection({ stale, updated }: { stale: boolean; updated: number }) {
  return (
    <span className={`connection ${stale ? "offline" : ""}`} role="status">
      <i />
      {stale
        ? "Verbinding verbroken · laatste stand"
        : updated
          ? "Live verbonden"
          : "Verbinden…"}
    </span>
  );
}
function QR({ path, label }: { path: string; label: string }) {
  const [src, setSrc] = useState("");
  const [absolute, setAbsolute] = useState("");
  useEffect(() => {
    let cancelled = false;
    const url = new URL(path, window.location.origin).href;
    setAbsolute(url);
    import("qrcode")
      .then((module) =>
        module.toDataURL(url, {
          width: 240,
          margin: 2,
          color: { dark: "#151312", light: "#fffaf0" },
          errorCorrectionLevel: "M",
        }),
      )
      .then((value) => {
        if (!cancelled) setSrc(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [path]);
  return (
    <div className="qr-block">
      {src ? (
        <img
          className="qr-image"
          src={src}
          alt={`QR-code: ${label}`}
          width="144"
          height="144"
        />
      ) : (
        <div className="qr-placeholder">
          <Icon name="qr" />
        </div>
      )}
      <div>
        <strong>{label}</strong>
        <p>Scan met de camera van je telefoon.</p>
        <a className="text-link" href={absolute || path}>
          {label} openen <Icon name="arrow" />
        </a>
      </div>
    </div>
  );
}

export default function DartflowApp() {
  const [path, setPath] = useState("");
  const [clubId, setClubId] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const session = usePolled<Session>(
    path && !path.startsWith("/scherm/") && !path.startsWith("/cast/") && !path.startsWith("/baanscherm/")
      ? "/api/session"
      : null,
  );
  useEffect(() => {
    setPath(window.location.pathname);
    setClubId(localStorage.getItem("dartflow-club") || "");
  }, []);
  const overview = usePolled<Overview>(
    session.data?.user && !session.data.requiresDisplayName && path !== "/inloggen"
      ? `/api/overview${clubId ? `?clubId=${encodeURIComponent(clubId)}` : ""}`
      : null,
  );
  if (!path)
    return (
      <div className="app-loading">
        <img src="/assets/dartflow-logo.svg" alt="Dartflow" />
        <p>Je speelomgeving openen…</p>
      </div>
    );
  if (path.startsWith("/cast/"))
    return <PublicCast token={path.split("/")[2]} />;
  if (path.startsWith("/scherm/"))
    return <PublicScreen token={path.split("/")[2]} />;
  if (path.startsWith("/baanscherm/"))
    return <ClubBoardScreen boardId={path.split("/")[2]} />;
  const readOnlyAlias = path.match(/^\/app\/(spectator|overlay)\/([^/]+)$/);
  if (readOnlyAlias)
    return (
      <ReadOnlyAlias
        id={readOnlyAlias[2]}
        overlay={readOnlyAlias[1] === "overlay"}
      />
    );
  if (session.data?.user && (session.data.requiresDisplayName || requiresDisplayName(session.data.user)))
    return <CompleteProfile user={session.data.user} />;
  if (path === "/inloggen") return <Login session={session.data} />;
  if (!session.data && !session.error)
    return (
      <div className="app-loading">
        <img src="/assets/dartflow-logo.svg" alt="Dartflow" />
        <p>Je speelomgeving openen…</p>
      </div>
    );
  if (!session.data?.user)
    return (
      <div className="auth-page">
        <div className="auth-brand">
          <img src="/assets/dartflow-logo.svg" alt="Dartflow" />
          <p>SPEEL. ONTMOET. COMPETEER.</p>
        </div>
        <div className="auth-card">
          <Badge>WELKOM</Badge>
          <h1>Welkom bij DartFlow.</h1>
          <p>{path.startsWith("/baan/") ? "Registreer of meld je aan met je eigen DartFlow-account om op deze baan te spelen." : "Log in om jouw speeldag, wedstrijden en vereniging te openen."}</p>
          {session.error && <div className="notice error">{session.error}</div>}
          <a
            className="button gold full"
            href={`/inloggen?next=${encodeURIComponent(safeNext(path+window.location.search))}`}
          >
            {path.startsWith("/baan/") ? "Registreren of aanmelden" : "Inloggen"} <Icon name="arrow" />
          </a>
        </div>
      </div>
    );
  const user = session.data.user;
  if(path.startsWith('/w/'))return <ShortInvitation code={path.split('/')[2]||''} />;
  const data = overview.data;
  const scorerOverview: Overview = data || {
    profile: user,
    clubs: [],
    currentClub: null,
    events: [],
    matches: [],
    boards: [],
    participants: [],
    history: [],
    standings: [],
    permissions: { canManage: false },
  };
  const platformPath = path.startsWith("/app")
    ? path
    : path === "/spelen" || path === "/speler"
      ? (path === "/speler" ? "/app/play" : "/app/baan")
      : path === "/evenementen"
        ? "/app/events"
        : path === "/clubbeheer"
          ? "/app/clubs"
          : path === "/historie"
            ? "/app/mymatches"
            : path;
  const canOrganize = Boolean(
    session.data.canManagePlatform ||
    data?.permissions.canManage ||
    user.role === "organizer",
  );
  const nav: { href: string; label: string; icon: IconName }[] = [
    { href: "/app", label: "Vandaag", icon: "home" },
    { href: "/app/play", label: "Spelen", icon: "target" },
    { href: "/app/events", label: "Evenementen", icon: "calendar" },
    { href: "/app/friends", label: "Vrienden", icon: "users" },
    { href: "/app/feed", label: "My Feed", icon: "screen" },
    { href: "/app/community", label: "Kamers", icon: "users" },
    { href: "/app/locations", label: "Banen & locaties", icon: "target" },
    { href: "/app/clubs", label: "Verenigingen", icon: "club" },
    { href: "/app/mymatches", label: "Mijn wedstrijden", icon: "history" },
    { href: "/app/settings", label: "Instellingen", icon: "sliders" },
  ];
  const organizeNav: { href: string; label: string; icon: IconName }[] = [
    { href: "/app/dashboard", label: "Organiseren", icon: "home" },
    { href: "/wedstrijdleiding", label: "Wedstrijdleiding", icon: "sliders" },
    { href: "/app/events", label: "Evenementen", icon: "calendar" },
    { href: "/app/clubs", label: "Clubbeheer", icon: "club" },
    { href: "/app/reservations", label: "Baanreserveringen", icon: "calendar" },
    { href: "/app/venue-cast/studio", label: "Schermstudio", icon: "screen" },
    { href: "/app/mail", label: "Mailbeheer", icon: "users" },
    ...(session.data.canManagePlatform
      ? [
          {
            href: "/app/platform/integraties",
            label: "Platformbeheer",
            icon: "shield" as IconName,
          },
        ]
      : []),
  ];
  const organizing =
    canOrganize &&
    [
      "/wedstrijdleiding",
      "/app/dashboard",
      "/app/operations",
      "/app/manage",
      "/app/mail",
      "/app/platform",
      "/app/venue-cast",
      "/app/venue",
    ].some((prefix) => path.startsWith(prefix));
  const navigation = organizing ? organizeNav : nav;
  const section =
    path.startsWith("/wedstrijd/") || path.startsWith("/baan/")
      ? "Spelen"
      : navigation.find((n) => n.href === path)?.label ||
        nav.find((n) => n.href === platformPath)?.label ||
        "Mijn DartFlow";
  const environment =
    session.data.environment ||
    (session.data.local
      ? "development"
      : typeof location !== "undefined" && location.hostname === "dartflow.nl"
        ? "production"
        : "staging");
  async function logout() {
    await request("/api/auth/logout");
    hardNavigate("/inloggen");
  }
  const changeClub = (value: string) => {
    setClubId(value);
    localStorage.setItem("dartflow-club", value);
  };
  return (
    <div className="app-shell v15-shell">
      {mobileOpen && (
        <button
          className="mobile-scrim"
          aria-label="Menu sluiten"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
        <a className="brand" href="/">
          <img src="/assets/dartflow-logo.svg" alt="DartFlow" />
        </a>
        <p className="brand-caption">SPEEL. ONTMOET. COMPETEER.</p>
        <div className="workspace-switch">
          <a className={!organizing ? "active" : ""} href="/app">
            Spelen
          </a>
          {canOrganize && (
            <a className={organizing ? "active" : ""} href="/app/dashboard">
              Organiseren
            </a>
          )}
        </div>
        <div className="nav-caption">
          {organizing ? "ORGANISATIE" : "JOUW WERKRUIMTE"}
        </div>
        <nav aria-label="Hoofdnavigatie">
          {navigation.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={`nav-item ${n.href === path ? "active" : ""}`}
              aria-current={n.href === path ? "page" : undefined}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
          {!organizing && <InstallDartflow kind="player" />}
        </nav>
        <div className="sidebar-bottom">
          <div className="club-context">
            <Icon name="club" />
            <span>JOUW OMGEVING</span>
            <strong>
              {clubId
                ? data?.clubs.find((c) => c.id === clubId)?.name || "Vereniging"
                : "Wereldwijd"}
            </strong>
            <small>Eén account · al jouw darts</small>
          </div>
          <div className="sidebar-footer">
            <span />
            DartFlow · DG Webservices
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Menu openen"
            onClick={() => setMobileOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <a className="mobile-brand" href="/">
            <img src="/assets/dartflow-logo.svg" alt="DartFlow" />
          </a>
          <div className="breadcrumb">
            Mijn DartFlow <Icon name="chevron" />
            <strong>{section}</strong>
          </div>
          <div className="topbar-right">
            <WorkspaceTools overview={data} />
            {environment !== "production" && (
              <Badge>
                {environment === "development" ? "DEVELOPMENT" : "STAGING"}
              </Badge>
            )}
            <div className="profile">
              <Avatar name={user.name} />
              <div>
                <strong>{user.name}</strong>
                <small>{organizing ? "Organiseren" : "Speler"}</small>
              </div>
            </div>
            <button
              className="icon-button"
              title="Uitloggen"
              aria-label="Uitloggen"
              onClick={() => void logout()}
            >
              <Icon name="logout" />
            </button>
          </div>
        </header>
        {session.data.local && (
          <div className="local-banner">
            <Icon name="shield" />
            <span>
              <strong>Lokale testomgeving</strong> · testaccounts, geen
              productiegegevens
            </span>
            <a href="/inloggen">Testaccount wisselen</a>
          </div>
        )}
        <main className="content">
          <div className="context-bar">
            <div>
              <Icon name="club" />
              <label className="sr-only" htmlFor="club-context">
                Omgeving kiezen
              </label>
              <select
                id="club-context"
                value={clubId}
                onChange={(e) => changeClub(e.target.value)}
              >
                <option value="">Wereldwijd</option>
                {data?.clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <Connection stale={overview.stale} updated={overview.updated} />
          </div>
          {path.startsWith("/wedstrijd/") ? (
            <MatchPage
              id={path.split("/")[2]}
              user={user}
              overview={scorerOverview}
            />
          ) : path.startsWith("/baan/") ? (
            <BoardPage
              boardId={decodeURIComponent(path.split("/")[2])}
              user={user}
              overview={scorerOverview}
            />
          ) : path === "/wedstrijdleiding" ? (
            data ? (
              <ManagementPage data={data} refresh={overview.refresh} />
            ) : (
              <div className="panel loading-panel">
                <p>De actuele speeldag ophalen…</p>
                {overview.error && (
                  <p className="inline-error">{overview.error}</p>
                )}
              </div>
            )
          ) : path === "/evenementen" && data ? (
            <LegacyEventsPage data={data} refresh={overview.refresh} />
          ) : path === "/historie" ? (
            <LegacyHistoryPage data={scorerOverview} />
          ) : platformPath === "/app/baan" ? (
            data ? (
              <>
                <Heading
                  kicker="QR · TELEFOON · LIVE SCOREBORD"
                  title="Baanmodus"
                >
                  Open je vaste baan, deel de QR en speel samen.
                </Heading>
                {data.boards.length ? (
                  <div className="boards-grid">
                    {data.boards.map((board) => (
                      <div className="panel" key={board.id}>
                        <h2>{board.name}</h2>
                        <Badge live={Boolean(board.matchId)}>
                          {board.matchId ? "Wedstrijd gekoppeld" : "Baan vrij"}
                        </Badge>
                        <QR path={`/baan/${board.id}`} label="Open deze baan" />
                        {data.permissions.canManage && (
                          <ScreenManager board={board} />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="panel">
                    <Empty title="Nog geen banen">
                      De organisator maakt de banen aan bij een speeldag. Je
                      kunt ook direct een vrije wedstrijd starten.
                    </Empty>
                    <a className="button gold" href="/app/practice">
                      Vrij spelen ↗
                    </a>
                  </div>
                )}
              </>
            ) : (
              <div className="panel loading-panel">Banen ophalen…</div>
            )
          ) : (
            <PlatformWorkspace
              key={platformPath}
              path={platformPath}
              user={user}
              overview={data}
              clubId={clubId}
            />
          )}
          <footer className="app-footer">
            <span>© {new Date().getFullYear()} DartFlow · DG Webservices</span>
            <span>Speel. Ontmoet. Competeer.</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobiele navigatie">
        {nav.slice(0, 3).map((n) => (
          <a
            key={n.href}
            href={n.href}
            className={n.href === path ? "active" : ""}
          >
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </a>
        ))}
        <a href="/app/friends">
          <Icon name="users" />
          <span>Vrienden</span>
        </a>
        <button onClick={() => setMobileOpen(true)}>
          <Icon name="menu" />
          <span>Meer</span>
        </button>
      </nav>
    </div>
  );
}

function Heading({
  kicker,
  title,
  children,
  action,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{kicker}</span>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}
function SectionHeading({
  title,
  children,
  href,
  link,
}: {
  title: string;
  children?: ReactNode;
  href?: string;
  link?: string;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {children}
      {href && (
        <a className="text-link" href={href}>
          {link || "Bekijk alles"}
          <Icon name="arrow" />
        </a>
      )}
    </div>
  );
}

function ManagementPage({
  data,
  refresh,
}: {
  data: Overview;
  refresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState("overzicht");
  return (
    <>
      <Heading kicker="RUST AAN DE REGIETAFEL" title="Wedstrijdleiding">
        De actuele speeldag. Van check-in tot bevestigde uitslag.
      </Heading>
      {!data.permissions.canManage ? (
        <div className="panel">
          <Empty
            title="Deze werkruimte is voor de wedstrijdleiding"
            icon="shield"
          >
            Je account heeft in deze omgeving geen beheerrechten. Je eigen
            wedstrijden vind je bij Spelen.
          </Empty>
          <a href="/spelen" className="button gold">
            Naar mijn wedstrijden
            <Icon name="arrow" />
          </a>
        </div>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Wedstrijdleiding">
            {[
              { id: "overzicht", text: "Overzicht" },
              { id: "deelnemers", text: "Deelnemers" },
              { id: "banen", text: "Banen & schermen" },
              { id: "schema", text: "Schema" },
            ].map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? "active" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.text}
              </button>
            ))}
          </div>
          {(tab === "overzicht" || tab === "schema") && (
            <>
              {data.events
                .filter((e) => e.canManage)
                .map((event) => (
                  <div key={event.id}>
                    <SectionHeading title={event.name} />
                    <div className="regie-grid">
                      <PlanMatch event={event} data={data} refresh={refresh} />
                      <div className="panel">
                        <div className="panel-kicker">SPEELDAGSTATUS</div>
                        <h3>Iedereen klaar?</h3>
                        <div className="checklist">
                          <p>
                            <span>
                              {
                                data.participants.filter(
                                  (p) =>
                                    p.eventId === event.id &&
                                    p.status === "registered",
                                ).length
                              }
                            </span>{" "}
                            spelers ingeschreven
                          </p>
                          <p>
                            <span>
                              {
                                data.participants.filter(
                                  (p) =>
                                    p.eventId === event.id &&
                                    p.checkedIn &&
                                    p.status === "registered",
                                ).length
                              }
                            </span>{" "}
                            spelers ingecheckt
                          </p>
                          <p>
                            <span>
                              {
                                data.matches.filter(
                                  (m) =>
                                    m.eventId === event.id &&
                                    m.status === "live",
                                ).length
                              }
                            </span>{" "}
                            wedstrijden live
                          </p>
                          <p>
                            <span>
                              {
                                data.matches.filter(
                                  (m) =>
                                    m.eventId === event.id &&
                                    m.status === "confirmed",
                                ).length
                              }
                            </span>{" "}
                            uitslagen bevestigd
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              <SectionHeading title="Wedstrijden" />
              <MatchTable matches={data.matches} boards={data.boards} />
            </>
          )}
          {tab === "deelnemers" && (
            <ParticipantTable data={data} refresh={refresh} />
          )}
          {tab === "banen" && (
            <div className="boards-grid">
              {data.boards.map((board) => (
                <div className="panel board-management" key={board.id}>
                  <div className="section-heading">
                    <h2>{board.name}</h2>
                    <Badge live={Boolean(board.matchId)}>
                      {board.blocked
                        ? "Geblokkeerd"
                        : board.matchId
                          ? "Gekoppeld"
                          : "Vrij"}
                    </Badge>
                  </div>
                  <QR
                    path={`/baan/${encodeURIComponent(board.id)}`}
                    label="Telefoon openen"
                  />
                  <div className="divider" />
                  <ScreenManager board={board} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
function PlanMatch({
  event,
  data,
  refresh,
}: {
  event: EventView;
  data: Overview;
  refresh: () => Promise<void>;
}) {
  const entries = data.participants.filter(
    (p) => p.eventId === event.id && p.checkedIn && p.status === "registered",
  );
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [startScore, setStartScore] = useState(501);
  const [legs, setLegs] = useState(3);
  const [sets, setSets] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(`/api/events/${event.id}/actions`, {
        type: "plan",
        playerIds: [p1, p2],
        settings: { startScore, bestOfLegs: legs, bestOfSets: sets },
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plannen mislukt.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="panel plan-panel" onSubmit={submit}>
      <div className="panel-kicker">VOLGENDE AAN DE OCHE</div>
      <h3>Partij klaarzetten</h3>
      <p className="muted-copy">
        Kies twee ingecheckte spelers. De server controleert of ze beschikbaar
        zijn.
      </p>
      <div className="field-grid">
        {[
          { label: "Speler 1", value: p1, set: setP1 },
          { label: "Speler 2", value: p2, set: setP2 },
        ].map((p) => (
          <label className="field" key={p.label}>
            {p.label}
            <select
              required
              value={p.value}
              onChange={(e) => p.set(e.target.value)}
            >
              <option value="">Kies een speler</option>
              {entries.map((entry) => (
                <option key={entry.id} value={entry.playerId}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="field-grid three">
        <label className="field">
          Speltype
          <select
            value={startScore}
            onChange={(e) => setStartScore(Number(e.target.value))}
          >
            {[301, 501, 701].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Best of legs
          <select
            value={legs}
            onChange={(e) => setLegs(Number(e.target.value))}
          >
            {[1, 3, 5, 7, 9].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Best of sets
          <select
            value={sets}
            onChange={(e) => setSets(Number(e.target.value))}
          >
            {[1, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button gold"
        disabled={busy || !p1 || !p2 || p1 === p2}
      >
        {busy ? "Partij klaarzetten…" : "Partij klaarzetten"}
        <Icon name="arrow" />
      </button>
    </form>
  );
}
function ParticipantTable({
  data,
  refresh,
}: {
  data: Overview;
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  async function checkIn(eventId: string, playerId: string) {
    setError("");
    try {
      await request(`/api/events/${eventId}/actions`, {
        type: "check-in",
        playerId,
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inchecken mislukt.");
    }
  }
  return (
    <div className="panel">
      <SectionHeading title="Deelnemers" />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Speler</th>
              <th>Inschrijving</th>
              <th>Aanwezigheid</th>
              <th>Actie</th>
            </tr>
          </thead>
          <tbody>
            {data.participants.map((p) => (
              <tr key={p.id}>
                <td>
                  <span className="table-person">
                    <Avatar name={p.name} />
                    {p.name}
                  </span>
                </td>
                <td>
                  {
                    {
                      registered: "Ingeschreven",
                      waitlisted: "Wachtlijst",
                      withdrawn: "Afgemeld",
                    }[p.status]
                  }
                </td>
                <td>
                  {p.checkedIn ? (
                    <Badge live>Ingecheckt</Badge>
                  ) : (
                    "Nog niet aanwezig"
                  )}
                </td>
                <td>
                  {p.status === "registered" && !p.checkedIn && (
                    <button
                      className="button small"
                      onClick={() => void checkIn(p.eventId, p.playerId)}
                    >
                      Inchecken
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function MatchTable({
  matches,
  boards,
}: {
  matches: MatchView[];
  boards: BoardView[];
}) {
  return (
    <div className="panel table-panel">
      {matches.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Wedstrijd</th>
                <th>Baan</th>
                <th>Status</th>
                <th>Legs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.players.map((p) => p.name).join(" — ")}</strong>
                  </td>
                  <td>{boards.find((b) => b.id === m.boardId)?.name || "—"}</td>
                  <td>
                    <Badge live={m.status === "live"}>{labels[m.status]}</Badge>
                  </td>
                  <td>{m.legs.join(" — ")}</td>
                  <td>
                    <a className="text-link" href={`/wedstrijd/${m.id}`}>
                      Openen
                      <Icon name="arrow" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Nog geen partijen ingepland">
          Zet een partij klaar met twee ingecheckte spelers.
        </Empty>
      )}
    </div>
  );
}
function ScreenManager({ board }: { board: BoardView }) {
  const [screen, setScreen] = useState<{ id: string; url: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create() {
    setBusy(true);
    setError("");
    try {
      setScreen(
        await request("/api/screens", {
          eventId: board.eventId,
          boardId: board.id,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scherm uitgeven mislukt.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!screen) return;
    setError("");
    try {
      await request(`/api/screens/${screen.id}`, undefined, "DELETE");
      setScreen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Intrekken mislukt.");
    }
  }
  return (
    <div className="screen-manager">
      <h3>
        <Icon name="screen" />
        Publiek baanscherm
      </h3>
      <p>
        Geef een persoonlijke schermlink uit voor deze baan. Een ingetrokken
        link stopt direct met werken.
      </p>
      {screen ? (
        <>
          <QR path={screen.url} label="9:16-baanscherm" />
          <div className="button-row">
            <a
              className="button gold small"
              href={screen.url}
              target="_blank"
              rel="noreferrer"
            >
              Scherm openen
              <Icon name="arrow" />
            </a>
            <button
              className="button ghost small"
              onClick={() => void revoke()}
            >
              Link intrekken
            </button>
          </div>
        </>
      ) : (
        <button
          className="button"
          disabled={busy}
          onClick={() => void create()}
        >
          <Icon name="screen" />
          {busy ? "Link uitgeven…" : "Schermlink uitgeven"}
        </button>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function BoardPage({
  boardId,
  user,
  overview,
}: {
  boardId: string;
  user: Profile;
  overview: Overview;
}) {
  const [mode, setMode] = useState("solo");
  const [startScore, setStartScore] = useState("501");
  const [bestOfLegs, setBestOfLegs] = useState("3");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const lookup = usePolled<{
    board: { id: string; name: string; occupied: boolean; blocked?: boolean; access?: 'all' | 'club' };
    event: { id: string; name: string };
    club?: { id: string; name: string };
    matchId?: string;
    practiceId?: string;
    pendingLobbyId?: string;
    ownLobbyId?: string;
    canStart?: boolean;
    reservation?:import('@/lib/location-types').ReservedBoardContext;
  }>(`/api/boards/${encodeURIComponent(boardId)}`);
  const data = lookup.data;
  async function boardAction(action: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await request<{
        id?: string;
        trainingId?: string;
        lobbyId?: string;
        kind?: string;
        code?: string;
        matchId?:string;
      }>("/api/platform/actions", { requestId: crypto.randomUUID(), action });
      const trainingId =
        result.trainingId ||
        (result.kind === "training" ? result.id : undefined);
      const lobbyId =
        result.lobbyId ||
        (result.kind === "lobby" || action.type === "lobby.join"
          ? result.id || data?.pendingLobbyId
          : undefined);
      if(result.matchId)hardNavigate(`/wedstrijd/${encodeURIComponent(result.matchId)}`);
      else if (trainingId)
        hardNavigate(`/app/training/${encodeURIComponent(trainingId)}`);
      else if (lobbyId)
        hardNavigate(
          `/app/lobby/${encodeURIComponent(lobbyId)}${result.code ? `?code=${encodeURIComponent(result.code)}` : ""}`,
        );
      else await lookup.refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "De baan is niet gestart.",
      );
      await lookup.refresh();
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <>
        <Heading
          kicker="BAANMODUS"
          title={lookup.error ? "Baan niet beschikbaar" : "Jouw baan openen…"}
        />
        <div className="panel">
          {lookup.error ? (
            <Empty title="Deze baan is niet beschikbaar" icon="shield">
              {lookup.error}
            </Empty>
          ) : (
            <p>De actuele baan ophalen…</p>
          )}
        </div>
      </>
    );
  const board: BoardView = {
    id: data.board.id,
    eventId: data.event.id,
    name: data.board.name,
    blocked:
      data.board.blocked || overview.boards.find((board) => board.id === boardId)?.blocked || false,
    matchId: data.matchId || null,
  };
  const context: Overview = {
    ...overview,
    events: overview.events.some((event) => event.id === data.event.id)
      ? overview.events
      : [
          ...overview.events,
          {
            ...data.event,
            clubId: "",
            date: "",
            capacity: 0,
            canManage: false,
          },
        ],
    boards: overview.boards.some((board) => board.id === boardId)
      ? overview.boards
      : [...overview.boards, board],
  };
  if (data.matchId)
    return (
      <MatchPage
        key={data.matchId}
        id={data.matchId}
        user={user}
        overview={context}
      />
    );
  if (data.practiceId)
    return (
      <>
        <Heading kicker="BAANMODUS · SOLO" title={data.board.name}>
          {data.event.name} · Deze training is aan dit bord gekoppeld.
        </Heading>
        <PlatformWorkspace
          path={`/app/training/${data.practiceId}`}
          user={user}
          overview={context}
        />
      </>
    );
  if (data.ownLobbyId)
    return (
      <>
        <Heading
          kicker="BAANMODUS · SPELERS VERZAMELEN"
          title={data.board.name}
        >
          {data.event.name}
        </Heading>
        <PlatformWorkspace
          path={`/app/lobby/${data.ownLobbyId}`}
          user={user}
          overview={context}
        />
      </>
    );
  return (
    <>
      <Heading kicker="BAANMODUS" title={board.name}>
        {data.club?.name || data.event.name}
      </Heading>
      <div className="panel board-wait">
        <img src="/assets/dartboard.svg" alt="Dartbord" />
        <Empty
          title={
            data.board.blocked
              ? "Deze baan is tijdelijk geblokkeerd"
              : data.pendingLobbyId
              ? "Samen aan dit bord"
              : data.board.occupied
                ? "Deze baan is bezet"
                : "De baan staat klaar"
          }
        >
          {data.board.blocked
            ? "De vereniging heeft deze baan tijdelijk buiten gebruik gezet."
            : data.pendingLobbyId
            ? "De eerste speler heeft deze baan klaargezet. Meld je aan als tweede speler."
            : data.board.occupied
              ? "Er wordt op deze baan een andere partij gespeeld. Jouw eigen wedstrijd wordt getoond zodra je aan de beurt bent."
              : data.canStart
                ? data.club ? "Kies je spelvorm en begin op dit bord met je eigen account. Je hoeft je niet voor een evenement in te schrijven." : "Kies je spelvorm en begin op dit bord. Een ingeplande of gereserveerde baan blijft bij de wedstrijdleiding."
                : "De wedstrijdleiding koppelt de volgende partij aan deze baan. Deze vaste QR blijft naar dezelfde baan wijzen."}
        </Empty>
        {data.reservation&&<section className="notice"><h2>{data.reservation.label}</h2><p>{new Date(data.reservation.startsAt).toLocaleString('nl-NL')} – {new Date(data.reservation.endsAt).toLocaleString('nl-NL')}</p>{data.reservation.canPrepare&&data.reservation.fixtureId?<button className="button gold full" disabled={busy} onClick={()=>void boardAction({type:'reservation.fixture.start',reservationId:data.reservation!.id,boardId,fixtureId:data.reservation!.fixtureId})}>Mijn ingeplande partij klaarmaken</button>:<p>Wedstrijdleiding of de eerste ingeroosterde speler roept de volgende partij op.</p>}</section>}
        {!data.board.blocked && data.pendingLobbyId ? (
          <div className="board-start">
            <h2>Een speler wacht aan dit bord</h2>
            <p>
              Speel samen op locatie. Meld je met je eigen account aan voor de
              tweede plek.
            </p>
            <button
              className="button gold full"
              disabled={busy}
              onClick={() =>
                void boardAction({
                  type: "lobby.join",
                  id: data.pendingLobbyId,
                  boardId,
                })
              }
            >
              {busy ? "Aanmelden…" : "Meedoen aan deze baan"}
            </button>
          </div>
        ) : !data.board.blocked && data.canStart ? (
          <form
            className="board-start"
            onSubmit={(event) => {
              event.preventDefault();
              void boardAction({
                type: "board.start",
                boardId,
                mode,
                startScore: Number(startScore),
                bestOfLegs: Number(bestOfLegs),
              });
            }}
          >
            <h2>Vrij spelen op deze baan</h2>
            <p>
              Deze vaste QR en het gekoppelde Oche Live-scherm blijven bij
              hetzelfde fysieke bord.
            </p>
            <label className="field">
              Spelvorm
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                disabled={busy}
              >
                <option value="solo">Solo trainen</option>
                <option value="local">Samen op locatie</option>
                <option value="remote">Tegenstander op afstand</option>
              </select>
            </label>
            <div className="field-grid">
              <label className="field">
                Startscore
                <select
                  value={startScore}
                  onChange={(event) => setStartScore(event.target.value)}
                  disabled={busy}
                >
                  {[301, 501, 701].map((score) => (
                    <option key={score}>{score}</option>
                  ))}
                </select>
              </label>
              {mode !== "solo" && (
                <label className="field">
                  Best of legs
                  <select
                    value={bestOfLegs}
                    onChange={(event) => setBestOfLegs(event.target.value)}
                    disabled={busy}
                  >
                    {[1, 3, 5, 7, 9].map((legs) => (
                      <option key={legs}>{legs}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p>
              {mode === "solo"
                ? "Jouw training en scores worden bewaard. Scan later dezelfde QR om verder te gaan."
                : mode === "local"
                  ? "Je tegenstander scant dezelfde QR met een eigen account. Start zodra jullie beiden gereed zijn."
                  : "Na het aanmaken ontvang je een besloten uitnodigingslink voor je tegenstander."}
            </p>
            <button className="button gold full" disabled={busy}>
              {busy ? "Baan vastleggen…" : "Op deze baan starten"}
            </button>
          </form>
        ) : null}
        {actionError && (
          <p className="notice error" role="alert">
            {actionError}
          </p>
        )}
        <a className="button ghost" href={data.club ? `/app/clubs/${data.club.id}` : "/app/events"}>
          {data.club ? "Bekijk de vereniging" : "Bekijk je speeldag"} ↗
        </a>
      </div>
    </>
  );
}

type PendingAction = {
  requestId: string;
  expectedRevision: number;
  action: MatchAction;
  matchId: string;
};
function MatchPage({
  id,
  user,
  overview,
}: {
  id: string;
  user: Profile;
  overview: Overview;
}) {
  const live = usePolled<MatchView>(`/api/matches/${encodeURIComponent(id)}`);
  const { refresh: refreshMatch, accept: acceptMatch } = live;
  const match = live.data;
  const actualBoard = usePolled<{
    board: { id: string; name: string };
    event: { id: string; name: string };
  }>(
    match?.boardId ? `/api/boards/${encodeURIComponent(match.boardId)}` : null,
  );
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [score, setScore] = useState("");
  const [darts, setDarts] = useState(3);
  const [doubleConfirmed, setDoubleConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [disputing, setDisputing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [boardId, setBoardId] = useState(overview.boards[0]?.id || "");
  const sendingRef = useRef(false);
  const storeKey = `dartflow-action:${user.id}:${id}`;
  const scoreKey = `dartflow-score:${user.id}:${id}`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storeKey);
      if (saved) setPending(JSON.parse(saved) as PendingAction);
      setScore(sessionStorage.getItem(scoreKey) || "");
    } catch {
      /* Invalid browser storage can be discarded. */
    }
  }, [storeKey, scoreKey]);
  const submitPending = useCallback(
    async (command: PendingAction) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      setActionError("");
      try {
        const committed = await request<MatchView>(
          `/api/matches/${id}/actions`,
          command,
        );
        acceptMatch(committed);
        setPending(null);
        sessionStorage.removeItem(storeKey);
        if (command.action.type === "score") {
          setScore("");
          sessionStorage.removeItem(scoreKey);
          setDoubleConfirmed(false);
        }
        setDisputing(false);
        setConflict(false);
        await refreshMatch();
      } catch (e) {
        const status = (e as Error & { status?: number }).status;
        setConflict(status === 409 || status === 400 || status === 403 || status === 410);
        setActionError(
          e instanceof Error
            ? e.message
            : "De actie is bewaard. Herstel de verbinding om opnieuw te verzenden.",
        );
        await refreshMatch();
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [id, refreshMatch, acceptMatch, scoreKey, storeKey],
  );
  useEffect(() => {
    if (!pending || conflict) return;
    const retry = () => {
      if (navigator.onLine && document.visibilityState === "visible")
        void submitPending(pending);
    };
    const timer = setInterval(retry, 4000);
    window.addEventListener("online", retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retry);
    };
  }, [pending, conflict, submitPending]);
  function act(action: MatchAction) {
    if (!match || pending || sendingRef.current) return;
    const command = {
      requestId: crypto.randomUUID(),
      expectedRevision: match.revision,
      matchId: match.id,
      action,
    };
    sessionStorage.setItem(storeKey, JSON.stringify(command));
    setPending(command);
    void submitPending(command);
  }
  function updateScore(value: string) {
    const next = value.replace(/\D/g, "").slice(0, 3);
    setScore(next);
    sessionStorage.setItem(scoreKey, next);
    setDoubleConfirmed(false);
  }
  if (!match)
    return (
      <>
        <Heading kicker="BAANMODUS" title="Jouw wedstrijd" />
        {live.error ? (
          <div className="panel">
            <Empty title="Wedstrijd niet beschikbaar" icon="shield">
              {live.error}
            </Empty>
            <button className="button" onClick={() => void live.refresh()}>
              <Icon name="refresh" />
              Opnieuw laden
            </button>
          </div>
        ) : (
          <div className="panel loading-panel">
            <span className="loading-ring" />
            <p>Wedstrijd laden…</p>
          </div>
        )}
      </>
    );
  if(match.status==='abandoned')return <><Heading kicker="BAANMODUS" title="Baanpartij beëindigd"/><div className="panel"><p>De baan is vrijgegeven. De voorlopige scores en statistieken van deze afgebroken partij zijn gewist.</p><a className="button gold" href="/app/spelen">Nieuwe partij starten</a></div></>;
  const tablet =
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).get("tablet") === "1" &&
    "offlineSupported" in match &&
    match.offlineSupported === true;
  const playerIndex = match.players.findIndex((p) => p.id === user.id);
  const finish = score !== "" && Number(score) === match.remaining[match.turn];
  const writer =
    match.players.find((p) => p.id === match.writerId)?.name ||
    "Wedstrijdleiding";
  const event =
    actualBoard.data?.event ||
    overview.events.find((e) => e.id === match.eventId);
  const boardName =
    actualBoard.data?.board.name ||
    overview.boards.find((b) => b.id === match.boardId)?.name ||
    "Baan toegewezen";
  const disabled = sending || Boolean(pending);
  const winner = match.players.find((p) => p.id === match.winnerId);
  const matchControls = <>
            <div className="match-actions">
              {match.permissions.canPause && (
                <button
                  className="button ghost small"
                  disabled={disabled}
                  onClick={() => act({ type: "pause" })}
                >
                  Wedstrijd pauzeren
                </button>
              )}
              {match.permissions.canResume && (
                <button
                  className="button gold small"
                  disabled={disabled}
                  onClick={() => act({ type: "resume" })}
                >
                  Wedstrijd hervatten
                </button>
              )}
              {match.permissions.canRequestCorrection && (
                <button
                  className="button ghost small"
                  disabled={disabled}
                  onClick={() => setCorrecting((value) => !value)}
                >
                  Correctie aanvragen
                </button>
              )}
              {match.permissions.canTakeOver && (
                <button
                  className="button small"
                  disabled={disabled}
                  onClick={() => act({ type: "take-over" })}
                >
                  <Icon name="sliders" />
                  Schrijven overnemen
                </button>
              )}
              {match.permissions.canUndo && (
                <button
                  className="button ghost small"
                  disabled={disabled}
                  onClick={() => act({ type: "undo" })}
                >
                  <Icon name="history" />
                  Laatste bezoek corrigeren
                </button>
              )}
            </div>
            {match.paused && (
              <div className="notice" role="status">
                <strong>Wedstrijd gepauzeerd</strong>
                <p>
                  De stand blijft bewaard. Hervat de wedstrijd voordat je verder
                  scoort.
                </p>
              </div>
            )}
            {correcting && match.permissions.canRequestCorrection && (
              <form
                className="notice"
                onSubmit={(event) => {
                  event.preventDefault();
                  act({ type: "request-correction", reason });
                  setCorrecting(false);
                }}
              >
                <label className="field">
                  Wat moet er worden gecorrigeerd?
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    minLength={3}
                    maxLength={1000}
                    required
                  />
                </label>
                <p>
                  Je tegenstander beoordeelt het verzoek. Tot die beslissing
                  blijft de score-invoer geblokkeerd.
                </p>
                <button
                  className="button gold small"
                  disabled={disabled || reason.trim().length < 3}
                >
                  Correctieverzoek versturen
                </button>
              </form>
            )}
            {match.correction && (
              <div className="notice">
                <strong>Correctieverzoek</strong>
                <p>{match.correction.reason}</p>
                <p>
                  {match.correction.undoCount} beurt(en) worden bij akkoord
                  teruggedraaid tot de betreffende eigen beurt.
                </p>
                <div className="button-row">
                  {match.permissions.canAnswerCorrection && (
                    <>
                      <button
                        className="button gold small"
                        disabled={disabled}
                        onClick={() =>
                          act({
                            type: "approve-correction",
                            correctionId: match.correction!.id,
                          })
                        }
                      >
                        Correctie goedkeuren
                      </button>
                      <button
                        className="button ghost small"
                        disabled={disabled}
                        onClick={() =>
                          act({
                            type: "reject-correction",
                            correctionId: match.correction!.id,
                          })
                        }
                      >
                        Correctie afwijzen
                      </button>
                    </>
                  )}
                  {match.permissions.canCancelCorrection && (
                    <button
                      className="button ghost small"
                      disabled={disabled}
                      onClick={() =>
                        act({
                          type: "cancel-correction",
                          correctionId: match.correction!.id,
                        })
                      }
                    >
                      Correctieverzoek intrekken
                    </button>
                  )}
                </div>
              </div>
            )}
  </>;
  const activeConsole = consoleOpen && match.status === "live" && !tablet && (playerIndex >= 0 || match.permissions.canScore);
  return (
    <>
      {!activeConsole&&<BoardActivityNotice activity={match.boardActivity} offline={!live.online} onRefresh={refreshMatch}/>}
      {activeConsole && <ScoreConsole activity={<BoardActivityNotice activity={match.boardActivity} offline={!live.online} onRefresh={refreshMatch}/>} title={`${match.settings.startScore} · Leg ${match.legNumber} · Set ${match.setNumber}`} players={match.players.map((player,index)=>({...player,remaining:match.remaining[index]}))} active={match.turn} score={score} onScore={updateScore} darts={darts} onDarts={setDarts} finish={finish} doubleConfirmed={doubleConfirmed} onDoubleConfirmed={setDoubleConfirmed} canScore={match.permissions.canScore} busy={sending} disabled={disabled} offline={!live.online} message={actionError || (pending ? sending ? "Score verzenden…" : conflict ? "Controleer de stand en je bewaarde actie bij Darts & correctie." : "Actie bewaard · herstel de verbinding om opnieuw te verzenden." : live.error || (match.paused ? "Wedstrijd gepauzeerd." : match.correction ? "Een correctieverzoek wacht op beoordeling." : ""))} checkout={match.checkout} waiting={match.scoringMode==='per-player'?`${match.players[match.turn]?.name} is aan de beurt.`:`${writer} schrijft deze partij.`} chat={match.scoringMode==='per-player'&&playerIndex>=0?<ScopedChat kind="match" scopeId={id} actorId={user.id} label="Wedstrijdchat" inConsole/>:undefined} onBack={()=>setConsoleOpen(false)} onSubmit={()=>act({type:"score",score:Number(score),darts,doubleConfirmed:finish&&doubleConfirmed})} options={<>{pending && !sending && <div className="notice"><p>{actionError || "Deze actie is bewaard met hetzelfde actie-ID."}</p><button className="button small" onClick={()=>void submitPending(pending)}>Zelfde actie opnieuw proberen</button><button className="button ghost small" onClick={()=>{setPending(null);setConflict(false);setActionError("");sessionStorage.removeItem(storeKey);}}>Bewaarde actie verwerpen</button></div>}{matchControls}</>} />}
      {match.status === "live" && !tablet && (playerIndex >= 0 || match.permissions.canScore) && <button className="button gold full" onClick={()=>setConsoleOpen(true)}>Scoreweergave openen</button>}
      <Heading
        kicker={`${event?.name || "BAANMODUS"}${match.boardId ? ` · ${boardName}` : ""}`}
        title={`${match.players[0].name} — ${match.players[1].name}`}
        action={
          <Badge live={match.status === "live"}>{labels[match.status]}</Badge>
        }
      >
        {match.settings.startScore} dubbel uit · best of{" "}
        {match.settings.bestOfLegs} legs
        {match.settings.bestOfSets > 1 &&
          ` · best of ${match.settings.bestOfSets} sets`}
      </Heading>
      <MatchInvitation matchId={match.id} />
      <div className="match-layout">
        <div>
          <div className="panel scoreboard">
            <div className="scoreboard-top">
              <span>
                <Icon name="target" />
                {match.boardId ? boardName : "Baan volgt"}
              </span>
              <Connection stale={live.stale} updated={live.updated} />
            </div>
            <div className="score-players">
              {match.players.map((player, index) => (
                <div
                  className={`score-player ${match.turn === index && match.status === "live" ? "active" : ""}`}
                  key={player.id}
                >
                  <span className="turn-indicator">
                    {match.turn === index && match.status === "live"
                      ? "AAN DE BEURT"
                      : index === 0
                        ? "SPELER 1"
                        : "SPELER 2"}
                  </span>
                  <Avatar name={player.name} />
                  <h2>{player.name}</h2>
                  <strong className="remaining">
                    {match.remaining[index]}
                  </strong>
                  <div className="player-totals">
                    <span>
                      LEGS <b>{match.legs[index]}</b>
                    </span>
                    <span>
                      SETS <b>{match.sets[index]}</b>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="match-progress">
              <span>Leg {match.legNumber}</span>
              <span>Set {match.setNumber}</span>
              <span>
                {match.scoringMode==='per-player'?'Iedere speler scoort zelf · Aan de beurt: ':'Schrijver: '}<strong>{writer}</strong>
              </span>
            </div>
            {match.checkout && match.status === "live" && (
              <div className="checkout">
                <Icon name="target" />
                <span>CHECKOUT</span>
                <strong>{match.checkout}</strong>
              </div>
            )}
            {pending && (
              <div
                className={`notice ${conflict ? "error" : ""}`}
                role="status"
              >
                <strong>
                  {sending
                    ? "Actie verzenden…"
                    : conflict
                      ? "Je bewaarde actie vraagt aandacht"
                      : "Actie bewaard op dit toestel"}
                </strong>
                <p>
                  {actionError ||
                    `${actionLabels[pending.action.type] || pending.action.type} wordt met hetzelfde actie-ID hersteld zodra er verbinding is.`}
                </p>
                {!sending && (
                  <div className="button-row">
                    <button
                      className="button small"
                      onClick={() => void submitPending(pending)}
                    >
                      <Icon name="refresh" />
                      Zelfde actie opnieuw proberen
                    </button>
                    <button
                      className="button ghost small"
                      onClick={() => {
                        setPending(null);
                        setConflict(false);
                        setActionError("");
                        sessionStorage.removeItem(storeKey);
                      }}
                    >
                      Bewaarde actie verwerpen
                    </button>
                  </div>
                )}
              </div>
            )}
            {match.status === "confirmed" ? (
              <div className="result-state">
                <span className="result-check">
                  <Icon name="check" />
                </span>
                <h3>
                  {winner ? `${winner.name} wint!` : "Wedstrijd bevestigd"}
                </h3>
                <p>
                  De uitslag is definitief en staat in je wedstrijdhistorie.
                </p>
                <a className="button gold" href="/historie">
                  Bekijk historie
                  <Icon name="arrow" />
                </a>
              </div>
            ) : match.status === "result" || match.status === "disputed" ? (
              <div className="result-state">
                <h3>
                  {match.status === "disputed"
                    ? "Uitslag in beoordeling"
                    : winner
                      ? `${winner.name} heeft gewonnen`
                      : "De partij is uitgespeeld"}
                </h3>
                <p>
                  {match.status === "disputed"
                    ? match.dispute ||
                      "De wedstrijdleiding beoordeelt deze uitslag."
                    : "Beide spelers bevestigen de uitslag voordat deze wordt verwerkt."}
                </p>
                <div className="confirmation-row">
                  {match.players.map((p, i) => (
                    <span
                      key={p.id}
                      className={match.confirmations[i] ? "confirmed" : ""}
                    >
                      <Icon
                        name={match.confirmations[i] ? "check" : "history"}
                      />
                      {p.name}
                    </span>
                  ))}
                </div>
                {match.permissions.canConfirm && (
                  <button
                    className="button gold"
                    disabled={disabled}
                    onClick={() => act({ type: "confirm" })}
                  >
                    <Icon name="check" />
                    Uitslag bevestigen
                  </button>
                )}
                {playerIndex >= 0 && match.status === "result" && (
                  <button
                    className="button ghost"
                    disabled={disabled}
                    onClick={() => setDisputing(!disputing)}
                  >
                    Uitslag betwisten
                  </button>
                )}
                {disputing && (
                  <div className="dispute-form">
                    <label className="field">
                      Wat klopt er niet?
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Beschrijf de correctie voor de wedstrijdleiding"
                      />
                    </label>
                    <button
                      className="button"
                      disabled={disabled || reason.trim().length < 3}
                      onClick={() => act({ type: "dispute", reason })}
                    >
                      Ter beoordeling versturen
                    </button>
                  </div>
                )}
              </div>
            ) : match.permissions.canScore && !tablet ? (
              <form
                className="score-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (score && (!finish || doubleConfirmed))
                    act({
                      type: "score",
                      score: Number(score),
                      darts,
                      doubleConfirmed: finish && doubleConfirmed,
                    });
                }}
              >
                <label htmlFor="visit-score" className="score-input-label">
                  JOUW BEZOEK{" "}
                  <span>{match.players[match.turn].name} is aan de beurt</span>
                </label>
                <div className="score-entry">
                  <input
                    id="visit-score"
                    inputMode="numeric"
                    autoComplete="off"
                    type="text"
                    pattern="[0-9]*"
                    value={score}
                    onChange={(e) => updateScore(e.target.value)}
                    placeholder="0"
                    disabled={disabled}
                    aria-label="Bezoekscore"
                  />
                  <button
                    type="button"
                    className="clear-score"
                    onClick={() => updateScore("")}
                    aria-label="Score wissen"
                    disabled={disabled}
                  >
                    <Icon name="close" />
                  </button>
                  <label className="darts-field">
                    Darts
                    <select
                      value={darts}
                      onChange={(e) => setDarts(Number(e.target.value))}
                      disabled={disabled}
                    >
                      {[1, 2, 3].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="score-keypad" aria-label="Scoretoetsen">
                  {[
                    "1",
                    "2",
                    "3",
                    "4",
                    "5",
                    "6",
                    "7",
                    "8",
                    "9",
                    "C",
                    "0",
                    "⌫",
                  ].map((key) => (
                    <button
                      type="button"
                      key={key}
                      disabled={disabled}
                      aria-label={
                        key === "C"
                          ? "Gehele score wissen"
                          : key === "⌫"
                            ? "Laatste cijfer wissen"
                            : `Cijfer ${key}`
                      }
                      onClick={() =>
                        updateScore(
                          key === "C"
                            ? ""
                            : key === "⌫"
                              ? score.slice(0, -1)
                              : score + key,
                        )
                      }
                    >
                      {key}
                    </button>
                  ))}
                </div>
                <div className="quick-scores">
                  {[26, 45, 60, 81, 100, 140, 180].map((n) => (
                    <button
                      type="button"
                      key={n}
                      disabled={disabled}
                      onClick={() => updateScore(String(n))}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {finish && (
                  <label className="checkout-confirm">
                    <input
                      type="checkbox"
                      checked={doubleConfirmed}
                      onChange={(e) => setDoubleConfirmed(e.target.checked)}
                      disabled={disabled}
                    />
                    <span>
                      Ik bevestig dat de laatste dart op een dubbel eindigde.
                    </span>
                  </label>
                )}
                <button
                  type="submit"
                  className="button gold full score-submit"
                  disabled={
                    disabled || score === "" || (finish && !doubleConfirmed)
                  }
                >
                  {sending
                    ? "Score verzenden…"
                    : finish
                      ? "Finish bevestigen"
                      : "Score invoeren"}
                  <Icon name="check" />
                </button>
              </form>
            ) : (
              <div className="score-wait">
                <Icon name={match.status === "live" ? "history" : "target"} />
                <h3>
                  {match.status === "live"
                    ? match.scoringMode==='per-player'?`${writer} is aan de beurt`:`${writer} schrijft deze partij`
                    : "Klaar voor de eerste pijl?"}
                </h3>
                <p>
                  {match.status === "live"
                    ? match.scoringMode==='per-player'?"Jullie voeren ieder je eigen worp in. Jouw invoer verschijnt automatisch zodra jij aan de beurt bent.":"De actuele stand verschijnt automatisch op dit toestel."
                    : "Bevestig je deelname en start de partij zodra beide spelers klaar zijn."}
                </p>
                {match.permissions.canAccept && (
                  <button
                    className="button gold"
                    disabled={disabled}
                    onClick={() => act({ type: "accept" })}
                  >
                    <Icon name="check" />
                    Ik ben klaar om te spelen
                  </button>
                )}
                {playerIndex >= 0 &&
                  !match.permissions.canManage &&
                  match.status === "ready" &&
                  match.accepted.every(Boolean) && (
                    <button
                      className="button gold"
                      disabled={disabled}
                      onClick={() => act({ type: "start" })}
                    >
                      Wedstrijd starten <Icon name="arrow" />
                    </button>
                  )}
              </div>
            )}
            {matchControls}
            <div className="revision-label">
              Stand bijgewerkt · revisie {match.revision}
            </div>
          </div>
          {tablet && (
            <OfflineReplayPanel
              matchId={match.id}
              revision={match.revision}
              userId={user.id}
              enabled={match.permissions.canScore || match.permissions.canUndo}
            />
          )}
          {playerIndex >= 0 && (
            <>
              <MediaRoom matchId={id} />
              {match.scoringMode==='per-player'&&!activeConsole&&<ScopedChat kind="match" scopeId={id} actorId={user.id} label="Wedstrijdchat"/>}
            </>
          )}
          <div className="panel visits-panel">
            <SectionHeading title="Laatste bezoeken" />
            {match.visits.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Speler</th>
                      <th>Score</th>
                      <th>Darts</th>
                      <th>Resterend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {match.visits
                      .slice(-12)
                      .reverse()
                      .map((v, i) => (
                        <tr key={`${match.visits.length - i}-${v.leg}`}>
                          <td>
                            {match.players[v.playerIndex]?.name || v.player}
                          </td>
                          <td className={v.score === 180 ? "gold-text" : ""}>
                            <strong>{v.bust ? "BUST" : v.score}</strong>
                            {v.checkout && (
                              <span className="visit-check"> ✓</span>
                            )}
                          </td>
                          <td>{v.darts}</td>
                          <td>{v.remainingAfter}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted-copy">
                De eerste pijl moet nog vallen. Bezoeken verschijnen hier na
                invoer.
              </p>
            )}
          </div>
        </div>
        <aside className="match-aside">
          <div className="panel match-details">
            <div className="panel-kicker">DEZELFDE PARTIJ, ELK TOESTEL</div>
            <h3>Jouw wedstrijd</h3>
            <div className="detail-row">
              <span>Speeldag</span>
              <strong>{event?.name || "Vrije wedstrijd"}</strong>
            </div>
            <div className="detail-row">
              <span>Spelvorm</span>
              <strong>{match.settings.startScore} dubbel uit</strong>
            </div>
            <div className="detail-row">
              <span>Deelname</span>
              <strong>
                {match.accepted.filter(Boolean).length} / 2 bevestigd
              </strong>
            </div>
            {match.boardId && (
              <QR path={`/wedstrijd/${match.id}`} label="Open op je telefoon" />
            )}
          </div>
          {match.permissions.canManage && (
            <div className="panel management-actions">
              <div className="panel-kicker">WEDSTRIJDLEIDING</div>
              <h3>Regie van deze partij</h3>
              {["planned","interrupted"].includes(match.status) && (
                <>
                  <label className="field">
                    Baan
                    <select
                      value={boardId}
                      onChange={(e) => setBoardId(e.target.value)}
                    >
                      {overview.boards.map((b) => (
                        <option value={b.id} key={b.id}>
                          {b.name}
                          {b.blocked ? " · geblokkeerd" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="button gold full"
                    disabled={disabled || !boardId}
                    onClick={() => act({ type: "call", boardId })}
                  >
                    Partij oproepen
                    <Icon name="arrow" />
                  </button>
                </>
              )}
              {["called", "ready"].includes(match.status) && (
                <button
                  className="button gold full"
                  disabled={disabled || !match.accepted.every(Boolean)}
                  onClick={() => act({ type: "start" })}
                >
                  Wedstrijd starten
                  <Icon name="arrow" />
                </button>
              )}
              {["called", "ready"].includes(match.status) &&
                !match.accepted.every(Boolean) && (
                  <p className="muted-copy">
                    Wacht tot beide spelers hun deelname hebben bevestigd.
                  </p>
                )}
              {match.status === "disputed" && (
                <>
                  <label className="field">
                    Reden van beoordeling
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <div className="button-stack">
                    <button
                      className="button"
                      disabled={disabled || reason.trim().length < 3}
                      onClick={() =>
                        act({ type: "resolve", decision: "resume", reason })
                      }
                    >
                      Terug naar de partij
                    </button>
                    <button
                      className="button gold"
                      disabled={disabled || reason.trim().length < 3}
                      onClick={() =>
                        act({ type: "resolve", decision: "accept", reason })
                      }
                    >
                      Uitslag vaststellen
                    </button>
                  </div>
                </>
              )}
              {match.status === "confirmed" && (
                <div className="button-stack">
                  <button
                    className="button"
                    disabled={disabled}
                    onClick={() => act({ type: "recover" })}
                  >
                    Uitslagverwerking herstellen
                  </button>
                  {match.boardId && (
                    <button
                      className="button ghost"
                      disabled={disabled}
                      onClick={() => act({ type: "release" })}
                    >
                      Baan vrijgeven
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function MatchInvitation({matchId}:{matchId:string}){
  const invite=usePolled<{invitation:{code:string;path:string}|null}>(`/api/matches/${matchId}/invitation`);
  const [copied,setCopied]=useState('');const invitation=invite.data?.invitation;
  if(!invitation)return null;
  return <div className="notice" aria-label="Wedstrijd uitnodiging"><strong>Wedstrijdcode: {invitation.code}</strong>{' '}
    <button className="button ghost small" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(new URL(invitation.path,location.origin).href);setCopied('Uitnodigingslink gekopieerd.');}catch{setCopied(`Kopiëren is niet gelukt. Gebruik ${location.origin}${invitation.path}`);}}}>Uitnodigingslink kopiëren</button>
    <span role="status">{copied}</span></div>;
}

function CompleteProfile({user}:{user:Profile}) {
  const [name,setName]=useState(validDisplayName(user.name)?user.name:'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function complete(event:FormEvent){
    event.preventDefault();setError('');setBusy(true);
    try{
      await request('/api/platform/actions',{requestId:crypto.randomUUID(),action:{type:'profile.update',name}});
      const target=location.pathname==='/inloggen'?safeNext(new URLSearchParams(location.search).get('next')):safeNext(location.pathname+location.search);
      hardNavigate(target==='/'?'/app':target);
    }catch(error){setError(error instanceof Error?error.message:'Opslaan is niet gelukt.');}finally{setBusy(false);}
  }
  return <div className="auth-page"><div className="auth-brand"><img src="/assets/dartflow-logo.svg" alt="DartFlow" /></div>
    <form className="auth-card" onSubmit={complete}><Badge>REGISTRATIE AFRONDEN</Badge><h1>Kies je gebruikersnaam</h1>
      <p>Je gebruikersnaam is uniek in heel DartFlow. Hoofdletters maken geen verschil. Deze naam zien andere spelers in de lobby, de wedstrijd en op het scorebord. Bevestig het voorstel of kies een andere naam.</p>
      <label className="field">Gebruikersnaam<input name="name" autoComplete="username" required maxLength={80} value={name} onChange={event=>setName(event.target.value)} disabled={busy} /></label>
      {error&&<div className="notice error" role="alert">{error}</div>}
      <button className="button gold full" disabled={busy||!validDisplayName(name)}>{busy?'Gebruikersnaam opslaan…':'Gebruikersnaam bevestigen en verder'}</button>
    </form></div>;
}

function ShortInvitation({code}:{code:string}){
  const [error,setError]=useState('');const started=useRef(false);
  useEffect(()=>{if(started.current)return;started.current=true;
    void request<{id:string;kind:string}>('/api/platform/actions',{requestId:crypto.randomUUID(),action:{type:'invitation.resolve',code}})
      .then(result=>{const section:Record<string,string>={lobby:'lobby',club:'clubs',room:'community',league:'leagues',tournament:'tournaments'};const path=section[result.kind];if(!path)throw new Error('Deze uitnodiging is niet beschikbaar.');hardNavigate(`/app/${path}/${result.id}?code=${encodeURIComponent(code.toUpperCase())}`);})
      .catch(error=>setError(error instanceof Error?error.message:'De uitnodiging is niet beschikbaar.'));
  },[code]);
  return <div className="auth-page"><div className="auth-card"><h1>Uitnodiging {code.toUpperCase()}</h1>{error?<div className="notice error" role="alert">{error}</div>:<p>Uitnodiging openen…</p>}<a className="button ghost" href="/app/spelen">Terug naar spelen</a></div></div>;
}

function Login({ session }: { session: Session | null }) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [sent, setSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [next, setNext] = useState("/app");
  const [reauth, setReauth] = useState<"recent" | "otp" | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const recovery = params.get("reauth");
    setReauth(recovery === "otp" ? "otp" : recovery === "1" ? "recent" : null);
    const target = params.get("next");
    if (
      target?.startsWith("/") &&
      !target.startsWith("//") &&
      !target.includes("\\")
    )
      setNext(target);
    const callbackError = params.get("error");
    if (callbackError)
      setError(
        callbackError === "access_denied"
          ? "Google-inloggen is geannuleerd. Je kunt opnieuw proberen of e-mail gebruiken."
          : "Inloggen is niet gelukt. Probeer het opnieuw.",
      );
  }, []);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (sent) {
        const result = await request<{ next: string }>("/api/auth/verify", {
          email,
          token,
          next,
        });
        hardNavigate(result.next);
      } else {
        await request("/api/auth/otp", { email, next });
        setSent(true);
        setResendIn(60);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inloggen is niet gelukt.");
    } finally {
      setBusy(false);
    }
  }
  async function local(userId: string) {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ next: string }>("/api/auth/local", {
        userId,
        next,
      });
      hardNavigate(result.next);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Testaccount openen is niet gelukt.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-brand">
        <img src="/assets/dartflow-logo.svg" alt="Dartflow" />
        <p>SPEEL. ONTMOET. COMPETEER.</p>
      </div>
      <div className="auth-card">
        <Badge>WELKOM BIJ DARTFLOW</Badge>
        <h1>
          {reauth ? "Bevestig je aanmelding" : <>Jouw volgende partij<br />begint hier.</>}
        </h1>
        <p>
          {sent
            ? `Je ontvangt een inlogcode op ${email}. Controleer ook je spammap.`
            : reauth === "otp"
              ? "Meld je opnieuw aan met een e-mailcode om Google veilig uit te schakelen."
              : reauth
                ? "Meld je opnieuw aan met hetzelfde eigenaarsaccount om je beveiligde wijziging af te ronden."
            : "Eén account voor je club, de speeldag en je scorekaart."}
        </p>
        {reauth && <p className="notice">Voltooi een nieuwe aanmelding. Laat het oorspronkelijke tabblad Integraties open en keer daarna terug naar dat tabblad om je instellingen opnieuw op te slaan.</p>}
        <form onSubmit={submit}>
          <label className="field" htmlFor="login-email">
            E-mailadres
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy || sent}
              placeholder="jij@voorbeeld.nl"
            />
          </label>
          {sent && (
            <>
              <label className="field" htmlFor="login-token">
                Inlogcode
                <input
                  id="login-token"
                  className="otp-input"
                  type="text"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  minLength={6}
                  maxLength={10}
                  required
                  autoFocus
                  aria-describedby="login-token-help"
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <p id="login-token-help" className="muted-copy">
                Neem de volledige code uit je e-mail over.
              </p>
            </>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <button className="button gold full" disabled={busy}>
            {busy
              ? "Even geduld…"
              : sent
                ? "Code bevestigen"
                : "Stuur mij een inlogcode"}
            <Icon name="arrow" />
          </button>
          {sent && (
            <div className="resend-row">
              <button
                type="button"
                className="text-button"
                disabled={busy || resendIn > 0}
                onClick={() => {
                  setSent(false);
                  setToken("");
                  setError("");
                }}
              >
                {resendIn > 0
                  ? `Opnieuw versturen over ${resendIn}s`
                  : "Ander e-mailadres of opnieuw versturen"}
              </button>
            </div>
          )}
        </form>
        {!sent && reauth !== "otp" && (
          <>
            <div className="auth-divider">
              <span>of</span>
            </div>
            <a
              className="button google full"
              href={`/api/auth/google?next=${encodeURIComponent(next)}${reauth ? "&reauth=1" : ""}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.3 2.9-7.5Z"
                />
                <path
                  fill="#34A853"
                  d="M12 22c2.7 0 5-.9 6.7-2.5l-3.3-2.6c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.2H3v2.7A10 10 0 0 0 12 22Z"
                />
                <path
                  fill="#FBBC05"
                  d="M6.4 13.6a6 6 0 0 1 0-3.2V7.7H3a10 10 0 0 0 0 8.6Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 6.2c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.7l3.4 2.7C7.2 8 9.4 6.2 12 6.2Z"
                />
              </svg>
              Doorgaan met Google
            </a>
          </>
        )}
        {session?.user && !reauth && (
          <a className="text-link auth-back" href={next}>
            Terug als {session.user.name}
            <Icon name="arrow" />
          </a>
        )}
      </div>
      {session?.local && (
        <div className="local-auth">
          <div className="local-auth-title">
            <Icon name="shield" />
            <div>
              <strong>Lokale testomgeving</strong>
              <p>Kies een testaccount om de serverpilot te doorlopen.</p>
            </div>
          </div>
          <div className="local-users">
            {session.localUsers?.map((user) => (
              <button
                disabled={busy}
                key={user.id}
                onClick={() => void local(user.id)}
              >
                <Avatar name={user.name} />
                <span>
                  <strong>{user.name}</strong>
                  <small>
                    {user.role === "organizer" ? "Wedstrijdleiding" : "Speler"}
                  </small>
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="auth-footer">DartFlow · DG Webservices</p>
    </div>
  );
}

function PublicScreen({ token }: { token: string }) {
  const live = usePolled<PublicSnapshot>(
    `/api/screen/${encodeURIComponent(token)}`,
  );
  const data = live.data;
  const cue = useOcheCelebration(data, Boolean(data) && !live.stale);
  const match = data?.match;
  const winner = match?.players.find((p) => p.id === match.winnerId);
  if (data?.match)
    return (
      <SprintDisplay
        snapshot={data}
        stale={live.stale}
        overlay={<OcheCelebration cue={cue} />}
        activityOverlay={<BoardActivityNotice activity={data.boardActivity} display offline={live.stale} onRefresh={live.refresh}/>}
        qr={
          <QR
            path={`/baan/${encodeURIComponent(data.board.id)}`}
            label="Open de score-invoer"
          />
        }
      />
    );
  return (
    <main className="public-screen">
      <div className="screen-frame" style={{containerType:"inline-size"}}>
        <OcheCelebration cue={cue} />
        <header className="public-screen-header">
          <img src="/assets/dartflow-logo.svg" alt="Dartflow" />
          <Connection stale={live.stale} updated={live.updated} />
        </header>
        {!data ? (
          <div className="screen-wait">
            <img src="/assets/dartboard.svg" alt="" />
            <h1>
              {live.error ? "Scherm niet beschikbaar" : "Verbinding maken…"}
            </h1>
            <p>{live.error || "De actuele baanstand ophalen."}</p>
          </div>
        ) : (
          <>
            <div className="screen-context">
              <span>{data.event.name}</span>
              <h1>{data.board.name}</h1>
              <Badge live={match?.status === "live"}>
                {match ? labels[match.status] : "Klaar voor de volgende partij"}
              </Badge>
            </div>
            {match ? (
              <>
                <div className="screen-scoreboard">
                  {match.players.map((p, i) => (
                    <div
                      className={`screen-player ${match.turn === i && match.status === "live" ? "active" : ""}`}
                      key={p.id}
                    >
                      <div className="screen-player-name">
                        <span>
                          {match.turn === i && match.status === "live"
                            ? "▶"
                            : ""}
                        </span>
                        {p.name}
                      </div>
                      <strong>{match.remaining[i]}</strong>
                      <div>
                        <span>
                          LEGS <b>{match.legs[i]}</b>
                        </span>
                        <span>
                          SETS <b>{match.sets[i]}</b>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {match.checkout && match.status === "live" && (
                  <div className="screen-checkout">
                    <span>CHECKOUT</span>
                    <strong>{match.checkout}</strong>
                  </div>
                )}
                {["result", "confirmed", "disputed"].includes(match.status) && (
                  <div className="screen-result">
                    <Icon name="check" />
                    <h2>
                      {winner ? `${winner.name} wint` : "Partij uitgespeeld"}
                    </h2>
                    <p>
                      {match.status === "confirmed"
                        ? "Uitslag bevestigd"
                        : match.status === "disputed"
                          ? "Uitslag in beoordeling"
                          : "Wacht op bevestiging van beide spelers"}
                    </p>
                  </div>
                )}
                <div className="screen-visits">
                  <span>LAATSTE BEZOEKEN</span>
                  <div>
                    {match.visits
                      .slice(-4)
                      .reverse()
                      .map((v, i) => (
                        <p key={i}>
                          <span>{match.players[v.playerIndex]?.name}</span>
                          <b>{v.bust ? "BUST" : v.score}</b>
                        </p>
                      ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="screen-wait free">
                <img src="/assets/dartboard.svg" alt="" />
                <h2>De baan is van jullie.</h2>
                <p>
                  Scan de QR-code met je telefoon.
                  <br />
                  Jouw partij verschijnt zodra de wedstrijdleiding je oproept.
                </p>
              </div>
            )}
            <div className="screen-qr">
              <QR
                path={`/baan/${encodeURIComponent(data.board.id)}`}
                label="Open de scorekaart"
              />
            </div>
          </>
        )}
        <footer className="public-screen-footer">
          <span>SPEEL. ONTMOET. COMPETEER.</span>
          <span>DARTFLOW</span>
        </footer>
      </div>
    </main>
  );
}

function LegacyEventsPage({
  data,
  refresh,
}: {
  data: Overview;
  refresh: () => Promise<void>;
}) {
  return (
    <>
      <Heading kicker="SAMEN AAN HET BORD" title="Evenementen">
        Bekijk je speeldag, meld je aan en laat weten dat je er bent.
      </Heading>
      {data.events.length ? (
        data.events.map((event) => (
          <EventPanel
            event={event}
            data={data}
            refresh={refresh}
            key={event.id}
          />
        ))
      ) : (
        <div className="panel">
          <Empty title="De agenda staat nog open" icon="calendar">
            Voor deze omgeving zijn nog geen speeldagen gepland.
          </Empty>
        </div>
      )}
      <div className="button-row">
        <a className="button gold" href="/app/events">
          Competities & toernooien openen ↗
        </a>
      </div>
    </>
  );
}

function EventPanel({
  event,
  data,
  refresh,
  compact = false,
}: {
  event: EventView;
  data: Overview;
  refresh: () => Promise<void>;
  compact?: boolean;
}) {
  const entry = data.participants.find(
    (p) => p.eventId === event.id && p.playerId === data.profile.id,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const participants = data.participants.filter(
    (p) => p.eventId === event.id && p.status === "registered",
  );
  async function act(type: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/api/events/${event.id}/actions`, { type });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "De actie is niet gelukt.");
    } finally {
      setBusy(false);
    }
  }
  const date = new Date(event.date);
  const validDate = !isNaN(date.getTime());
  return (
    <article className={`panel event-panel ${compact ? "compact" : ""}`}>
      <div className="event-date">
        <strong>{validDate ? date.getDate() : "—"}</strong>
        <span>
          {validDate
            ? date.toLocaleDateString("nl-NL", { month: "short" })
            : "PILOT"}
        </span>
      </div>
      <div className="event-body">
        <div className="event-kicker">
          <span>SPEELDAG</span>
          {entry?.checkedIn ? (
            <Badge live>Ingecheckt</Badge>
          ) : entry?.status === "registered" ? (
            <Badge>Ingeschreven</Badge>
          ) : entry?.status === "waitlisted" ? (
            <Badge>Wachtlijst</Badge>
          ) : null}
        </div>
        <h3>{event.name}</h3>
        <p>
          <Icon name="users" />
          {participants.length} / {event.capacity} spelers<span>·</span>
          {data.clubs.find((c) => c.id === event.clubId)?.name ||
            data.currentClub?.name ||
            "Clubomgeving"}
        </p>
        {!compact && (
          <p className="event-description">
            Meld je aan, check op locatie in en houd je oproep in de gaten. De
            wedstrijdleiding zet je partij klaar op de baan.
          </p>
        )}
        <div className="button-row">
          {!entry || entry.status === "withdrawn" ? (
            <button
              disabled={busy}
              className="button gold small"
              onClick={() => void act("register")}
            >
              {participants.length >= event.capacity
                ? "Op de wachtlijst"
                : "Aanmelden"}
              <Icon name="arrow" />
            </button>
          ) : (
            <>
              {entry.status === "registered" && !entry.checkedIn && (
                <button
                  disabled={busy}
                  className="button gold small"
                  onClick={() => void act("check-in")}
                >
                  <Icon name="check" />
                  Ik ben aanwezig
                </button>
              )}
              <button
                disabled={busy}
                className="button ghost small"
                onClick={() => void act("withdraw")}
              >
                Afmelden
              </button>
            </>
          )}
          {event.canManage && (
            <a className="button ghost small" href="/wedstrijdleiding">
              Naar wedstrijdleiding
              <Icon name="arrow" />
            </a>
          )}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

function LegacyHistoryPage({ data }: { data: Overview }) {
  const personal = usePolled<{ history: ResultView[] }>("/api/platform");
  const history = personal.data?.history || data.history;
  return (
    <>
      <Heading kicker="ELKE WEDSTRIJD EEN VERHAAL" title="Wedstrijdhistorie">
        Bevestigde uitslagen uit de gekozen omgeving.
      </Heading>
      {history.length ? (
        <div className="panel table-panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Wedstrijd</th>
                  <th>Legs</th>
                  <th>Sets</th>
                  <th>Uitslag</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {history.map((result) => (
                  <tr key={result.matchId}>
                    <td>
                      <strong>
                        {result.players.map((p) => p.name).join(" — ")}
                      </strong>
                    </td>
                    <td>{result.legs.join(" — ")}</td>
                    <td>{result.sets.join(" — ")}</td>
                    <td>
                      <Badge live>
                        {result.players.find((p) => p.id === result.winnerId)
                          ?.name || "Gelijkspel"}
                      </Badge>
                    </td>
                    <td>
                      <a
                        className="text-link"
                        href={`/wedstrijd/${result.matchId}`}
                      >
                        Bekijken
                        <Icon name="arrow" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="panel">
          <Empty title="Je eerste uitslag wacht op je" icon="history">
            Na de bevestiging door beide spelers verschijnt een wedstrijd hier
            automatisch.
          </Empty>
          <div className="center">
            <a href="/spelen" className="button gold">
              Naar Spelen
              <Icon name="arrow" />
            </a>
          </div>
        </div>
      )}
      {data.standings.length > 0 && (
        <>
          <SectionHeading title="Stand van de speeldag" />
          <div className="panel table-panel">
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
                  {data.standings.map((p, i) => (
                    <tr key={p.playerId}>
                      <td className="gold-text">{i + 1}</td>
                      <td>{p.name}</td>
                      <td>{p.played}</td>
                      <td>{p.won}</td>
                      <td>
                        <strong>{p.points}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
