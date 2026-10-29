// Browser side of the first-party usage counter (lib/usage-events.ts). Sends only the event name.
// sendBeacon first; a keepalive POST without credentials as the fallback. Every failure is silent.
export const USAGE_ENDPOINT = '/api/usage-event';
export function sendUsage(event: 'search' | 'card_click' | 'apply_click'): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(USAGE_ENDPOINT, new Blob([event], { type: 'text/plain' }))) return;
    if (typeof fetch === 'function') fetch(USAGE_ENDPOINT, { method: 'POST', body: event, headers: { 'content-type': 'text/plain' }, credentials: 'omit', keepalive: true }).catch(() => {});
  } catch { /* never affects the page */ }
}
