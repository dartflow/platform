"use client";
import { useEffect, useRef, useState } from "react";
type Message = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};
export default function MatchChat({ matchId }: { matchId: string }) {
  const [messages, setMessages] = useState<Message[]>([]),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stop = false;
    const refresh = async () => {
      try {
        const r = await fetch(
          `/api/platform/matches/${encodeURIComponent(matchId)}/chat`,
          { cache: "no-store" },
        );
        const d = await r.json();
        if (!r.ok)
          throw new Error(d.error || "Wedstrijdchat is niet beschikbaar.");
        if (!stop) {
          setMessages(d.messages);
          setError("");
        }
      } catch (e) {
        if (!stop)
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
      stop = true;
      clearInterval(timer);
    };
  }, [matchId]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);
  return (
    <section className="panel match-chat">
      <h2>Wedstrijdchat</h2>
      <div className="workspace-messages" aria-live="polite">
        {messages.map((message) => (
          <article className="workspace-message" key={message.id}>
            <header>
              <strong>{message.authorName}</strong>
              <time>
                {new Date(message.createdAt).toLocaleTimeString("nl-NL", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </header>
            <p>{message.body}</p>
          </article>
        ))}
        {!messages.length && !error && (
          <p className="muted-copy">
            Overleg met je tegenstander, bijvoorbeeld over de opstelling of een
            correctie.
          </p>
        )}
        <div ref={bottom} />
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <form
        className="workspace-message-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            const r = await fetch(
              `/api/platform/matches/${encodeURIComponent(matchId)}/chat`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId: crypto.randomUUID(), body }),
              },
            );
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "Versturen is niet gelukt.");
            setBody("");
            setError("");
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Versturen is niet gelukt.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="sr-only" htmlFor="match-chat-message">
          Wedstrijdbericht
        </label>
        <input
          id="match-chat-message"
          maxLength={2000}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Bericht aan je tegenstander…"
        />
        <button className="button gold" disabled={busy || !body.trim()}>
          Versturen
        </button>
      </form>
    </section>
  );
}
