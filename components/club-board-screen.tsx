"use client";

import { useEffect, useState } from "react";
import type { ClubBoardScreenView } from "@/lib/types";
import SprintDisplay from "./sprint-display";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scanInstruction = "Scan om te registreren of aan te melden en mee te spelen";

/** The QR always identifies the physical board, never a session or writer grant. */
export function ClubBoardQr({ boardId, label = "Registreren, aanmelden en spelen" }: { boardId: string; label?: string }) {
  const path = `/baan/${encodeURIComponent(boardId)}`;
  const [image, setImage] = useState("");
  useEffect(() => {
    let cancelled = false;
    const target = new URL(path, window.location.origin).href;
    void import("qrcode").then(module => module.toDataURL(target, {
      width: 320, margin: 3, errorCorrectionLevel: "M",
      color: { dark: "#111917", light: "#ffffff" },
    })).then(value => { if (!cancelled) setImage(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [path]);
  return <div className="qr-block club-board-qr">
    <a href={path} aria-label={label} title={scanInstruction}>
      {image ? <img className="qr-image" src={image} width={160} height={160} alt={`QR-code: ${scanInstruction}`} /> : <span className="qr-placeholder" aria-label="QR-code laden">QR</span>}
    </a>
    <div><strong>{label}</strong><p>{scanInstruction}.</p><a className="text-link" href={path}>Open deze baan ↗</a></div>
  </div>;
}

export default function ClubBoardScreen({ boardId }: { boardId: string }) {
  const [data, setData] = useState<ClubBoardScreenView | null>(null);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let stopped = false;
    let busy = false;
    const controller = new AbortController();
    setData(null);
    setError("");
    const refresh = async () => {
      if (busy || stopped) return;
      if (!uuid.test(boardId)) { setError("Deze schermlink hoort niet bij een bestaande verenigingsbaan."); return; }
      busy = true;
      try {
        const response = await fetch(`/api/club-boards/${encodeURIComponent(boardId)}/screen`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) {
          if (!stopped && [401, 403, 404, 410].includes(response.status)) setData(null);
          throw new Error(typeof body.error === "string" ? body.error : "Dit baanscherm is niet beschikbaar.");
        }
        if (!stopped) { setData(body); setError(""); setStale(false); }
      } catch (cause) {
        if (!stopped) { setStale(true); setError(cause instanceof Error ? cause.message : "Verbinding onderbroken."); }
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    window.addEventListener("online", refresh);
    return () => { stopped = true; controller.abort(); clearInterval(timer); window.removeEventListener("online", refresh); };
  }, [boardId]);

  if (data?.snapshot.match) return <div className="club-board-screen club-board-screen-live">
    <SprintDisplay snapshot={data.snapshot} stale={stale} qr={<ClubBoardQr boardId={data.board.id} />} scanInstruction={scanInstruction} />
  </div>;
  return <main className="club-board-screen club-board-idle">
    <div className="club-board-idle-frame">
      <header><img src="/assets/dartflow-logo.svg" alt="DartFlow" /><span className="connection" data-state={stale ? "stale" : "live"}>{stale ? "Verbinding onderbroken" : data ? "Live verbonden" : "Verbinden…"}</span></header>
      {!data ? <section className="club-board-idle-content"><img className="club-board-illustration" src="/assets/dartboard.svg" alt="" /><h1>{error ? "Scherm niet beschikbaar" : "Baan openen…"}</h1><p>{error || "De actuele baan ophalen."}</p></section> : <>
        <section className="club-board-idle-context"><p className="eyebrow">{data.board.clubName}</p><h1>{data.board.name}</h1><span className="badge">{data.status === "blocked" ? "Tijdelijk buiten gebruik" : data.status === "waiting" ? "Een speler wacht" : "Klaar om te spelen"}</span></section>
        <section className="club-board-idle-content"><img className="club-board-illustration" src="/assets/dartboard.svg" alt="" /><h2>{data.status === "blocked" ? "Even pauze aan dit bord." : data.status === "waiting" ? "Jouw tegenstander staat klaar." : "De baan is van jullie."}</h2><p>{data.status === "blocked" ? "Deze baan is tijdelijk geblokkeerd door de vereniging." : data.status === "waiting" ? "Scan dezelfde QR om met je eigen account mee te spelen." : "Solo trainen, samen aan het bord of met een tegenstander op afstand."}</p></section>
        <section className="club-board-idle-scan"><h2>{scanInstruction}</h2><ClubBoardQr boardId={data.board.id} />{data.board.access === "club" && <p>Spelen is voor leden van deze vereniging.</p>}</section>
      </>}
      <footer>Alleen-lezen baanscherm · Scores voer je in op je telefoon.{stale && data && <span> De laatste stand blijft zichtbaar; de verbinding wordt hersteld.</span>}</footer>
    </div>
  </main>;
}
