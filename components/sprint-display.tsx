"use client";
import { useEffect, useRef, type ReactNode } from "react";
import type { PublicSnapshot, Stats } from "@/lib/types";

type SnapshotMatch = NonNullable<PublicSnapshot["match"]> & {
  stats?: Stats[];
  writerId?: string;
  legNumber?: number;
  setNumber?: number;
};
export default function SprintDisplay({
  snapshot,
  stale,
  qr,
  scanInstruction,
}: {
  snapshot: PublicSnapshot;
  stale: boolean;
  qr: ReactNode;
  scanInstruction?: string;
}) {
  const match = snapshot.match as SnapshotMatch;
  const scroll = useRef<HTMLDivElement>(null);
  const currentLeg =
    match.legNumber ||
    (match.legs[0] || 0) +
      (match.legs[1] || 0) +
      (match.status === "result" || match.status === "confirmed" ? 0 : 1);
  const columns = match.players.map((_, i) =>
    match.visits.filter((v) => v.playerIndex === i && v.leg === currentLeg),
  );
  const count = Math.max(5, ...columns.map((c) => c.length));
  const last = match.visits.at(-1);
  const finished = ["result", "confirmed", "disputed"].includes(match.status);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [match.revision]);
  return (
    <main
      className="sprint-display bf-display"
      aria-label="DartFlow Sprint-baanscherm"
    >
      <div className="bf-display__frame sprint-frame">
        <section
          className="sprint-board"
          data-solo={match.players.length === 1}
          aria-label="Sprint live scorebord"
        >
          <header className="sprint-head">
            <div className="sprint-top">
              <img src="/assets/dartflow-logo.svg" alt="DartFlow" />
              <h1 title={snapshot.board.name}>{snapshot.board.name}</h1>
              <span className="sprint-status" data-online={!stale}>
                {stale
                  ? "Offline"
                  : finished
                    ? "Uitslag"
                    : match.status === "live"
                      ? "Live"
                      : "Wacht"}
              </span>
            </div>
            <div className="sprint-context">
              <span>{snapshot.event.name}</span>
              <span>
                Leg {currentLeg} · Set{" "}
                {match.setNumber ||
                  Math.max(1, match.sets.reduce((a, b) => a + b, 0) + 1)}
              </span>
            </div>
          </header>
          <div className="sprint-roster">
            {match.players.map((player, i) => {
              const stats = match.stats?.[i];
              return (
                <div className="sprint-player" key={player.id}>
                  <span className="sprint-avatar" aria-hidden="true">
                    {player.name
                      .split(/\s+/)
                      .map((p) => p[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <h2 className="sprint-player-name" title={player.name}>
                    {player.name}
                  </h2>
                  <dl className="sprint-stats">
                    <div>
                      <dt>AVG</dt>
                      <dd>
                        {stats?.darts
                          ? ((stats.total / stats.darts) * 3).toFixed(1)
                          : "0.0"}
                      </dd>
                    </div>
                    <div>
                      <dt>H. FIN</dt>
                      <dd>{stats?.highestFinish || "–"}</dd>
                    </div>
                    <div>
                      <dt>180’s</dt>
                      <dd>{stats?.oneEighties || 0}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
          <div className="sprint-scores" aria-label="Resterende score">
            {match.players.map((player, i) => (
              <div
                className="sprint-score"
                key={player.id}
                data-active={i === match.turn && !finished}
                aria-label={player.name}
              >
                <span className="sprint-caption">Resterend</span>
                <strong className="sprint-number">{match.remaining[i]}</strong>
                <span className="sprint-turn">
                  {finished
                    ? "Uitgespeeld"
                    : i === match.turn
                      ? "● Aan de beurt"
                      : "Wacht"}
                </span>
              </div>
            ))}
          </div>
          <section
            className="sprint-countdown"
            aria-labelledby="sprint-scorecard-title"
          >
            <header className="sprint-card-heading">
              <h2 id="sprint-scorecard-title">Scorekaart</h2>
              <p>
                Set {match.setNumber || 1} · Leg {currentLeg}
              </p>
            </header>
            <div
              className="sprint-scroll"
              ref={scroll}
              tabIndex={0}
              role="region"
              aria-label="Beurten in deze leg"
            >
              <table
                className="sprint-table"
                aria-label={`Scorekaart van ${match.players.map((p) => p.name).join(" en ")}`}
              >
                <colgroup>
                  <col className="sprint-col-throw" />
                  <col className="sprint-col-rest" />
                  {match.players.length > 1 && (
                    <>
                      <col className="sprint-col-rest" />
                      <col className="sprint-col-throw" />
                    </>
                  )}
                </colgroup>
                <thead>
                  <tr className="sprint-labels">
                    <th>Worp</th>
                    <th>Rest</th>
                    {match.players.length > 1 && (
                      <>
                        <th>Rest</th>
                        <th>Worp</th>
                      </>
                    )}
                  </tr>
                  <tr className="sprint-start">
                    <td>–</td>
                    <td>{match.settings.startScore}</td>
                    {match.players.length > 1 && (
                      <>
                        <td>{match.settings.startScore}</td>
                        <td>–</td>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: count }, (_, i) => (
                    <tr key={i}>
                      {columns.map((column, side) => {
                        const visit = column[i];
                        const thrown = (
                          <td
                            className="sprint-throw"
                            data-bust={visit?.bust || false}
                            aria-label={
                              visit?.bust ? `${visit.score}, bust` : undefined
                            }
                          >
                            {visit?.score ?? ""}
                          </td>
                        );
                        const rest = (
                          <td
                            className="sprint-rest"
                            data-latest={Boolean(
                              visit && i === column.length - 1,
                            )}
                          >
                            {visit?.remainingAfter ?? ""}
                          </td>
                        );
                        return side === 0 ? (
                          <FragmentPair key={side}>
                            {thrown}
                            {rest}
                          </FragmentPair>
                        ) : (
                          <FragmentPair key={side}>
                            {rest}
                            {thrown}
                          </FragmentPair>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="sprint-tally" aria-label="Set- en legstand">
            {match.players.map((player, i) => (
              <FragmentPair key={player.id}>
                {i === 1 && (
                  <span className="sprint-vs" aria-hidden="true">
                    VS
                  </span>
                )}
                <div className="sprint-tally-side" aria-label={player.name}>
                  <span>
                    <b>{match.legs[i]}</b> Legs
                  </span>
                  {match.settings.bestOfSets > 1 && (
                    <span>
                      <b>{match.sets[i]}</b> Sets
                    </span>
                  )}
                </div>
              </FragmentPair>
            ))}
          </div>
          <aside className="sprint-insight">
            <span>
              {finished
                ? "Wedstrijduitslag"
                : match.checkout
                  ? "Finishroute"
                  : last?.score === 180
                    ? "Maximum"
                    : "Laatste beurt"}
            </span>
            <strong>
              {finished
                ? match.players.find((p) => p.id === match.winnerId)?.name ||
                  "Gelijkspel"
                : match.checkout ||
                  (last
                    ? `${last.score} punten${last.bust ? " · bust" : ""}`
                    : "Nog geen worpen")}
            </strong>
            <small>
              {finished
                ? match.status === "confirmed"
                  ? "Uitslag bevestigd"
                  : match.status === "disputed"
                    ? "In beoordeling"
                    : "Wacht op akkoord"
                : match.checkout
                  ? `${match.remaining[match.turn]} uit`
                  : last
                    ? match.players[last.playerIndex]?.name
                    : ""}
            </small>
          </aside>
          <footer className="sprint-foot">
            <div className="sprint-foot-copy">
              <p className="sprint-format">
                {match.settings.startScore} · Dubbel uit · Best of{" "}
                {match.settings.bestOfLegs} legs
              </p>
              <p className="sprint-writer">
                {scanInstruction || (match.writerId ? (
                  <>
                    <strong>
                      {match.players.find((p) => p.id === match.writerId)
                        ?.name || "Schrijver"}
                    </strong>{" "}
                    voert in
                  </>
                ) : (
                  "Score-invoer via telefoon"
                ))}
              </p>
            </div>
            <button
              className="bf-display__fullscreen"
              onClick={() => document.documentElement.requestFullscreen?.()}
              aria-label="Volledig scherm"
            >
              ⛶
            </button>
            <div className="sprint-qr">{qr}</div>
          </footer>
        </section>
      </div>
    </main>
  );
}
function FragmentPair({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
