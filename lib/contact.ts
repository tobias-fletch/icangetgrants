// Contact form for I Can Get Grants. The browser posts straight to the shared
// contact relay on tobiasfletcher.com, so this Worker makes no subrequests.
export const CONTACT_RELAY_URL = "https://tobiasfletcher.com/api/contact";
export const CONTACT_EMAIL = "hello@icangetgrants.com";
export const CONTACT_LIMITS = { name: 100, email: 254, messageMin: 10, messageMax: 5000 } as const;

export type ContactInput = { name: string; email: string; message: string; honeypot: string };

export function contactError(input: ContactInput): string | null {
  if (!input.name.trim()) return "Add your name.";
  if (input.name.trim().length > CONTACT_LIMITS.name) return "Use a shorter name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || input.email.trim().length > CONTACT_LIMITS.email) {
    return "Add a valid email address so we can reply.";
  }
  const length = input.message.trim().length;
  if (length < CONTACT_LIMITS.messageMin) return "Your message needs at least 10 characters.";
  if (length > CONTACT_LIMITS.messageMax) return "Keep your message under 5,000 characters.";
  return null;
}

export function contactPayload(input: ContactInput, startedAt: number) {
  return {
    site: "icangetgrants",
    name: input.name.trim(),
    email: input.email.trim(),
    message: input.message.trim(),
    honeypot: input.honeypot,
    startedAt,
    page: "/contact",
  };
}
