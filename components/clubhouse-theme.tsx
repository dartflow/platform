"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ThemeView, ThemeCommand } from "@/lib/clubhouse-types";

type Context = {
  view: ThemeView | null;
  refresh: () => Promise<void>;
  choose: (
    mode: "auto" | "dartflow" | "club",
    clubId: string | null,
    colorMode?: "system" | "light" | "dark",
  ) => Promise<void>;
  busy: boolean;
  error: string;
  dark: boolean;
};
const ThemeContext = createContext<Context>({
  view: null,
  refresh: async () => {},
  choose: async () => {},
  busy: false,
  error: "",
  dark: true,
});
export const useClubhouseTheme = () => useContext(ThemeContext);
const tokenNames: Record<string, string> = {
  background: "--ch-bg",
  surface: "--ch-surface",
  surfaceRaised: "--ch-raised",
  border: "--ch-border",
  text: "--ch-text",
  muted: "--ch-muted",
  primary: "--ch-primary",
  onPrimary: "--ch-on-primary",
  secondary: "--ch-secondary",
  focus: "--ch-focus",
  success: "--ch-success",
  warning: "--ch-warning",
  error: "--ch-error",
};
async function api<T>(url: string, command?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    ...(command
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error ?? "De thema-instellingen zijn niet beschikbaar.",
    );
  return data;
}
/** A personal theme is never mounted on shared Oche, cast or public board pages. */
export function ClubhouseThemeProvider({
  clubId,
  children,
}: {
  clubId?: string;
  children: ReactNode;
}) {
  const [view, setView] = useState<ThemeView | null>(null),
    [loaded, setLoaded] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [systemDark, setSystemDark] = useState(true);
  const contextKey = clubId ?? "",
    generation = useRef(0),
    mounted = useRef(true);
  const stopRequests = useCallback(() => {
    mounted.current = false;
    generation.current++;
  }, []);
  const refresh = useCallback(async () => {
    const n = ++generation.current;
    try {
      const next = await api<ThemeView>(
        `/api/theme${clubId ? `?clubId=${encodeURIComponent(clubId)}` : ""}`,
      );
      if (
        !next?.effective?.tokens?.dark ||
        !next?.effective?.tokens?.light ||
        !next.preference ||
        !Array.isArray(next.options) ||
        !Number.isFinite(Date.parse(next.effective.validUntil))
      )
        throw new Error(
          "De thema-instellingen zijn niet beschikbaar. De standaardstijl blijft actief.",
        );
      if (mounted.current && n === generation.current) {
        setView(next);
        setLoaded(clubId ?? "");
        setError("");
      }
    } catch (e) {
      if (mounted.current && n === generation.current) {
        setView(null);
        setLoaded(clubId ?? "");
        setError((e as Error).message);
      }
    }
  }, [clubId]);
  useEffect(() => {
    mounted.current = true;
    setView(null);
    setLoaded("\u0000");
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      stopRequests();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh, stopRequests]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(media.matches);
    const listener = () => setSystemDark(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    if (!view) return;
    const remaining = Date.parse(view.effective.validUntil) - Date.now();
    if (remaining <= 0) {
      setView(null);
      return;
    }
    const timeout = setTimeout(
      () => {
        setView(null);
        void refresh();
      },
      Math.min(remaining, 2147483647),
    );
    return () => clearTimeout(timeout);
  }, [view, refresh]);
  const dark =
    view?.preference.colorMode === "dark" ||
    ((view?.preference.colorMode ?? "system") === "system" && systemDark);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.dartflowTheme = dark ? "dark" : "light";
    const tokens = view?.effective.tokens[dark ? "dark" : "light"];
    Object.entries(tokenNames).forEach(([name, css]) => {
      if (tokens)
        root.style.setProperty(css, tokens[name as keyof typeof tokens]);
      else root.style.removeProperty(css);
    });
    return () => {
      delete root.dataset.dartflowTheme;
      Object.values(tokenNames).forEach((css) =>
        root.style.removeProperty(css),
      );
    };
  }, [view, dark]);
  const choose = async (
    mode: "auto" | "dartflow" | "club",
    selected: string | null,
    colorMode = view?.preference.colorMode ?? "system",
  ) => {
    if (!view || busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<ThemeView>("/api/theme/actions", {
        requestId: crypto.randomUUID(),
        expectedRevision: view.preference.revision,
        action: { type: "preference", mode, clubId: selected, colorMode },
      } satisfies ThemeCommand);
      generation.current++;
      if (clubId) {
        setView((previous) =>
          previous ? { ...previous, preference: next.preference } : previous,
        );
        await refresh();
      } else setView(next);
      window.dispatchEvent(new Event("dartflow-theme-changed"));
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  if (loaded !== contextKey)
    return (
      <div className="app-loading">
        <img src="/assets/dartflow-logo.svg" alt="DartFlow" />
        <p>Jouw omgeving openen…</p>
      </div>
    );
  return (
    <ThemeContext.Provider value={{ view, refresh, choose, busy, error, dark }}>
      <div className="dartflow-themed">{children}</div>
    </ThemeContext.Provider>
  );
}
export function ClubhouseHeaderLogo() {
  const { dark } = useClubhouseTheme();
  return (
    <img
      src={
        dark
          ? "/assets/dartflow-logo.svg"
          : "/assets/dartflow-logo-on-light.svg"
      }
      alt="DartFlow"
    />
  );
}
export function ThemePreferencePicker() {
  const { view, choose, busy, error } = useClubhouseTheme();
  if (!view)
    return (
      <p>
        De standaard DartFlow-stijl is actief. Vernieuw om je voorkeuren op te
        halen.
      </p>
    );
  return (
    <section className="ch-theme-picker">
      <h3>Jouw uitstraling</h3>
      <p>
        Op een verenigingspagina geldt de stijl van die vereniging. Hier kies je
        de uitstraling van je persoonlijke DartFlow.
      </p>
      {view.needsChoice && (
        <p className="notice">
          Kies een beschikbare clubhuisstijl of behoud DartFlow. Een eerdere
          keuze wordt niet automatisch door een andere vereniging vervangen.
        </p>
      )}
      <label className="field">
        Uitstraling
        <select
          disabled={busy}
          value={
            view.preference.mode === "club"
              ? `club:${view.preference.clubId}`
              : view.preference.mode
          }
          onChange={(e) =>
            void choose(
              e.target.value.startsWith("club:")
                ? "club"
                : (e.target.value as "auto" | "dartflow"),
              e.target.value.startsWith("club:")
                ? e.target.value.slice(5)
                : null,
            )
          }
        >
          {view.preference.mode === "club" &&
            !view.options.some(
              (option) => option.clubId === view.preference.clubId,
            ) && (
              <option value={`club:${view.preference.clubId}`} disabled>
                Eerdere clubhuisstijl niet meer beschikbaar
              </option>
            )}
          <option value="dartflow">Standaard DartFlow</option>
          <option value="auto">
            Automatisch bij één beschikbare vereniging
          </option>
          {view.options.map((option) => (
            <option value={`club:${option.clubId}`} key={option.clubId}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Licht of donker
        <select
          disabled={busy}
          value={view.preference.colorMode}
          onChange={(e) =>
            void choose(
              view.preference.mode,
              view.preference.clubId,
              e.target.value as "system" | "light" | "dark",
            )
          }
        >
          <option value="system">Volg mijn toestel</option>
          <option value="dark">Donker</option>
          <option value="light">Licht</option>
        </select>
      </label>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
