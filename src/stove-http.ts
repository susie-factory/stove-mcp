/** Stove HTTP API envelope — same shape as official DApp client. */
export interface StoveEnvelope<T = unknown> {
  code: number;
  message?: string;
  details?: string;
  data?: T;
}

export const DEFAULT_STOVE_API_BASE = 'https://proto.stove.finance';

export function getStoveBaseUrl(): string {
  const u = process.env.STOVE_API_BASE_URL?.trim();
  return u && u.length > 0 ? u.replace(/\/$/, '') : DEFAULT_STOVE_API_BASE;
}

export function getMakerJwtFromEnv(): string | undefined {
  const j = process.env.STOVE_MAKER_JWT?.trim();
  return j && j.length > 0 ? j : undefined;
}

export type StoveRequestInit = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  jwt?: string;
};

export async function stoveRequest<T = unknown>(
  path: string,
  init: StoveRequestInit = {},
): Promise<{ ok: true; envelope: StoveEnvelope<T> } | { ok: false; error: string }> {
  const base = getStoveBaseUrl();
  const rel = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(rel, base.endsWith('/') ? base : `${base}/`);

  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (init.jwt) headers.Authorization = `Bearer ${init.jwt}`;

  const method = init.method ?? 'GET';
  const res = await fetch(url, {
    method,
    headers,
    body: method !== 'GET' && init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = raw.length ? JSON.parse(raw) : null;
  } catch {
    return {
      ok: false,
      error: `Non-JSON response (HTTP ${res.status}): ${raw.slice(0, 800)}`,
    };
  }

  const env = parsed as StoveEnvelope<T>;
  if (!res.ok) {
    const msg = env?.message ?? res.statusText;
    return { ok: false, error: `HTTP ${res.status}: ${msg}` };
  }

  if (env && typeof env === 'object' && 'code' in env && env.code !== 0) {
    const detail = env.details ? ` — ${env.details}` : '';
    return {
      ok: false,
      error: `Stove API code ${env.code}: ${env.message ?? 'unknown'}${detail}`,
    };
  }

  return { ok: true, envelope: env };
}

export function formatEnvelope<T>(envelope: StoveEnvelope<T>): string {
  return JSON.stringify(envelope, null, 2);
}
