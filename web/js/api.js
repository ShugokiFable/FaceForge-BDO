const tokenFromHash = () => {
  const match = location.hash.match(/(?:^#|&)token=([^&]+)/);
  if (match) {
    const token = decodeURIComponent(match[1]);
    sessionStorage.setItem('faceforge-bdo-token', token);
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    return token;
  }
  return sessionStorage.getItem('faceforge-bdo-token') ?? '';
};

let token = tokenFromHash();

export const hasToken = () => Boolean(token);
export const setToken = (value) => { token = value; sessionStorage.setItem('faceforge-bdo-token', value); };

export async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-FaceForge-Token': token,
      ...(options.headers ?? {})
    }
  });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
  return payload;
}

export const apiGet = (path) => api(path, { method: 'GET' });
export const apiPost = (path, body = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });
