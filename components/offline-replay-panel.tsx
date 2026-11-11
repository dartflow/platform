"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchAction } from "@/lib/types";
type Command = {
  requestId: string;
  matchId: string;
  expectedRevision: number;
  action: Extract<MatchAction, { type: "score" }> | { type: "undo" };
};
type Queue = { matchId: string; baseRevision: number; commands: Command[] };
export default function OfflineReplayPanel({
  matchId,
  revision,
  userId,
  enabled,
}: {
  matchId: string;
  revision: number;
  userId: string;
  enabled: boolean;
}) {
  const key = `dartflow-regie-offline:${userId}:${matchId}`;
  const [queue, setQueue] = useState<Queue | null>(null),
    [score, setScore] = useState(""),
    [double, setDouble] = useState(false),
    [darts, setDarts] = useState("3"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const current = useRef<Queue | null>(null);
  const syncing = useRef(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      const saved = raw ? (JSON.parse(raw) as Queue) : null;
      if (
        saved?.matchId === matchId &&
        Array.isArray(saved.commands) &&
        saved.commands.length <= 100
      ) {
        current.current = saved;
        setQueue(saved);
      }
    } catch {
      /* Corrupt storage is never replayed. */
    }
  }, [key, matchId]);
  const save = useCallback(
    (value: Queue | null) => {
      current.current = value;
      setQueue(value);
      if (value?.commands.length)
        sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    },
    [key],
  );
  const replay = useCallback(async () => {
    const value = current.current;
    if (!value?.commands.length || syncing.current || !navigator.onLine) return;
    syncing.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/platform/matches/${encodeURIComponent(matchId)}/replay`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "De wachtrij kon niet worden hersteld.");
      const accepted = new Set<string>(data.accepted);
      const remaining = value.commands.filter(
        (command) => !accepted.has(command.requestId),
      );
      save(
        remaining.length
          ? {
              matchId,
              baseRevision: remaining[0].expectedRevision,
              commands: remaining,
            }
          : null,
      );
      if (data.conflict)
        setError(
          data.conflict.message ||
            "De basisstand is gewijzigd. De niet bevestigde acties blijven bewaard.",
        );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Geen verbinding. De acties blijven op dit toestel bewaard.",
      );
    } finally {
      syncing.current = false;
      setBusy(false);
    }
  }, [matchId, save]);
  useEffect(() => {
    const wake = () => {
      if (current.current?.commands.length) void replay();
    };
    window.addEventListener("online", wake);
    return () => window.removeEventListener("online", wake);
  }, [replay]);
  function add(action: Command["action"]) {
    if (busy || !enabled) return;
    const previous = current.current;
    const next: Queue = previous || {
      matchId,
      baseRevision: revision,
      commands: [],
    };
    if (next.commands.length >= 100) {
      setError("De wachtrij is vol. Herstel eerst de verbinding.");
      return;
    }
    const command: Command = {
      requestId: crypto.randomUUID(),
      matchId,
      expectedRevision: next.baseRevision + next.commands.length,
      action,
    };
    save({ ...next, commands: [...next.commands, command] });
    setScore("");
    setDouble(false);
    setError("");
  }
  if (!enabled && !queue) return null;
  return (
    <details className="panel offline-replay-panel">
      <summary>Offline schrijftablet · toernooiregie</summary>
      <p className="muted-copy">
        Deze wachtrij hoort bij deze ene toernooipartij. De gedeelde score
        blijft de laatst bevestigde stand totdat de server de acties in volgorde
        heeft aanvaard. Gebruik deze invoer uitsluitend als schrijftablet voor
        toernooiregie.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add({
            type: "score",
            score: Number(score),
            darts: Number(darts),
            doubleConfirmed: double,
          });
        }}
      >
        <div className="field-grid">
          <label className="field">
            Score voor offline wachtrij
            <input
              type="number"
              min="0"
              max="180"
              required
              inputMode="numeric"
              value={score}
              onChange={(e) => setScore(e.target.value)}
              disabled={busy || !enabled}
            />
          </label>
          <label className="field">
            Darts
            <select value={darts} onChange={(e) => setDarts(e.target.value)}>
              {[1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="workspace-checkbox">
          <input
            type="checkbox"
            checked={double}
            onChange={(e) => setDouble(e.target.checked)}
          />
          Finish op dubbel bevestigd
        </label>
        <div className="button-row">
          <button className="button gold" disabled={busy || !enabled}>
            Beurt in wachtrij bewaren
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={() => add({ type: "undo" })}
            disabled={busy || !enabled}
          >
            Undo in wachtrij bewaren
          </button>
        </div>
      </form>
      {queue && (
        <>
          <p role="status">
            <strong>{queue.commands.length} acties bewaard</strong> ·
            basisrevisie {queue.baseRevision}
          </p>
          <ol className="offline-queue">
            {queue.commands.map((c) => (
              <li key={c.requestId}>
                {c.action.type === "score"
                  ? `${c.action.score} punten · ${c.action.darts || 3} darts`
                  : "Vorige beurt corrigeren"}{" "}
                · revisie {c.expectedRevision}
              </li>
            ))}
          </ol>
          <div className="button-row">
            <button
              className="button gold"
              type="button"
              disabled={busy}
              onClick={() => void replay()}
            >
              {busy ? "Herstellen…" : "Wachtrij gecontroleerd herstellen"}
            </button>
            <button
              className="button ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Alle niet bevestigde tabletacties voor deze partij verwijderen?",
                  )
                )
                  save(null);
              }}
            >
              Wachtrij verwerpen
            </button>
          </div>
        </>
      )}
    </details>
  );
}
