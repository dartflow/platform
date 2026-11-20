"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "@/lib/types";
import type {
  CompetitionWizardConfig as Config,
  CompetitionWizardContext as Context,
  CompetitionWizardDraft as Draft,
  CompetitionWizardStep as Step,
  CompetitionWizardPreview as Preview,
  CompetitionWizardCommand as Command,
  CompetitionWizardResponse as Response,
  CompetitionWizardTeam as Team,
} from "@/lib/competition-wizard-types";

const steps = [
  "Competitie",
  "Deelnemers",
  "Spelregels",
  "Locaties & banen",
  "Planning",
  "Controleren",
];
const weekdays = [
  "Zondag",
  "Maandag",
  "Dinsdag",
  "Woensdag",
  "Donderdag",
  "Vrijdag",
  "Zaterdag",
];
const date = (value: string) =>
  new Date(value).toLocaleString("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  });
const initial = (club: string): Config => ({
  version: 1,
  title: "",
  season: "",
  description: "",
  organizerName: club,
  variant: "singles",
  system: "round-robin",
  playerIds: [],
  teams: [],
  rules: {
    startScore: 501,
    startProcedure: "bull",
    setOpener: "continuous",
    decidingLeg: "continue",
    bestOfSets: 1,
    inRule: "single",
    outRule: "double",
    legMode: "bestOf",
    legs: 5,
    pointsWin: 2,
    pointsDraw: 1,
    pointsLoss: 0,
    slotCount: 7,
    tiebreaks: ["points", "leg-difference", "legs-for", "head-to-head"],
  },
  boardIds: [],
  planning: {
    startDate: new Date().toLocaleDateString("en-CA"),
    endDate: null,
    weekdays: [5],
    startTime: "19:30",
    endTime: "23:00",
    timezone: "Europe/Amsterdam",
    matchMinutes: 30,
    changeMinutes: 5,
    breaks: [],
    excludedDates: [],
    roundGating: "manual",
    returnLegs: false,
    offsets: {},
  },
});
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
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
      new Error(data.error || "De competitie kon niet worden opgeslagen."),
      { status: response.status },
    );
  return data;
}
const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** The planner and publish decision remain entirely on the server. */
export default function CompetitionWizard({
  clubId,
  actorId,
  onClose,
}: {
  clubId: string;
  actorId: string;
  onClose: () => void;
}) {
  const [context, setContext] = useState<Context | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [step, setStep] = useState<Step>(1),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(""),
    [online, setOnline] = useState(true),
    [conflict, setConflict] = useState(false),
    [search, setSearch] = useState(""),
    [warnings, setWarnings] = useState<string[]>([]),
    [published, setPublished] = useState("");
  const current = useRef<Config | null>(null),
    draftRef = useRef<Draft | null>(null),
    savedConfig = useRef(""),
    pending = useRef<Command | null>(null),
    publishAttempt = useRef<Command | null>(null),
    inFlight = useRef<Promise<Draft | null> | null>(null),
    live = useRef(true),
    stepRef = useRef<Step>(1);
  const key = `dartflow-wizard-v1:${actorId}:${clubId}`;
  const adopt = useCallback(
    (next: Draft | null, ctx: Context, recover = false) => {
      let value = next?.config ?? initial(ctx.club.name),
        nextStep = next?.step ?? 1;
      let recoveredConflict = false;
      if (recover) {
        try {
          const local = JSON.parse(localStorage.getItem(key) || "null");
          if (
            local &&
            local.id === (next?.id ?? null) &&
            local.config?.version === 1
          ) {
            value = local.config;
            nextStep =
              Number.isInteger(local.step) && local.step >= 1 && local.step <= 6
                ? local.step
                : 1;
            recoveredConflict = local.revision !== (next?.revision ?? 0);
          }
        } catch {
          /* The server draft remains available if local storage is unavailable. */
        }
      }
      draftRef.current = next;
      current.current = value;
      stepRef.current = nextStep;
      setDraft(next);
      setConfig(value);
      setStep(nextStep);
      savedConfig.current = JSON.stringify(
        next?.config ?? initial(ctx.club.name),
      );
      setPreview(null);
      setWarnings([]);
      setConflict(recoveredConflict);
      setError(
        recoveredConflict
          ? "Er is een nieuwere serverversie. Je lokale wijzigingen blijven beschikbaar om als kopie te bewaren."
          : "",
      );
      pending.current = null;
    },
    [key],
  );
  const load = useCallback(
    async (recover = false) => {
      try {
        const next = await api<Context>(`/api/competition-wizard/${clubId}`);
        if (!live.current) return;
        setContext(next);
        if (!current.current) {
          let requested = new URLSearchParams(location.search).get("concept");
          if (!requested && recover)
            try {
              const local = JSON.parse(localStorage.getItem(key) || "null");
              requested = typeof local?.id === "string" ? local.id : null;
            } catch {
              /* Server concepts remain available. */
            }
          adopt(
            next.drafts.find((x) => x.id === requested) ?? null,
            next,
            recover,
          );
        }
      } catch (e) {
        if (live.current) setError((e as Error).message);
      }
    },
    [clubId, adopt, key],
  );
  useEffect(() => {
    live.current = true;
    void load(true);
    const network = () => setOnline(navigator.onLine);
    network();
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      live.current = false;
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, [load]);
  const change = useCallback(
    (next: Config) => {
      current.current = next;
      setConfig(next);
      setPreview(null);
      setWarnings([]);
      setSaved("");
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            id: draftRef.current?.id ?? null,
            revision: draftRef.current?.revision ?? 0,
            step: stepRef.current,
            config: next,
          }),
        );
      } catch {
        setError(
          "Toestelopslag is niet beschikbaar. Sla het concept op voordat je deze pagina verlaat.",
        );
      }
    },
    [key],
  );
  const save = useCallback(async (): Promise<Draft | null> => {
    if (inFlight.current) return inFlight.current;
    if (
      !current.current ||
      !navigator.onLine ||
      conflict ||
      publishAttempt.current
    )
      return null;
    const task = (async () => {
      setSaving(true);
      setError("");
      try {
        const command = pending.current ?? {
          requestId: crypto.randomUUID(),
          action: {
            type: "wizard.save" as const,
            clubId,
            ...(draftRef.current ? { id: draftRef.current.id } : {}),
            expectedRevision: draftRef.current?.revision ?? 0,
            step: stepRef.current,
            config: structuredClone(current.current!),
          },
        };
        pending.current = command;
        const response = await api<Response>(
          "/api/competition-wizard",
          command,
        );
        if (!response.draft)
          throw new Error(
            "De server heeft geen opgeslagen concept teruggegeven.",
          );
        pending.current = null;
        draftRef.current = response.draft;
        setDraft(response.draft);
        const url = new URL(location.href);
        url.searchParams.set("concept", response.draft.id);
        url.searchParams.delete("nieuw");
        history.replaceState(history.state, "", url.pathname + url.search);
        savedConfig.current = JSON.stringify(response.draft.config);
        setSaved(
          new Date().toLocaleTimeString("nl-NL", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
        try {
          localStorage.setItem(
            key,
            JSON.stringify({
              id: response.draft.id,
              revision: response.draft.revision,
              step: stepRef.current,
              config: current.current,
            }),
          );
        } catch {
          /* Server save is already durable. */
        }
        return response.draft;
      } catch (e) {
        if ((e as { status?: number }).status === 409) {
          setConflict(true);
          pending.current = null;
        }
        setError((e as Error).message);
        return null;
      } finally {
        setSaving(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = task;
    return task;
  }, [clubId, key, conflict]);
  useEffect(() => {
    if (
      !config ||
      !context?.canManage ||
      !online ||
      saving ||
      conflict ||
      published ||
      savedConfig.current === JSON.stringify(config)
    )
      return;
    const timer = setTimeout(() => void save(), 800);
    return () => clearTimeout(timer);
  }, [
    config,
    context?.canManage,
    online,
    conflict,
    published,
    save,
    saved,
    saving,
  ]);
  const go = async (next: Step) => {
    if (publishAttempt.current) return;
    stepRef.current = next;
    setStep(next);
    if (current.current)
      try {
        localStorage.setItem(
          key,
          JSON.stringify({
            id: draftRef.current?.id ?? null,
            revision: draftRef.current?.revision ?? 0,
            step: next,
            config: current.current,
          }),
        );
      } catch {
        /* Explicit save is still available. */
      }
    await save();
  };
  const check = async () => {
    if (publishAttempt.current) return;
    let stored = await save();
    if (
      stored &&
      JSON.stringify(stored.config) !== JSON.stringify(current.current)
    )
      stored = await save();
    if (!stored) return;
    try {
      setSaving(true);
      const response = await api<Response>("/api/competition-wizard", {
        requestId: crypto.randomUUID(),
        action: {
          type: "wizard.preview",
          id: stored.id,
          expectedRevision: stored.revision,
        },
      } satisfies Command);
      if (
        response.preview &&
        draftRef.current?.revision === stored.revision &&
        JSON.stringify(current.current) === JSON.stringify(stored.config)
      ) {
        setPreview(response.preview);
        setWarnings([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const publish = async () => {
    if (
      !preview ||
      !draft ||
      !preview.canPublish ||
      preview.revision !== draft.revision
    )
      return;
    setSaving(true);
    try {
      const command: Command = publishAttempt.current ?? {
        requestId: crypto.randomUUID(),
        action: {
          type: "wizard.publish",
          id: draft.id,
          expectedRevision: draft.revision,
          configurationHash: preview.configurationHash,
          acknowledgedWarnings: warnings,
        },
      };
      publishAttempt.current = command;
      const response = await api<Response>("/api/competition-wizard", command);
      publishAttempt.current = null;
      setPublished(response.seasonId ?? response.season?.id ?? "");
      localStorage.removeItem(key);
    } catch (e) {
      setError((e as Error).message);
      if (
        (e as { status?: number }).status &&
        (e as { status: number }).status < 500
      ) {
        publishAttempt.current = null;
        setPreview(null);
      }
    } finally {
      setSaving(false);
    }
  };
  const copy = async () => {
    if (!draft || !context) return;
    try {
      setSaving(true);
      const own = structuredClone(current.current);
      const latest = await api<Context>(`/api/competition-wizard/${clubId}`);
      const source = latest.drafts.find((item) => item.id === draft.id);
      if (!source)
        throw new Error(
          "Het oorspronkelijke concept is niet meer beschikbaar.",
        );
      const response = await api<Response>("/api/competition-wizard", {
        requestId: crypto.randomUUID(),
        action: {
          type: "wizard.copy",
          id: source.id,
          expectedRevision: source.revision,
        },
      } satisfies Command);
      if (response.draft) {
        adopt(response.draft, context);
        if (own) change(own);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  if (!context || !config)
    return (
      <section className="panel">
        <h2>Competitiewizard</h2>
        <p>{error || "De verenigingsrechten en concepten ophalen…"}</p>
        <button className="button ghost" onClick={onClose}>
          Terug naar competities
        </button>
      </section>
    );
  const rules = (patch: Partial<Config["rules"]>) =>
      change({ ...config, rules: { ...config.rules, ...patch } }),
    planning = (patch: Partial<Config["planning"]>) =>
      change({ ...config, planning: { ...config.planning, ...patch } });
  const participants = context.players.filter(
    (p) =>
      !search ||
      `${p.name} ${p.username ?? ""}`
        .toLocaleLowerCase("nl")
        .includes(search.toLocaleLowerCase("nl")),
  );
  const playerName = (id: string) =>
    context.players.find((p) => p.id === id)?.name ?? "Speler";
  const editable =
    context.canManage && draft?.status !== "published" && !published;
  return (
    <section className="ch-wizard" aria-label="Competitiewizard">
      <header className="ch-page-heading">
        <div>
          <p className="ch-eyebrow">{context.club.name} · Organiseren</p>
          <h2>Nieuwe clubcompetitie</h2>
          <p>Van deelnemers tot een gecontroleerd wedstrijdprogramma.</p>
        </div>
        <button
          className="button ghost"
          onClick={async () => {
            if (
              editable &&
              JSON.stringify(current.current) !== savedConfig.current &&
              !(await save())
            )
              return;
            onClose();
          }}
        >
          Opslaan en sluiten
        </button>
      </header>
      <div className="ch-save-state" role="status">
        {!online
          ? "Offline · wijzigingen blijven op dit toestel"
          : saving
            ? "Bezig met opslaan…"
            : conflict
              ? "Een andere beheerder heeft dit concept gewijzigd"
              : saved
                ? `Opgeslagen om ${saved}`
                : "Concept · nog niet gepubliceerd"}
        {draft && <small>Versie {draft.revision}</small>}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          {!conflict && (
            <button
              className="button ghost"
              disabled={!online || saving}
              onClick={() => void save()}
            >
              Opnieuw proberen
            </button>
          )}
        </div>
      )}
      {conflict && (
        <div className="panel">
          <h3>Nieuwere versie beschikbaar</h3>
          <p>
            Je wijzigingen worden niet over de versie van een andere beheerder
            geschreven.
          </p>
          <div className="button-row">
            <button
              className="button ghost"
              onClick={async () => {
                const next = await api<Context>(
                  `/api/competition-wizard/${clubId}`,
                );
                setContext(next);
                adopt(
                  next.drafts.find((d) => d.id === draft?.id) ?? null,
                  next,
                );
              }}
            >
              Nieuwste versie laden
            </button>
            <button className="button gold" onClick={() => void copy()}>
              Mijn wijzigingen als kopie bewaren
            </button>
          </div>
        </div>
      )}
      {published ? (
        <div className="panel">
          <h3>De competitie is gepubliceerd</h3>
          <p>De deelnemers, regels en planning zijn vastgelegd.</p>
          <a className="button gold" href={`/app/competities/${published}`}>
            Competitie openen
          </a>
        </div>
      ) : (
        <>
          <nav className="ch-steps" aria-label="Stappen competitiewizard">
            {steps.map((label, index) => (
              <button
                type="button"
                key={label}
                aria-current={step === index + 1 ? "step" : undefined}
                className={step === index + 1 ? "active" : ""}
                onClick={() => void go((index + 1) as Step)}
              >
                <span>{index + 1}</span>
                {label}
              </button>
            ))}
          </nav>
          <fieldset
            className="ch-wizard-content"
            disabled={!editable || conflict || Boolean(publishAttempt.current)}
          >
            {step === 1 && (
              <>
                <h3>1. Wat organiseren jullie?</h3>
                <label className="field">
                  Competitienaam
                  <input
                    value={config.title}
                    onChange={(e) =>
                      change({ ...config, title: e.target.value })
                    }
                    maxLength={120}
                  />
                </label>
                <div className="ch-form-grid">
                  <label className="field">
                    Seizoen / editie
                    <input
                      value={config.season}
                      onChange={(e) =>
                        change({ ...config, season: e.target.value })
                      }
                      maxLength={80}
                    />
                  </label>
                  <label className="field">
                    Organisator
                    <input
                      value={config.organizerName}
                      onChange={(e) =>
                        change({ ...config, organizerName: e.target.value })
                      }
                      maxLength={120}
                    />
                  </label>
                </div>
                <label className="field">
                  Omschrijving
                  <textarea
                    value={config.description}
                    onChange={(e) =>
                      change({ ...config, description: e.target.value })
                    }
                    maxLength={4000}
                  />
                </label>
                <p>
                  Eigenaar: <strong>{context.club.name}</strong>. Dit concept en
                  de competitie blijven aan deze vereniging gekoppeld.
                </p>
                <div className="ch-form-grid">
                  <label className="field">
                    Competitievorm
                    <select
                      value={config.variant}
                      onChange={(e) => {
                        const variant = e.target.value as Config["variant"];
                        change({
                          ...config,
                          variant,
                          teams: [],
                          playerIds: [],
                          system:
                            context.formats.find((f) => f.variant === variant)
                              ?.systems[0] ?? "round-robin",
                        });
                      }}
                    >
                      {context.formats.map((f) => (
                        <option key={f.variant} value={f.variant}>
                          {f.variant === "singles"
                            ? "Singles"
                            : f.variant === "doubles"
                              ? "Dubbels"
                              : "Teams"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Competitiesysteem
                    <select
                      value={config.system}
                      onChange={(e) =>
                        change({
                          ...config,
                          system: e.target.value as Config["system"],
                        })
                      }
                    >
                      {context.formats
                        .find((f) => f.variant === config.variant)
                        ?.systems.map((system) => (
                          <option key={system} value={system}>
                            {system === "round-robin"
                              ? "Iedereen tegen iedereen"
                              : "Knock-out"}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <h3>2. Wie doen er mee?</h3>
                <label className="field">
                  Zoek een verenigingslid
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {config.variant === "singles" ? (
                  <>
                    <p>{config.playerIds.length} spelers geselecteerd</p>
                    <div className="ch-selection-list">
                      {participants.map((player) => (
                        <label className="ch-selection" key={player.id}>
                          <input
                            type="checkbox"
                            checked={config.playerIds.includes(player.id)}
                            disabled={!player.eligible}
                            onChange={() =>
                              change({
                                ...config,
                                playerIds: toggle(config.playerIds, player.id),
                              })
                            }
                          />
                          <span>
                            <strong>{player.name}</strong>
                            {player.username && (
                              <small>@{player.username}</small>
                            )}
                            {!player.eligible && (
                              <small>
                                {player.reason ??
                                  "Niet beschikbaar voor deze competitie"}
                              </small>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p>
                      {config.teams.length}{" "}
                      {config.variant === "doubles" ? "koppels" : "teams"}{" "}
                      geselecteerd. Iedere speler heeft één plek; reserves
                      worden apart vastgelegd.
                    </p>
                    {context.teams.map((team) => (
                      <label className="ch-selection" key={team.id}>
                        <input
                          type="checkbox"
                          checked={config.teams.some((t) => t.id === team.id)}
                          onChange={() =>
                            change({
                              ...config,
                              teams: config.teams.some((t) => t.id === team.id)
                                ? config.teams.filter((t) => t.id !== team.id)
                                : [...config.teams, structuredClone(team)],
                            })
                          }
                        />
                        <span>
                          {team.name}
                          <small>
                            {team.playerIds.map(playerName).join(", ")}
                          </small>
                        </span>
                      </label>
                    ))}
                    {config.teams.map((team, index) => (
                      <WizardTeam
                        key={team.id}
                        team={team}
                        players={context.players}
                        doubles={config.variant === "doubles"}
                        onChange={(next) =>
                          change({
                            ...config,
                            teams: config.teams.map((t, i) =>
                              i === index ? next : t,
                            ),
                          })
                        }
                        onRemove={() =>
                          change({
                            ...config,
                            teams: config.teams.filter((t) => t.id !== team.id),
                          })
                        }
                      />
                    ))}
                    <a
                      className="button ghost"
                      href={`/app/clubs/${clubId}/teams`}
                    >
                      Eerst een eigen team of koppel aanmaken
                    </a>
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => void load()}
                    >
                      Teamselectie vernieuwen
                    </button>
                  </>
                )}
              </>
            )}
            {step === 3 && (
              <>
                <h3>3. Spelregels en reglement</h3>
                <div className="ch-form-grid">
                  <label className="field">
                    Startscore
                    <select
                      value={config.rules.startScore ?? 501}
                      onChange={(e) =>
                        rules({
                          startScore: Number(e.target.value) as 301 | 501 | 701,
                          inRule:
                            e.target.value === "301" ? "double" : "single",
                        })
                      }
                    >
                      {[301, 501, 701].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Legsysteem
                    <select
                      value={config.rules.legMode ?? "bestOf"}
                      onChange={(e) =>
                        rules({ legMode: e.target.value as "bestOf" | "fixed" })
                      }
                    >
                      <option value="bestOf">Best of</option>
                      <option value="fixed">Vast aantal legs</option>
                    </select>
                  </label>
                  <label className="field">
                    Aantal legs
                    <input
                      type="number"
                      min={1}
                      max={99}
                      step={
                        (config.rules.legMode ?? "bestOf") === "bestOf" ? 2 : 1
                      }
                      value={config.rules.legs ?? 5}
                      onChange={(e) => rules({ legs: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    Openen
                    <select
                      value={config.rules.inRule ?? "single"}
                      onChange={(e) =>
                        rules({ inRule: e.target.value as "single" | "double" })
                      }
                    >
                      <option value="single">Single in</option>
                      <option value="double">Double in</option>
                    </select>
                  </label>
                  <label className="field">
                    Uitgooien
                    <select
                      value={config.rules.outRule ?? "double"}
                      onChange={(e) =>
                        rules({
                          outRule: e.target.value as
                            | "straight"
                            | "double"
                            | "master",
                        })
                      }
                    >
                      <option value="straight">Single uit</option>
                      <option value="double">Double uit</option>
                      <option value="master">Master uit</option>
                    </select>
                  </label>
                  <label className="field">
                    Startprocedure
                    <select
                      value={config.rules.startProcedure ?? "bull"}
                      onChange={(e) =>
                        rules({
                          startProcedure: e.target.value as
                            | "bull"
                            | "server-lot"
                            | "home-first",
                        })
                      }
                    >
                      <option value="bull">
                        Bullen met tweezijdige bevestiging
                      </option>
                      <option value="server-lot">Loting</option>
                      <option value="home-first">Thuis begint</option>
                    </select>
                  </label>
                  <label className="field">
                    Beslissende leg
                    <select
                      value={config.rules.decidingLeg ?? "continue"}
                      onChange={(e) =>
                        rules({
                          decidingLeg: e.target.value as "continue" | "rebull",
                        })
                      }
                    >
                      <option value="continue">Afwisselend</option>
                      <option value="rebull">Opnieuw bullen</option>
                    </select>
                  </label>
                  <label className="field">
                    Sets (best of, optioneel)
                    <input
                      type="number"
                      min={1}
                      max={99}
                      step={2}
                      value={config.rules.bestOfSets ?? ""}
                      onChange={(e) =>
                        rules({
                          bestOfSets: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                    />
                  </label>
                  {config.variant === "teams" && (
                    <label className="field">
                      Onderdelen per ontmoeting
                      <select
                        value={config.rules.slotCount ?? 7}
                        onChange={(e) =>
                          rules({ slotCount: Number(e.target.value) as 4 | 7 })
                        }
                      >
                        <option value={7}>
                          7 · vier singles, twee dubbels en team
                        </option>
                        <option value={4}>4 · vier singles</option>
                      </select>
                    </label>
                  )}
                </div>
                <div className="ch-form-grid">
                  {[
                    ["pointsWin", "Punten bij winst", 2],
                    ["pointsDraw", "Punten bij gelijkspel", 1],
                    ["pointsLoss", "Punten bij verlies", 0],
                  ].map(([key, label, fallback]) => (
                    <label className="field" key={key}>
                      {label}
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={Number(
                          config.rules[key as "pointsWin"] ?? fallback,
                        )}
                        onChange={(e) =>
                          rules({ [key]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className="field">
                  Volgorde bij gelijke stand
                  <select
                    value={(config.rules.tiebreaks ?? []).join(",")}
                    onChange={(e) =>
                      rules({
                        tiebreaks: e.target.value.split(",") as NonNullable<
                          Config["rules"]["tiebreaks"]
                        >,
                      })
                    }
                  >
                    <option value="points,leg-difference,legs-for,head-to-head">
                      Punten → legsaldo → legs voor → onderling
                    </option>
                    <option value="points,head-to-head,leg-difference,legs-for">
                      Punten → onderling → legsaldo → legs voor
                    </option>
                  </select>
                </label>
                <AdvancedWizardRules
                  rules={config.rules}
                  team={config.variant === "teams"}
                  onChange={rules}
                />
                <label className="field">
                  Aanvullend reglement
                  <textarea
                    value={config.rules.notes ?? ""}
                    onChange={(e) => rules({ notes: e.target.value })}
                    maxLength={6000}
                  />
                </label>
                <p>
                  De regels worden bij publicatie vastgelegd. Een individuele
                  spelregel is geen erkenning voor een officiële ranking.
                </p>
              </>
            )}
            {step === 4 && (
              <>
                <h3>4. Waar gaan jullie spelen?</h3>
                <p>
                  Alleen de expliciet gekoppelde banen hieronder mogen worden
                  ingepland. Planningsrecht geeft geen beheerrecht over de
                  locatie.
                </p>
                {context.locations.length === 0 ? (
                  <div className="notice">
                    Er zijn nog geen locaties met een geldige
                    planningskoppeling. Vraag de locatiebeheerder een koppeling
                    toe te kennen.
                  </div>
                ) : (
                  context.locations.map((location) => (
                    <section className="panel" key={location.id}>
                      <h4>{location.name}</h4>
                      <p>
                        {location.timezone} · koppeling versie{" "}
                        {location.grantRevision}
                      </p>
                      {location.windows.map((w, index) => (
                        <small key={index}>
                          {weekdays[w.weekday]} {w.startTime}–{w.endTime}{" "}
                        </small>
                      ))}
                      <div className="ch-selection-list">
                        {location.boards.map((board) => (
                          <label className="ch-selection" key={board.id}>
                            <input
                              type="checkbox"
                              checked={config.boardIds.includes(board.id)}
                              onChange={() =>
                                change({
                                  ...config,
                                  boardIds: toggle(config.boardIds, board.id),
                                })
                              }
                            />
                            {board.name}
                          </label>
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </>
            )}
            {step === 5 && (
              <>
                <h3>5. Maak een haalbare planning</h3>
                <div className="ch-form-grid">
                  <label className="field">
                    Startdatum
                    <input
                      type="date"
                      value={config.planning.startDate}
                      onChange={(e) => planning({ startDate: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Uiterste einddatum
                    <input
                      type="date"
                      value={config.planning.endDate ?? ""}
                      onChange={(e) =>
                        planning({ endDate: e.target.value || null })
                      }
                    />
                  </label>
                  <label className="field">
                    Begintijd
                    <input
                      type="time"
                      value={config.planning.startTime}
                      onChange={(e) => planning({ startTime: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Eindtijd
                    <input
                      type="time"
                      value={config.planning.endTime}
                      onChange={(e) => planning({ endTime: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Tijdzone
                    <input
                      value={config.planning.timezone}
                      onChange={(e) => planning({ timezone: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Partijduur (minuten)
                    <input
                      type="number"
                      min={5}
                      max={480}
                      value={config.planning.matchMinutes}
                      onChange={(e) =>
                        planning({ matchMinutes: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    Wisseltijd (minuten)
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={config.planning.changeMinutes}
                      onChange={(e) =>
                        planning({ changeMinutes: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="field">
                    Rondes vrijgeven
                    <select
                      value={config.planning.roundGating}
                      onChange={(e) =>
                        planning({
                          roundGating: e.target.value as "manual" | "automatic",
                        })
                      }
                    >
                      <option value="manual">Handmatig per ronde</option>
                      <option value="automatic">Automatisch</option>
                    </select>
                  </label>
                </div>
                <fieldset>
                  <legend>Speeldagen</legend>
                  <div className="button-row">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                      <label className="check" key={day}>
                        <input
                          type="checkbox"
                          checked={config.planning.weekdays.includes(day)}
                          onChange={() =>
                            planning({
                              weekdays: config.planning.weekdays.includes(day)
                                ? config.planning.weekdays.filter(
                                    (x) => x !== day,
                                  )
                                : [...config.planning.weekdays, day],
                            })
                          }
                        />
                        {weekdays[day]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={config.planning.returnLegs}
                    onChange={(e) => planning({ returnLegs: e.target.checked })}
                  />
                  Thuis- en uitronde
                </label>
                <label className="field">
                  Niet spelen op (één datum per regel, JJJJ-MM-DD)
                  <textarea
                    value={config.planning.excludedDates.join("\n")}
                    onChange={(e) =>
                      planning({
                        excludedDates: e.target.value
                          .split("\n")
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <fieldset>
                  <legend>Pauzes</legend>
                  {config.planning.breaks.map((pause, index) => (
                    <div className="ch-form-grid" key={index}>
                      <label className="field">
                        Pauze begint
                        <input
                          type="time"
                          value={pause.startTime}
                          onChange={(e) =>
                            planning({
                              breaks: config.planning.breaks.map((p, i) =>
                                i === index
                                  ? { ...p, startTime: e.target.value }
                                  : p,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        Pauze eindigt
                        <input
                          type="time"
                          value={pause.endTime}
                          onChange={(e) =>
                            planning({
                              breaks: config.planning.breaks.map((p, i) =>
                                i === index
                                  ? { ...p, endTime: e.target.value }
                                  : p,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() =>
                          planning({
                            breaks: config.planning.breaks.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        Pauze verwijderen
                      </button>
                    </div>
                  ))}
                  <button
                    className="button ghost"
                    type="button"
                    onClick={() =>
                      planning({
                        breaks: [
                          ...config.planning.breaks,
                          { startTime: "21:00", endTime: "21:15" },
                        ],
                      })
                    }
                  >
                    Pauze toevoegen
                  </button>
                </fieldset>
                <details>
                  <summary>Dubbele lokale tijd bij wintertijd</summary>
                  <p>
                    Alleen nodig als de server een dubbel tijdstip aanwijst.
                    Kies de offset uit de melding; de lokale tijd wordt niet
                    stilzwijgend verschoven.
                  </p>
                  {Object.entries(config.planning.offsets).map(
                    ([local, offset]) => (
                      <div className="ch-form-grid" key={local}>
                        <span>{local}</span>
                        <select
                          aria-label={`Offset voor ${local}`}
                          value={offset}
                          onChange={(e) =>
                            planning({
                              offsets: {
                                ...config.planning.offsets,
                                [local]: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="+02:00">Zomertijd (+02:00)</option>
                          <option value="+01:00">Wintertijd (+01:00)</option>
                        </select>
                      </div>
                    ),
                  )}
                  <label className="field">
                    Dubbel lokaal tijdstip
                    <input
                      type="datetime-local"
                      onChange={(e) => {
                        if (e.target.value)
                          planning({
                            offsets: {
                              ...config.planning.offsets,
                              [e.target.value]: "+02:00",
                            },
                          });
                      }}
                    />
                  </label>
                </details>
              </>
            )}
            {step === 6 && (
              <>
                <h3>6. Alles klaar voor publicatie?</h3>
                <dl className="ch-review">
                  <dt>
                    Competitie{" "}
                    <button type="button" onClick={() => void go(1)}>
                      Wijzigen
                    </button>
                  </dt>
                  <dd>
                    {config.title || "Nog geen naam"} · {config.season} ·{" "}
                    {context.club.name}
                    <p>{config.description}</p>
                  </dd>
                  <dt>
                    Deelnemers{" "}
                    <button type="button" onClick={() => void go(2)}>
                      Wijzigen
                    </button>
                  </dt>
                  <dd>
                    {config.variant === "singles"
                      ? config.playerIds.map(playerName).join(", ")
                      : config.teams
                          .map(
                            (t) =>
                              `${t.name}: ${t.playerIds.map(playerName).join(", ")}`,
                          )
                          .join("; ")}
                  </dd>
                  <dt>
                    Regels{" "}
                    <button type="button" onClick={() => void go(3)}>
                      Wijzigen
                    </button>
                  </dt>
                  <dd>
                    {config.rules.startScore} ·{" "}
                    {config.rules.legMode === "fixed"
                      ? "Vaste legs"
                      : "Best of"}{" "}
                    {config.rules.legs} · {config.rules.inRule} in ·{" "}
                    {config.rules.outRule} uit · {config.rules.notes}
                  </dd>
                  <dt>
                    Banen{" "}
                    <button type="button" onClick={() => void go(4)}>
                      Wijzigen
                    </button>
                  </dt>
                  <dd>
                    {context.locations
                      .flatMap((l) =>
                        l.boards
                          .filter((b) => config.boardIds.includes(b.id))
                          .map((b) => `${l.name} · ${b.name}`),
                      )
                      .join(", ") || "Geen geselecteerd"}
                  </dd>
                  <dt>
                    Planning{" "}
                    <button type="button" onClick={() => void go(5)}>
                      Wijzigen
                    </button>
                  </dt>
                  <dd>
                    {config.planning.startDate} ·{" "}
                    {config.planning.weekdays
                      .map((day) => weekdays[day])
                      .join(", ")}{" "}
                    · {config.planning.startTime}–{config.planning.endTime} ·{" "}
                    {config.planning.timezone} · {config.planning.matchMinutes}+
                    {config.planning.changeMinutes} minuten ·{" "}
                    {config.planning.roundGating === "manual"
                      ? "Handmatige vrijgave"
                      : "Automatische vrijgave"}
                  </dd>
                </dl>
                <button
                  type="button"
                  className="button gold"
                  disabled={!online}
                  onClick={() => void check()}
                >
                  Programma controleren
                </button>
              </>
            )}
          </fieldset>
          {preview && (
            <section className="panel ch-preview">
              <h3>Voorvertoning wedstrijdprogramma</h3>
              <p>
                {preview.participantCount} deelnemers · {preview.totalMatches}{" "}
                partijen · {preview.rounds.length} rondes
              </p>
              {preview.issues.map((issue, index) => (
                <button
                  className="notice error"
                  key={index}
                  onClick={() => void go(issue.step)}
                >
                  {issue.message} · Ga naar stap {issue.step}
                </button>
              ))}
              {preview.warnings.map((warning, index) => (
                <label className="check notice" key={index}>
                  <input
                    type="checkbox"
                    checked={warnings.includes(warning.code)}
                    onChange={() => setWarnings(toggle(warnings, warning.code))}
                  />
                  {warning.message}
                </label>
              ))}
              {preview.rounds
                .filter((round) => round.byeIds.length)
                .map((round) => (
                  <p key={round.number}>
                    Ronde {round.number}: vrijloting voor{" "}
                    {round.byeIds
                      .map(
                        (id) =>
                          playerName(id) ||
                          config.teams.find((t) => t.id === id)?.name,
                      )
                      .join(", ")}
                  </p>
                ))}
              <div className="ch-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Ronde</th>
                      <th>Partij</th>
                      <th>Tijd</th>
                      <th>Baan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.fixtures.map((fixture) => (
                      <tr key={fixture.id}>
                        <td>{fixture.round}</td>
                        <td>
                          {fixture.homeName} – {fixture.awayName}
                        </td>
                        <td>
                          {date(fixture.startsAt)} ({fixture.offset})
                        </td>
                        <td>
                          {context.locations
                            .flatMap((l) => l.boards)
                            .find((b) => b.id === fixture.boardId)?.name ??
                            "Baan"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Vast te leggen reglement</summary>
                {preview.regulation.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </details>
              <p>
                Publiceren maakt de echte competitie, deelnemers, rondes en
                baanboekingen aan. Het concept wordt daarna alleen als
                publicatiebewijs bewaard.
              </p>
              <button
                className="button gold"
                disabled={
                  saving ||
                  !online ||
                  !editable ||
                  !preview.canPublish ||
                  preview.warnings.some((w) => !warnings.includes(w.code))
                }
                onClick={() => void publish()}
              >
                Competitie definitief publiceren
              </button>
            </section>
          )}
          <footer className="ch-wizard-footer">
            <button
              className="button ghost"
              disabled={step === 1 || saving}
              onClick={() => void go((step - 1) as Step)}
            >
              Vorige stap
            </button>
            <button
              className="button ghost"
              disabled={!editable || saving || !online}
              onClick={() => void save()}
            >
              Concept opslaan
            </button>
            {step < 6 && (
              <button
                className="button gold"
                disabled={saving}
                onClick={() => void go((step + 1) as Step)}
              >
                Volgende stap
              </button>
            )}
          </footer>
          {context.drafts.length > 0 && (
            <details>
              <summary>Opgeslagen concepten ({context.drafts.length})</summary>
              {context.drafts.map((item) => (
                <div className="workspace-row" key={item.id}>
                  <span>
                    {item.config.title || "Naamloos concept"} · versie{" "}
                    {item.revision}
                  </span>
                  {item.publishedSeasonId ? (
                    <a href={`/app/competities/${item.publishedSeasonId}`}>
                      Open competitie
                    </a>
                  ) : (
                    <button
                      className="button ghost"
                      disabled={saving}
                      onClick={async () => {
                        if (
                          current.current &&
                          savedConfig.current !==
                            JSON.stringify(current.current) &&
                          !(await save())
                        )
                          return;
                        adopt(item, context);
                      }}
                    >
                      Concept openen
                    </button>
                  )}
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
function WizardTeam({
  team,
  players,
  doubles,
  onChange,
  onRemove,
}: {
  team: Team;
  players: Context["players"];
  doubles: boolean;
  onChange: (team: Team) => void;
  onRemove: () => void;
}) {
  const roster = players.filter((p) => team.playerIds.includes(p.id));
  return (
    <fieldset className="panel">
      <legend>{team.name}</legend>
      <p>
        De actuele eigen teamselectie wordt bij publicatie opnieuw
        gecontroleerd. Wijzig vaste spelers of reserves via Verenigingsteams.
      </p>
      <div className="ch-selection-list">
        {roster.map((player) => (
          <div className="ch-selection" key={player.id}>
            <span>
              {player.name}
              <small>
                {team.reserveIds.includes(player.id)
                  ? "Reserve"
                  : "Vaste speler"}
                {!player.eligible
                  ? ` · ${player.reason ?? "Niet beschikbaar"}`
                  : ""}
              </small>
            </span>
          </div>
        ))}
      </div>
      <div className="ch-form-grid">
        <label className="field">
          Aanvoerder
          <select
            value={team.captainId}
            onChange={(e) => onChange({ ...team, captainId: e.target.value })}
          >
            <option value="">Kies een vaste speler</option>
            {roster
              .filter((p) => !team.reserveIds.includes(p.id))
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        {!doubles && (
          <label className="field">
            Plaatsvervangend aanvoerder
            <select
              value={team.deputyId ?? ""}
              onChange={(e) =>
                onChange({ ...team, deputyId: e.target.value || null })
              }
            >
              <option value="">Geen</option>
              {roster
                .filter(
                  (p) =>
                    p.id !== team.captainId && !team.reserveIds.includes(p.id),
                )
                .map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      <button type="button" className="button ghost" onClick={onRemove}>
        Verwijderen uit deze competitie
      </button>
    </fieldset>
  );
}
function AdvancedWizardRules({
  rules,
  team,
  onChange,
}: {
  rules: Config["rules"];
  team: boolean;
  onChange: (patch: Partial<Config["rules"]>) => void;
}) {
  const slotCount = rules.slotCount ?? 7;
  return (
    <>
      <details className="panel">
        <summary>Sets, twee verschil en handicap</summary>
        <div className="ch-form-grid">
          <label className="field">
            Beginsysteem bij volgende set
            <select
              value={rules.setOpener ?? "continuous"}
              onChange={(e) =>
                onChange({ setOpener: e.target.value as Settings["setOpener"] })
              }
            >
              <option value="continuous">Volgorde doorzetten</option>
              <option value="alternate-sets">Setstarters afwisselen</option>
            </select>
          </label>
          <label className="field">
            Twee legs verschil, absoluut maximum (optioneel)
            <input
              type="number"
              min={rules.legs ?? 5}
              max={99}
              step={2}
              value={rules.legWinByTwo?.maximum ?? ""}
              onChange={(e) =>
                onChange({
                  legWinByTwo: e.target.value
                    ? { maximum: Number(e.target.value) }
                    : undefined,
                })
              }
            />
          </label>
          <label className="field">
            Twee sets verschil, absoluut maximum (optioneel)
            <input
              type="number"
              min={rules.bestOfSets ?? 3}
              max={99}
              step={2}
              value={rules.setWinByTwo?.maximum ?? ""}
              onChange={(e) =>
                onChange({
                  setWinByTwo: e.target.value
                    ? { maximum: Number(e.target.value) }
                    : undefined,
                })
              }
            />
          </label>
          <label className="field">
            Handicap startscore thuis (optioneel)
            <input
              type="number"
              min={2}
              max={1001}
              value={rules.sideStartScores?.[0] ?? ""}
              onChange={(e) =>
                onChange({
                  sideStartScores: e.target.value
                    ? [
                        Number(e.target.value),
                        rules.sideStartScores?.[1] ?? rules.startScore ?? 501,
                      ]
                    : undefined,
                })
              }
            />
          </label>
          <label className="field">
            Handicap startscore uit (optioneel)
            <input
              type="number"
              min={2}
              max={1001}
              value={rules.sideStartScores?.[1] ?? ""}
              onChange={(e) =>
                onChange({
                  sideStartScores: e.target.value
                    ? [
                        rules.sideStartScores?.[0] ?? rules.startScore ?? 501,
                        Number(e.target.value),
                      ]
                    : undefined,
                })
              }
            />
          </label>
        </div>
        <p>
          Een handicap en afwijkende spelregels worden in het reglement
          vastgelegd en geven geen automatisch recht op officiële ranking.
        </p>
      </details>
      {team && (
        <details className="panel">
          <summary>Regels per onderdeel ({slotCount})</summary>
          <p>
            Standaard volgt ieder onderdeel de algemene regels hierboven. Leg
            een afwijking vooraf vast.
          </p>
          {Array.from({ length: slotCount }, (_, index) => {
            const key = String(index),
              override = rules.slotRules?.[key];
            const update = (patch: Partial<Settings>) =>
              onChange({
                slotRules: {
                  ...rules.slotRules,
                  [key]: { ...override, ...patch },
                },
              });
            return (
              <fieldset key={key}>
                <legend>
                  {index + 1} ·{" "}
                  {index < 4 ? "Single" : index < 6 ? "Dubbel" : "Teamleg"}
                </legend>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(override)}
                    onChange={(e) => {
                      const next = { ...rules.slotRules };
                      if (e.target.checked)
                        next[key] = {
                          startScore: rules.startScore ?? 501,
                          bestOfLegs: rules.legs ?? 5,
                          bestOfSets: rules.bestOfSets ?? 1,
                          inRule: rules.inRule ?? "single",
                          outRule: rules.outRule ?? "double",
                          startProcedure: rules.startProcedure ?? "bull",
                        };
                      else delete next[key];
                      onChange({ slotRules: next });
                    }}
                  />
                  Afwijkende regels voor onderdeel {index + 1}
                </label>
                {override && (
                  <div className="ch-form-grid">
                    <label className="field">
                      Startscore onderdeel {index + 1}
                      <select
                        value={override.startScore ?? rules.startScore ?? 501}
                        onChange={(e) =>
                          update({
                            startScore: Number(
                              e.target.value,
                            ) as Settings["startScore"],
                          })
                        }
                      >
                        {[301, 501, 701].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Best of legs onderdeel {index + 1}
                      <input
                        type="number"
                        min={1}
                        max={99}
                        step={2}
                        value={override.bestOfLegs ?? rules.legs ?? 5}
                        onChange={(e) =>
                          update({ bestOfLegs: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      Openen onderdeel {index + 1}
                      <select
                        value={override.inRule ?? rules.inRule ?? "single"}
                        onChange={(e) =>
                          update({
                            inRule: e.target.value as Settings["inRule"],
                          })
                        }
                      >
                        <option value="single">Single in</option>
                        <option value="double">Double in</option>
                      </select>
                    </label>
                    <label className="field">
                      Uitgooien onderdeel {index + 1}
                      <select
                        value={override.outRule ?? rules.outRule ?? "double"}
                        onChange={(e) =>
                          update({
                            outRule: e.target.value as Settings["outRule"],
                          })
                        }
                      >
                        <option value="straight">Single uit</option>
                        <option value="double">Double uit</option>
                        <option value="master">Master uit</option>
                      </select>
                    </label>
                    <label className="field">
                      Best of sets onderdeel {index + 1}
                      <input
                        type="number"
                        min={1}
                        max={99}
                        step={2}
                        value={override.bestOfSets ?? 1}
                        onChange={(e) =>
                          update({ bestOfSets: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      Startprocedure onderdeel {index + 1}
                      <select
                        value={
                          override.startProcedure ??
                          rules.startProcedure ??
                          "bull"
                        }
                        onChange={(e) =>
                          update({
                            startProcedure: e.target
                              .value as Settings["startProcedure"],
                          })
                        }
                      >
                        <option value="bull">Bullen</option>
                        <option value="server-lot">Loting</option>
                        <option value="home-first">Thuis begint</option>
                      </select>
                    </label>
                  </div>
                )}
              </fieldset>
            );
          })}
        </details>
      )}
    </>
  );
}
