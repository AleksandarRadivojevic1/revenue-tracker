// ntfy push alerts — same NTFY_URL / NTFY_TOPIC / NTFY_TOKEN convention as
// seo-cockpit, so both apps reach the same phone. Only for problems that
// would otherwise be silent (a backup that failed or never ran); never for
// routine success — a channel that cries wolf gets ignored.
//
// Never throws: an unreachable ntfy must not break the thing it reports on.

/** { url, topic, token } from the environment, or null when alerts are off. */
export function ntfyConfig(env = process.env) {
  const url = String(env.NTFY_URL || '').trim().replace(/\/+$/, '');
  const topic = String(env.NTFY_TOPIC || '').trim();
  if (!url || !topic) return null;
  return { url, topic, token: String(env.NTFY_TOKEN || '').trim() || null };
}

export const PRIORITY_HIGH = 4; // buzzes the phone

/** Send one alert. Resolves true if ntfy accepted it, false if off or failed. */
export async function notify(
  { title, message, priority = PRIORITY_HIGH, tags = [] },
  { config = ntfyConfig(), fetchImpl = fetch, timeoutMs = 10000 } = {}
) {
  if (!config) {
    console.warn(`[notify] ntfy not configured — not sent: ${title}`);
    return false;
  }
  // HTTP headers are latin-1 only; keep the title ASCII (body is UTF-8).
  const headers = {
    Title: String(title).replace(/[^\x20-\x7E]/g, '-'),
    Priority: String(priority),
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (tags.length) headers.Tags = tags.join(',');
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  try {
    const res = await fetchImpl(`${config.url}/${config.topic}`, {
      method: 'POST', headers, body: message, signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error(`[notify] ntfy publish failed (${config.url}/${config.topic}): ${err.message}`);
    return false;
  }
}
