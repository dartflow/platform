"use client";

import { useEffect, useState } from "react";
import type { MatchView, PublicSnapshot } from "@/lib/types";
import SprintDisplay from "./sprint-display";
import OcheCelebration, {useOcheCelebration} from "./oche-celebration";
import PublicCast from "./public-cast";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const grant = /^(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9_-]{64})$/;

/** Old links retain their identity; private UUIDs never become public grants. */
export default function ReadOnlyAlias({
  id,
  overlay,
}: {
  id: string;
  overlay: boolean;
}) {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  const [cast, setCast] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  const [stale, setStale] = useState(false);
  const cue = useOcheCelebration(snapshot, Boolean(snapshot) && !stale && !overlay);
  useEffect(() => {
    if (!overlay) return;
    document.body.classList.add("readonly-alias-output");
    return () => {
      document.body.classList.remove("readonly-alias-output");
    };
  }, [overlay]);
  useEffect(() => {
    let stopped = false,
      castResolved = false,
      refreshing = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (castResolved || refreshing) return;
      if (!uuid.test(id) && !grant.test(id)) {
        setError(
          "Deze oude schermlink verwijst niet naar een bestaande wedstrijd of schermkoppeling.",
        );
        return;
      }
      refreshing = true;
      try {
        const response = await fetch(
          uuid.test(id) ? `/api/matches/${id}` : `/api/screen/${id}`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = await response.json();
        if (!response.ok) {
          if (grant.test(id) && response.status === 404) {
            const castResponse = await fetch(`/api/platform/cast/${id}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            if (castResponse.ok) {
              castResolved = true;
              if (!stopped) setCast(true);
              return;
            }
          }
          if (!stopped && [401, 403, 404, 410].includes(response.status)) {
            setSnapshot(null);
            setLogin(response.status === 401);
          }
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "Deze schermlink is niet beschikbaar.",
          );
        }
        let projection: PublicSnapshot;
        if (uuid.test(id)) {
          const match = result as MatchView;
          let board = { id: match.boardId || "", name: "Wedstrijdscherm" };
          let event = { name: "Live wedstrijd" };
          if (match.boardId) {
            const context = await fetch(
              `/api/boards/${encodeURIComponent(match.boardId)}`,
              { cache: "no-store", signal: controller.signal },
            );
            if (context.ok) {
              const actual = await context.json();
              board = { id: actual.board.id, name: actual.board.name };
              event = { name: actual.event.name };
            }
          }
          const playerId = (value: string | null) =>
            value === null
              ? null
              : `player-${match.players.findIndex((p) => p.id === value) + 1}`;
          projection = {
            board,
            event,
            match: {
              id: match.id,
              revision: match.revision,
              status: match.status,
              players: match.players.map((player, index) => ({
                id: `player-${index + 1}`,
                name: player.name,
              })),
              remaining: match.remaining,
              legs: match.legs,
              sets: match.sets,
              turn: match.turn,
              checkout: match.checkout,
              visits: match.visits.map((visit) => ({
                ...visit,
                player: `player-${visit.playerIndex + 1}`,
              })),
              winnerId: playerId(match.winnerId),
              writerId: playerId(match.writerId) || "writer-external",
              resultPublished: match.resultPublished,
              settings: match.settings,
              stats: match.stats,
              legNumber: match.legNumber,
              setNumber: match.setNumber,
              paused: match.paused,
            },
          };
        } else projection = result as PublicSnapshot;
        if (!stopped) {
          setSnapshot(projection);
          setError("");
          setLogin(false);
          setStale(document.visibilityState !== "visible" || !navigator.onLine);
        }
      } catch (cause) {
        if (!stopped) {
          setStale(true);
          setError(
            cause instanceof Error
              ? cause.message
              : "De verbinding is onderbroken.",
          );
        }
      } finally {
        refreshing = false;
      }
    };
    const disconnected = () => setStale(true);
    const visibility = () => {
      if (document.visibilityState === "visible") void refresh();
      else disconnected();
    };
    window.addEventListener("offline", disconnected);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visibility);
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 1500);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visibility);
      controller.abort();
    };
  }, [id, overlay]);
  if (cast) return <PublicCast token={id} transparent={overlay} />;
  if (!snapshot?.match)
    return (
      <main className="public-screen">
        <div className="screen-frame" style={{containerType:"inline-size"}}>
          <OcheCelebration cue={cue} />
          <div className="screen-wait">
            <img src="/assets/dartflow-logo.svg" alt="DartFlow" />
            <h1>
              {error
                ? "Scherm niet beschikbaar"
                : snapshot
                  ? "Klaar voor de volgende partij"
                  : "Verbinding maken…"}
            </h1>
            <p>
              {error || snapshot?.board.name || "De actuele wedstrijd ophalen."}
            </p>
            {login && (
              <a
                className="button gold"
                href={`/inloggen?next=${encodeURIComponent(typeof location === "undefined" ? "/app" : location.pathname)}`}
              >
                Inloggen om deze wedstrijd te bekijken
              </a>
            )}
          </div>
        </div>
      </main>
    );
  if (overlay)
    return (
      <main
        className="readonly-overlay"
        aria-label="Alleen-lezen wedstrijd-overlay"
      >
        <img src="/assets/dartflow-logo.svg" alt="DartFlow" />
        {snapshot.match.players.map((player, index) => (
          <div
            key={player.id}
            className={snapshot.match?.turn === index ? "active" : ""}
          >
            <strong>{player.name}</strong>
            <span>{snapshot.match?.remaining[index]}</span>
            <small>{snapshot.match?.legs[index]} legs</small>
          </div>
        ))}
        <p>
          {stale
            ? "Verbinding herstellen…"
            : snapshot.match.paused
              ? "Gepauzeerd"
              : snapshot.match.checkout || snapshot.board.name}
        </p>
      </main>
    );
  return (
    <SprintDisplay
      snapshot={snapshot}
      stale={stale}
      overlay={<OcheCelebration cue={cue} />}
      qr={<span>Alleen kijken · geen scorebediening</span>}
    />
  );
}
