"use client";
import { useEffect, useRef, useState } from "react";
import type { Overview } from "@/lib/types";
type Entry = {
  id: string;
  name: string;
  ownerId: string;
  kind: string;
  members: { id: string; name: string; status: string; role: string }[];
  canManage: boolean;
};
type Data = {
  profile: { id: string };
  players: { id: string; name: string }[];
  clubs: Entry[];
  rooms: Entry[];
  leagues: Entry[];
  tournaments: Entry[];
  lobbies: Entry[];
  friends: { id: string; name: string; status: string }[];
};
export default function WorkspaceTools({
  overview,
}: {
  overview: Overview | null;
}) {
  const [mode, setMode] = useState(""),
    [query, setQuery] = useState(""),
    [data, setData] = useState<Data | null>(null),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (mode) {
      element?.showModal();
      input.current?.focus();
    } else element?.close();
  }, [mode]);
  useEffect(() => {
    if (!mode) return;
    let stopped = false;
    fetch("/api/platform", { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json();
        if (!response.ok)
          throw new Error(value.error || "De gegevens zijn niet beschikbaar.");
        if (!stopped) {
          setData(value);
          setError("");
        }
      })
      .catch((error) => {
        if (!stopped) setError(error.message);
      });
    return () => {
      stopped = true;
    };
  }, [mode]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMode("search");
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const entries = data
    ? [
        ...data.clubs.map((e) => ({
          label: e.name,
          type: "Vereniging",
          href: `/app/clubs/${e.id}`,
        })),
        ...data.rooms.map((e) => ({
          label: e.name,
          type: "Kamer",
          href: `/app/community/${e.id}`,
        })),
        ...data.leagues.map((e) => ({
          label: e.name,
          type: "Competitie",
          href: `/app/leagues/${e.id}`,
        })),
        ...data.tournaments.map((e) => ({
          label: e.name,
          type: "Toernooi",
          href: `/app/hall/${e.id}`,
        })),
        ...data.players.map((e) => ({
          label: e.name,
          type: "Speler",
          href: `/app/practice?opponent=${e.id}`,
        })),
      ]
    : [];
  const notifications = data
    ? [
        ...data.friends
          .filter((f) => f.status === "incoming")
          .map((f) => ({
            label: `${f.name} wil vrienden worden`,
            type: "Vriendschapsverzoek",
            href: "/app/friends",
          })),
        ...data.lobbies
          .filter((e) =>
            e.members.some(
              (m) => m.id === data.profile.id && m.status === "invited",
            ),
          )
          .map((e) => ({
            label: e.name,
            type: "Wedstrijduitnodiging",
            href: `/app/lobby/${e.id}`,
          })),
        ...data.clubs
          .filter((e) => e.canManage)
          .flatMap((e) =>
            e.members
              .filter((m) => m.status === "pending")
              .map((m) => ({
                label: `${m.name} · ${e.name}`,
                type: "Lidmaatschapsaanvraag",
                href: `/app/clubs/${e.id}`,
              })),
          ),
        ...(overview?.matches || [])
          .filter(
            (m) =>
              m.status === "result" &&
              m.players.some(
                (p, i) => p.id === data.profile.id && !m.confirmations[i],
              ),
          )
          .map((m) => ({
            label: m.players.map((p) => p.name).join(" — "),
            type: "Uitslag bevestigen",
            href: `/wedstrijd/${m.id}`,
          })),
      ]
    : [];
  const visible =
    mode === "notifications"
      ? notifications
      : query.trim()
        ? entries
            .filter((e) =>
              e.label
                .toLocaleLowerCase("nl-NL")
                .includes(query.trim().toLocaleLowerCase("nl-NL")),
            )
            .slice(0, 20)
        : [];
  return (
    <div className="workspace-tools">
      <button
        className="icon-button"
        aria-label="Zoeken"
        title="Zoeken (Ctrl+K)"
        onClick={() => setMode("search")}
      >
        <svg
          className="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 6 6" />
        </svg>
      </button>
      <button
        className="icon-button workspace-notifications-button"
        aria-label="Meldingen openen"
        title="Meldingen"
        onClick={() => setMode("notifications")}
      >
        <svg
          className="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M5 16h14l-2-3V9a5 5 0 0 0-10 0v4zm5 4h4" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        className="workspace-dialog"
        onCancel={() => setMode("")}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMode("");
        }}
      >
        <div className="workspace-dialog-inner">
          <div className="section-heading">
            <h2>
              {mode === "notifications" ? "Meldingen" : "Zoeken in DartFlow"}
            </h2>
            <button
              className="icon-button"
              aria-label="Zoeken en meldingen sluiten"
              onClick={() => setMode("")}
            >
              ×
            </button>
          </div>
          <div className="tabs">
            <button
              className={mode === "search" ? "active" : ""}
              onClick={() => setMode("search")}
            >
              Zoeken
            </button>
            <button
              className={mode === "notifications" ? "active" : ""}
              onClick={() => setMode("notifications")}
            >
              Meldingen
              {notifications.length ? ` (${notifications.length})` : ""}
            </button>
          </div>
          {mode === "search" && (
            <label className="field">
              Zoek een speler, vereniging of evenement
              <input
                ref={input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Begin met typen…"
              />
            </label>
          )}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {!data && !error ? (
            <p className="muted-copy">Actuele gegevens ophalen…</p>
          ) : visible.length ? (
            visible.map((entry, i) => (
              <a
                className="workspace-row"
                href={entry.href}
                key={`${entry.href}-${i}`}
              >
                <div>
                  <strong>{entry.label}</strong>
                  <small>{entry.type}</small>
                </div>
                <span aria-hidden="true">↗</span>
              </a>
            ))
          ) : (
            <p className="workspace-empty">
              {mode === "notifications"
                ? "Je hebt geen openstaande meldingen."
                : query
                  ? "Geen resultaten voor deze zoekopdracht."
                  : "Zoek binnen de gegevens waarvoor jouw account toegang heeft."}
            </p>
          )}
        </div>
      </dialog>
    </div>
  );
}
