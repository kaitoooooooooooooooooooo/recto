// Appels à l'API PHP (api/index.php).
export class ApiError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; Object.assign(this, extra); }
}

// `keepalive` : la requête part même si la page se ferme (petits envois seulement).
export async function api(route, { method = 'GET', body, keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(`api/index.php?r=${route}`, {
      method, credentials: 'same-origin', keepalive,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Recto': '1' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const json = await res.json().catch(() => null);
  if (!json) throw new ApiError(res.status, 'no_api');
  if (!res.ok || !json.ok) throw new ApiError(res.status, json.error || 'server_error', json);
  return json;
}
