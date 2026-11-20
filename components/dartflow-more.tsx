"use client";
import { useEffect, useRef, useState } from "react";
import { CLUBHOUSE_NAV } from "./clubhouse-workspace";
import { ThemePreferencePicker } from "./clubhouse-theme";
import { InstallDartflow } from "./pwa-install";
import type { ClubhousePage } from "@/lib/clubhouse-types";
const groups = [
  {
    label: "Spelen & voortgang",
    links: [
      ["Banen & favorieten", "/app/baanfavorieten"],
      ["Mijn locaties & reserveringen", "/app/locations"],
      ["Oefenen", "/app/practice"],
      ["Uitdagingen", "/app/uitdagingen"],
      ["Vrije partijen & traininghistorie", "/historie"],
      ["Bestaande trainingen", "/app/training"],
      ["Wedstrijdhistorie", "/app/mymatches"],
      ["Statistieken", "/app/statistics"],
    ],
  },
  {
    label: "Community & evenementen",
    links: [
      ["Rankings", "/app/rankings"],
      ["Mijn feed", "/app/feed"],
      ["Verenigingen", "/app/clubs"],
      ["Vrienden & spelerskamers", "/app/friends"],
      ["Spelerskamers", "/app/community"],
      ["Toernooi organiseren", "/app/hall"],
    ],
  },
  { label: "Schermbeheer", links: [["Oche Live-schermen", "/app/schermen"]] },
  {
    label: "Jouw account",
    links: [
      ["Profiel & instellingen", "/app/settings"],
      ["Jouw meldingen", "/app/notifications"],
      ["Meldingsinstellingen", "/app/settings/notifications"],
      ["Mijn supporttickets", "/app/support"],
      ["Wat is nieuw?", "/app/whats-new"],
      ["Handleiding", "/handleiding"],
      ["Help & FAQ", "/help"],
    ],
  },
];
export default function DartflowMore({
  open,
  onClose,
  path,
  club,
  organizerLinks,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  path: string;
  club?: { id: string; name: string };
  organizerLinks: { href: string; label: string }[];
  onLogout: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [pages, setPages] = useState<ClubhousePage[]>([]);
  const activeClubId = club?.id;
  useEffect(() => {
    const node = dialog.current;
    if (open) {
      if (!node?.open) node?.showModal();
    } else node?.close();
  }, [open]);
  useEffect(() => {
    if (!open || !activeClubId) return;
    let active = true;
    fetch(`/api/clubhouse/${activeClubId}?page=overview`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        if (active) setPages(data.pages ?? []);
      })
      .catch(() => {
        if (active) setPages([]);
      });
    return () => {
      active = false;
    };
  }, [open, activeClubId]);
  const link = (label: string, href: string) => (
    <a
      key={href}
      className="df-more-link"
      href={href}
      aria-current={path === href ? "page" : undefined}
    >
      <span>{label}</span>
      <span aria-hidden="true">›</span>
    </a>
  );
  return (
    <dialog
      ref={dialog}
      className="df-more-sheet"
      aria-label="Meer DartFlow"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="df-more-content">
        <div className="df-more-handle" />
        <header>
          <div>
            <p className="ch-eyebrow">Meer</p>
            <h2>Jouw DartFlow</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Menu sluiten"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <nav aria-label="Meer navigatie">
          {club && pages.length > 0 && (
            <section>
              <h3>{club.name}</h3>
              {CLUBHOUSE_NAV.filter((item) => pages.includes(item.page)).map(
                (item) =>
                  link(
                    item.label,
                    `/app/clubs/${club.id}${item.slug ? `/${item.slug}` : ""}`,
                  ),
              )}
              {link("Vereniging wisselen", "/app/clubs")}
            </section>
          )}
          {groups.map((group) => (
            <section key={group.label}>
              <h3>{group.label}</h3>
              {group.links.map(([label, href]) => link(label, href))}
            </section>
          ))}
          {organizerLinks.length > 0 && (
            <section>
              <h3>Organiseren & beheren</h3>
              {organizerLinks.map((item) => link(item.label, item.href))}
            </section>
          )}
          <section>
            <h3>Uitstraling</h3>
            <details>
              <summary>Mijn clubhuisstijl kiezen</summary>
              <ThemePreferencePicker />
            </details>
          </section>
          <section>
            <InstallDartflow kind="player" />
            <button className="df-more-link" onClick={onLogout}>
              Uitloggen <span aria-hidden="true">↗</span>
            </button>
          </section>
        </nav>
      </div>
    </dialog>
  );
}
