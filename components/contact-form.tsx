"use client";
import { useEffect, useRef, useState } from "react";
import { CONTACT_EMAIL, CONTACT_LIMITS, CONTACT_RELAY_URL, contactError, contactPayload } from "@/lib/contact";

type Status = { kind: "idle" | "sending" | "sent" | "error"; text?: string };

export function ContactForm() {
  const startedAt = useRef(0);
  const successRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  useEffect(() => {
    if (status.kind === "sent") successRef.current?.focus();
  }, [status.kind]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { name, email, message, honeypot };
    const problem = contactError(input);
    if (problem) {
      setStatus({ kind: "error", text: problem });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const response = await fetch(CONTACT_RELAY_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(contactPayload(input, startedAt.current)),
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setStatus({ kind: "error", text: data?.error || "Your message could not be sent." });
        return;
      }
      setName("");
      setEmail("");
      setMessage("");
      setStatus({ kind: "sent" });
    } catch {
      setStatus({ kind: "error", text: "Your message could not be sent." });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="contact-success" role="status" aria-live="polite" tabIndex={-1} ref={successRef}>
        <h2>Thanks, your message is on its way.</h2>
        <p>
          We read every message and will reply by email, usually within a couple of business days. A short
          confirmation with a copy of your message is headed to your inbox.
        </p>
        <button
          className="btn secondary"
          type="button"
          onClick={() => {
            startedAt.current = Date.now();
            setStatus({ kind: "idle" });
          }}
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form className="contact-form" method="post" onSubmit={submit} noValidate>
      <div className="contact-trap" aria-hidden="true">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
        />
      </div>
      <label>
        Name
        <input
          name="name"
          autoComplete="name"
          required
          maxLength={CONTACT_LIMITS.name}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={CONTACT_LIMITS.email}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        Message
        <textarea
          name="message"
          required
          rows={6}
          minLength={CONTACT_LIMITS.messageMin}
          maxLength={CONTACT_LIMITS.messageMax}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </label>
      <p className="contact-note">
        Only your name, email and message are sent. Please don’t include Social Security numbers, bank details or
        passwords.
      </p>
      <button className="btn primary" type="submit" disabled={status.kind === "sending"}>
        {status.kind === "sending" ? "Sending…" : "Send message"}
      </button>
      {status.kind === "error" && (
        <p className="contact-error" role="alert">
          {status.text} You can also write to {CONTACT_EMAIL}.
        </p>
      )}
    </form>
  );
}
