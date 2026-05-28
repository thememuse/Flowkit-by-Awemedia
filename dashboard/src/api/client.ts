/**
 * API client — works in both browser (Vite dev) and Electron (production).
 *
 * In Electron, the Python agent runs at http://127.0.0.1:8100.
 * In browser dev mode, Vite proxies /api → 127.0.0.1:8100.
 */

// Detect Electron environment
const isElectron = typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI;

// In Electron, use absolute URL. In browser, use relative (proxied by Vite).
const BASE = isElectron ? 'http://127.0.0.1:8100' : '';

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${err}`);
  }
  return res.json();
}

export async function patchAPI<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return fetchAPI<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function postAPI<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return fetchAPI<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function deleteAPI<T>(path: string): Promise<T> {
  return fetchAPI<T>(path, { method: 'DELETE' });
}

export { BASE };
