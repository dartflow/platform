"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClubChannel,
  ClubChannelPage,
  ClubhouseCommand,
  ClubTeam,
} from "@/lib/clubhouse-types";
import { CommunityRulesGate, SafetyActions } from "./player-safety";

type Page = ClubChannelPage & {
  nextBefore?: number | null;
  hasMoreBefore?: boolean;
};
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(value.error ?? "De chat kon niet worden geladen."),
      { status: response.status },
    );
  return value;
}
export default function ClubhouseChat({
  clubId,
  actorId,
  channels,
  canManage,
  teams,
}: {
  clubId: string;
  actorId: string;
  channels: ClubChannel[];
  canManage: boolean;
  teams: ClubTeam[];
}) {
  const [open, setOpen] = useState(false),
    [large, setLarge] = useState(false),
    [channelId, setChannelId] = useState(channels[0]?.id ?? clubId),
    [page, setPage] = useState<Page | null>(null),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [optimistic, setOptimistic] = useState<{
      id: string;
      body: string;
      failed: boolean;
    } | null>(null);
  const dialog = useRef<HTMLElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    log = useRef<HTMLDivElement>(null),
    pending = useRef<ClubhouseCommand | null>(null),
    cursor = useRef(0),
    generation = useRef(0),
    alive = useRef(false),
    readCursor = useRef(0),
    request = useRef(false),
    cache = useRef(new Map<string, Page>());
  const stopRequests = useCallback(() => {
    alive.current = false;
    generation.current++;
    request.current = false;
  }, []);
  const draftKey = `dartflow-chat:${actorId}:${clubId}:${channelId}`;
  const refresh = useCallback(
    async (older = false) => {
      if (request.current) return;
      request.current = true;
      const n = ++generation.current;
      const node = log.current,
        oldHeight = node?.scrollHeight ?? 0,
        nearEnd = node
          ? node.scrollHeight - node.scrollTop - node.clientHeight < 80
          : true;
      try {
        const before = older
          ? cache.current.get(channelId)?.messages[0]?.sequence
          : undefined;
        const next = await api<Page>(
          `/api/clubhouse/${clubId}/channels/${channelId}?${before ? `before=${before}` : `after=${cursor.current}`}`,
        );
        if (!alive.current || n !== generation.current) return;
        const old = cache.current.get(channelId);
        const merged = [
          ...new Map(
            [...(old?.messages ?? []), ...next.messages].map((m) => [m.id, m]),
          ).values(),
        ].sort((a, b) => a.sequence - b.sequence);
        const combined = {
          ...next,
          messages: merged,
          ...(!older
            ? {
                nextBefore: old?.nextBefore ?? next.nextBefore,
                hasMoreBefore: old?.hasMoreBefore ?? next.hasMoreBefore,
              }
            : {}),
        };
        cache.current.set(channelId, combined);
        cursor.current = Math.max(cursor.current, next.cursor);
        setPage(combined);
        setDenied(false);
        setError("");
        requestAnimationFrame(() => {
          if (!node) return;
          if (older) node.scrollTop += node.scrollHeight - oldHeight;
          else if (nearEnd) node.scrollTop = node.scrollHeight;
        });
        if (!older && next.cursor > readCursor.current) {
          readCursor.current = next.cursor;
          void api("/api/clubhouse/actions", {
            requestId: crypto.randomUUID(),
            action: {
              type: "channel.read",
              clubId,
              channelId,
              cursor: next.cursor,
            },
          }).catch(() => {});
        }
      } catch (e) {
        if (alive.current && n === generation.current) {
          setError((e as Error).message);
          if ([401, 403, 404].includes((e as { status: number }).status)) {
            cache.current.delete(channelId);
            setPage(null);
            setDenied(true);
          }
        }
      } finally {
        request.current = false;
      }
    },
    [channelId, clubId],
  );
  useEffect(() => {
    if (!open) return;
    alive.current = true;
    generation.current++;
    request.current = false;
    cursor.current = 0;
    readCursor.current = 0;
    setPage(cache.current.get(channelId) ?? null);
    setDenied(false);
    try {
      setDraft(localStorage.getItem(draftKey) ?? "");
      const stored = JSON.parse(
        localStorage.getItem(`${draftKey}:pending`) ?? "null",
      );
      if (
        stored &&
        typeof stored.requestId === "string" &&
        /^[a-f0-9-]{36}$/.test(stored.requestId) &&
        stored.action?.type === "channel.message" &&
        stored.action.clubId === clubId &&
        stored.action.channelId === channelId &&
        typeof stored.action.body === "string" &&
        stored.action.body.length <= 2000
      ) {
        pending.current = {
          requestId: stored.requestId,
          action: {
            type: "channel.message",
            clubId,
            channelId,
            body: stored.action.body,
          },
        };
        setDraft(stored.action.body);
        setOptimistic({
          id: stored.requestId,
          body: stored.action.body,
          failed: true,
        });
      }
    } catch {
      setDraft("");
    }
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 2500);
    const wake = () => void refresh();
    window.addEventListener("online", wake);
    return () => {
      stopRequests();
      clearInterval(timer);
      window.removeEventListener("online", wake);
    };
  }, [open, clubId, channelId, draftKey, refresh, stopRequests]);
  const close = useCallback(() => {
    setOpen(false);
    if (history.state?.dartflowClubChat === clubId) history.back();
    requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true }),
    );
  }, [clubId]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    history.pushState(
      { ...history.state, dartflowClubChat: clubId },
      "",
      location.href,
    );
    const back = () => setOpen(false);
    window.addEventListener("popstate", back);
    dialog.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab") {
        const items = dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],input:not(:disabled)",
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("popstate", back);
      document.removeEventListener("keydown", escape);
    };
  }, [open, clubId, close]);
  const send = async (
    action: ClubhouseCommand["action"],
    revision?: number,
  ) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const command = pending.current ?? {
      requestId: crypto.randomUUID(),
      ...(revision !== undefined ? { expectedRevision: revision } : {}),
      action,
    };
    pending.current = command;
    if (command.action.type === "channel.message")
      setOptimistic({
        id: command.requestId,
        body: String(command.action.body),
        failed: false,
      });
    try {
      if (command.action.type === "channel.message") {
        try {
          localStorage.setItem(`${draftKey}:pending`, JSON.stringify(command));
        } catch {
          throw new Error(
            "Toestelopslag is niet beschikbaar. Je bericht is nog niet verstuurd; herstel de opslag en probeer hetzelfde bericht opnieuw.",
          );
        }
      }
      await api("/api/clubhouse/actions", command);
      window.dispatchEvent(new Event("dartflow-clubhouse-changed"));
      if (command.action.type === "channel.message") {
        setOptimistic(null);
        try {
          localStorage.removeItem(draftKey);
          localStorage.removeItem(`${draftKey}:pending`);
        } catch {
          throw new Error(
            "Het bericht is geaccepteerd, maar het lokale verzendbewijs kan nog niet worden gewist. Probeer dezelfde actie opnieuw; de server voegt geen tweede bericht toe.",
          );
        }
        setDraft("");
      }
      pending.current = null;
      if (command.action.type === "channel.archive") setChannelId(clubId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setOptimistic((old) => (old ? { ...old, failed: true } : null));
      if ((e as { status: number }).status < 500) {
        try {
          if (command.action.type === "channel.message")
            localStorage.removeItem(`${draftKey}:pending`);
          pending.current = null;
        } catch {
          /* Retain the same request until cleanup succeeds. */
        }
        setOptimistic(null);
      }
      if ([401, 403, 404].includes((e as { status: number }).status)) {
        setPage(null);
        cache.current.clear();
        setDenied(true);
      }
    } finally {
      setBusy(false);
    }
  };
  const unread = channels.reduce((n, c) => n + c.unread, 0),
    current = page?.channel ?? channels.find((c) => c.id === channelId);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="ch-chat-launcher"
        aria-expanded={open}
        aria-controls={`club-chat-${clubId}`}
        onClick={() => (open ? close() : setOpen(true))}
      >
        ◌ Verenigingschat
        {unread > 0 && <span className="ch-status">{unread}</span>}
      </button>
      {open && (
        <button
          className="ch-chat-scrim"
          aria-label="Chatvenster sluiten"
          onClick={close}
        />
      )}
      {open && (
        <section
          className={`ch-chat-window ${large ? "is-large" : ""}`}
          id={`club-chat-${clubId}`}
          ref={dialog}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="Verenigingschat"
        >
          <header className="ch-chat-head">
            <strong>Verenigingschat</strong>
            <button
              type="button"
              onClick={() => setLarge(!large)}
              aria-label={large ? "Chat verkleinen" : "Chat vergroten"}
            >
              {large ? "↙" : "↗"}
            </button>
            <button type="button" onClick={close} aria-label="Chat sluiten">
              ×
            </button>
          </header>
          <div className="ch-chat-body">
            <label className="field">
              Kanaal
              <select
                value={channelId}
                disabled={Boolean(pending.current)}
                onChange={(e) => setChannelId(e.target.value)}
              >
                {channels.map((channel) => (
                  <option value={channel.id} key={channel.id}>
                    {channel.name}
                    {channel.unread ? ` (${channel.unread})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <div
              ref={log}
              className="ch-chat-log"
              role="log"
              aria-label="Chatberichten"
              aria-live="polite"
            >
              {page?.hasMoreBefore && (
                <button
                  className="button ghost"
                  onClick={() => void refresh(true)}
                >
                  Eerdere berichten laden
                </button>
              )}
              {page?.messages.map((item) => (
                <article
                  className={`ch-message ${item.authorId === actorId ? "is-own" : ""}`}
                  key={item.id}
                >
                  <header>
                    <strong>{item.authorName}</strong>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString("nl-NL", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </header>
                  <p>{item.deleted ? "Bericht verwijderd." : item.body}</p>
                  {!item.deleted &&
                    (item.authorId === actorId || current?.canModerate) && (
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() =>
                          void send({
                            type: "channel.message.delete",
                            clubId,
                            channelId,
                            messageId: item.id,
                          })
                        }
                      >
                        Verwijderen
                      </button>
                    )}
                  {!item.deleted && item.authorId !== actorId && (
                    <SafetyActions
                      targetType="message"
                      targetId={item.id}
                      userId={item.authorId}
                      scopeKind="club"
                      scopeId={clubId}
                      onChanged={() => void refresh()}
                    />
                  )}
                </article>
              ))}
              {optimistic && (
                <article className="ch-message is-pending">
                  <strong>Jij</strong>
                  <p>{optimistic.body}</p>
                  <small>
                    {optimistic.failed
                      ? "Versturen niet bevestigd. Je bericht blijft bewaard."
                      : "Versturen…"}
                  </small>
                </article>
              )}
              {page && !page.messages.length && (
                <p>Nog geen berichten in dit kanaal.</p>
              )}
              {!page && !error && <p>Berichten ophalen…</p>}
            </div>
            {pending.current && (
              <button
                className="button ghost"
                disabled={busy || denied}
                onClick={() =>
                  void send(
                    pending.current!.action,
                    pending.current!.expectedRevision,
                  )
                }
              >
                Dezelfde actie opnieuw proberen
              </button>
            )}
            <CommunityRulesGate>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send({
                    type: "channel.message",
                    clubId,
                    channelId,
                    body: draft,
                  });
                }}
              >
                <label className="field">
                  Chatbericht
                  <textarea
                    rows={3}
                    maxLength={2000}
                    required
                    value={draft}
                    disabled={
                      denied || !current?.canWrite || Boolean(pending.current)
                    }
                    onChange={(e) => {
                      const next = e.target.value;
                      setDraft(next);
                      try {
                        localStorage.setItem(draftKey, next);
                      } catch {
                        setError(
                          "Dit concept kan niet op het toestel worden bewaard. Laat de chat open tot je het hebt verstuurd.",
                        );
                      }
                    }}
                  />
                </label>
                <button
                  className="button gold"
                  disabled={
                    busy ||
                    denied ||
                    !current?.canWrite ||
                    !draft.trim() ||
                    Boolean(pending.current)
                  }
                >
                  Bericht versturen
                </button>
              </form>
            </CommunityRulesGate>
            {current?.canWrite === false && (
              <p>
                Je kunt dit kanaal lezen. Je hebt momenteel geen schrijfrecht.
              </p>
            )}
            {canManage && (
              <details>
                <summary>Kanalen beheren</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void send(
                      {
                        type: "channel.save",
                        clubId,
                        name: String(f.get("name")),
                        kind: String(f.get("kind")),
                        teamId: String(f.get("teamId")) || null,
                        writePolicy: String(f.get("writePolicy")),
                      },
                      0,
                    );
                  }}
                >
                  <label className="field">
                    Kanaalnaam
                    <input name="name" required maxLength={80} />
                  </label>
                  <label className="field">
                    Kanaaltype
                    <select name="kind">
                      <option value="team">Teamkanaal</option>
                      <option value="board">Bestuurskanaal</option>
                    </select>
                  </label>
                  <label className="field">
                    Team
                    <select name="teamId">
                      <option value="">Niet van toepassing</option>
                      {teams
                        .filter((t) => t.active)
                        .map((team) => (
                          <option value={team.id} key={team.id}>
                            {team.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    Wie mag schrijven?
                    <select name="writePolicy">
                      <option value="members">Huidige kanaalleden</option>
                      <option value="managers">Alleen kanaalbeheerders</option>
                    </select>
                  </label>
                  <button className="button gold" disabled={busy}>
                    Kanaal aanmaken
                  </button>
                </form>
                {current?.canManage && current.kind !== "general" && (
                  <button
                    className="button ghost"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        { type: "channel.archive", clubId, id: current.id },
                        current.revision,
                      )
                    }
                  >
                    Dit kanaal archiveren
                  </button>
                )}
              </details>
            )}
          </div>
        </section>
      )}
    </>
  );
}
