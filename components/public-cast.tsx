"use client";
import { useEffect, useState } from "react";
type CastBoard = {
  id: string;
  name: string;
  blocked: boolean;
  match: null | {
    id: string;
    revision: number;
    status: string;
    players: { name: string }[];
    remaining: number[];
    legs: number[];
    turn: number;
  };
};
type Snapshot = {
  event: { id: string; name: string; revision: number; date: string;format?:string };
  cast: { scene: string; boardId?: string; updatedAt?: string };
  paused: boolean;
  champion?: string;
  consolation?: {title:string;completed:boolean;champion?:string|null;placings:{name:string;position:number}[];notice?:string};
  notice?:string|null;
  underReview?:boolean;
  boards: CastBoard[];
  fixtures: {
    id: string;
    players: string[];
    status: string;
    phase: string;
    purpose?: string;
    round: number;
    pool?: string;
    score?: number[];
    winner?: string;
    pairingNotice?: string;
    ready?:boolean;
  }[];
  standings: {
    name: string;
    played: number;
    won: number;
    drawn: number;
    points: number|null;
    position?:number;
    shared?:boolean;
    buchholz?:number;
    byes?:number;
    legsFor: number;
    legsAgainst: number;
  }[];
};
export default function PublicCast({
  token,
  transparent = false,
}: {
  token: string;
  transparent?: boolean;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [obs, setObs] = useState(false);
  useEffect(() => {
    const isTransparent =
      transparent || new URLSearchParams(location.search).get("view") === "obs";
    setObs(isTransparent);
    const oldBackground = document.body.style.background;
    if (isTransparent) document.body.style.background = "transparent";
    let stopped = false;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch(
          `/api/platform/cast/${encodeURIComponent(token)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const result = await response.json();
        if (
          !response.ok &&
          [403, 404, 410].includes(response.status) &&
          !stopped
        )
          setData(null);
        if (!response.ok)
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : "Dit scherm is niet beschikbaar.",
          );
        if (!stopped) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "De verbinding is onderbroken.",
          );
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
      controller.abort();
      document.body.style.background = oldBackground;
    };
  }, [token, transparent]);
  const scene = data?.cast.scene || "hall";
  const board =
    data?.boards.find((b) => b.id === data.cast.boardId) ||
    data?.boards.find((b) => b.match) ||
    data?.boards[0];
  const match = board?.match;
  return (
    <main
      className={`cast-output ${obs ? "cast-obs" : ""}`}
      aria-label="DartFlow zaalscherm"
    >
      <header className="cast-output-header">
        <img src="/assets/dartflow-logo.svg" alt="DartFlow" />
        <div>
          <h1>{data?.event.name || "DartFlow"}</h1>
          {data?.notice&&<p role="status">{data.notice}</p>}
          {!obs && (
            <span
              className={`connection ${error ? "offline" : ""}`}
              role="status"
            >
              <i />
              {error
                ? "Verbinding verbroken · laatste stand"
                : "Live programma"}
            </span>
          )}
        </div>
      </header>
      {!data ? (
        <div className="cast-output-wait">
          <h2>{error ? "Scherm niet beschikbaar" : "Programma ophalen…"}</h2>
          <p>{error}</p>
        </div>
      ) : ["break", "pause"].includes(scene) || data.paused ? (
        <div className="cast-output-wait">
          <p>EVEN PAUZE</p>
          <h2>We zijn zo weer terug.</h2>
        </div>
      ) : ["maximum", "180"].includes(scene) ? (
        <div className="cast-output-moment">
          <span>MAXIMUM</span>
          <strong>180</strong>
        </div>
      ) : scene === "finish" ? (
        <div className="cast-output-moment">
          <span>FINISH!</span>
          <strong>{match?.players[match.turn]?.name || "Dubbel raak"}</strong>
        </div>
      ) : scene === "result" ? (
        <div className="cast-output-moment">
          <span>UITSLAG</span>
          <strong>
            {data.champion ||
              match?.players.map((p) => p.name).join(" — ") ||
              "Resultaten volgen"}
          </strong>
          {match && <p>{match.legs.join(" — ")} legs</p>}
          {data.consolation?.completed&&<p>{data.consolation.title}: {data.consolation.champion||"Eindplaatsen volgen"}</p>}
        </div>
      ) : scene === "next" ? (
        <section className="cast-fixtures">
          <h2>Volgende partijen</h2>
          {data.fixtures
            .filter((f) => f.ready??!["confirmed", "finished", "bye", "void"].includes(f.status))
            .slice(0, 6)
            .map((f) => (
              <div key={f.id}>
                <strong>{f.players.join(" — ")}</strong>
                <span>
                  {f.purpose==='consolation'?(data.consolation?.title||'Troostbeker'):f.phase} · Ronde {f.round}
                </span>
                {f.pairingNotice&&<small>{f.pairingNotice}</small>}
              </div>
            ))}
        </section>
      ) : scene === "board" && match ? (
        <div className="cast-single-board">
          <h2>{board?.name}</h2>
          <div className="cast-live-score">
            {match.players.map((p, i) => (
              <div className={i === match.turn ? "active" : ""} key={i}>
                <h3>{p.name}</h3>
                <strong>{match.remaining[i]}</strong>
                <span>{match.legs[i]} legs</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <section className="cast-board-grid">
            {data.boards.length ? (
              data.boards.map((b) => (
                <article className="cast-board" key={b.id}>
                  <div className="section-heading">
                    <h2>{b.name}</h2>
                    <span className="badge muted">
                      {b.blocked ? "Geblokkeerd" : b.match ? "Live" : "Vrij"}
                    </span>
                  </div>
                  {b.match ? (
                    <div className="cast-live-score">
                      {b.match.players.map((p, i) => (
                        <div
                          className={i === b.match?.turn ? "active" : ""}
                          key={i}
                        >
                          <h3>{p.name}</h3>
                          <strong>{b.match?.remaining[i]}</strong>
                          <span>{b.match?.legs[i]} legs</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p>Klaar voor de volgende partij.</p>
                  )}
                </article>
              ))
            ) : (
              <div className="cast-output-wait">
                <h2>Het programma staat klaar.</h2>
                <p>Banen en partijen verschijnen zodra ze zijn ingepland.</p>
              </div>
            )}
          </section>
          {!obs && data.standings.length > 0 && (
            <section className="cast-standings">
              <h2>{data.event.format?.startsWith('double-elimination')?'Eindplaatsen':'Stand'}</h2>
              {data.standings.slice(0, 8).map((s, i) => (
                <div key={s.name}>
                  <span>{s.position??i+1}{s.shared?' =':''}</span>
                  <strong>{s.name}</strong>
                  <span>{s.played} gespeeld</span>
                  <b>{s.points===null?`Plaats ${s.position??i+1}${s.shared?' =':''}`:`${s.points} pt${s.buchholz===undefined?'':` · BH ${s.buchholz}`}`}</b>
                </div>
              ))}
            </section>
          )}
          {!obs&&data.consolation&&<section className="cast-standings" aria-label={data.consolation.title}>
            <h2>{data.consolation.title}</h2>
            {data.consolation.notice&&<p>{data.consolation.notice}</p>}
            {data.consolation.placings.slice(0,8).map(p=><div key={`${p.position}:${p.name}`}><span>{p.position}</span><strong>{p.name}</strong></div>)}
          </section>}
        </>
      )}
      {!obs && (
        <footer className="cast-output-footer">
          DartFlow · Speel. Ontmoet. Competeer.
        </footer>
      )}
    </main>
  );
}
