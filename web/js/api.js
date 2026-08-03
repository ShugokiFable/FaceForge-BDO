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

function withTimeout(signal, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return { signal, cancelTimeout: () => {} };
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason ?? new DOMException('The request was canceled.', 'AbortError'));
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason ?? new DOMException('The request was canceled.', 'AbortError'));
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`The request took longer than ${Math.round(timeoutMs / 1000)} seconds.`, 'TimeoutError'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cancelTimeout: () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  };
}

function humanizeRequestError(error) {
  if (error?.name === 'AbortError') return 'The request was canceled.';
  if (error?.name === 'TimeoutError') return error.message || 'The request timed out.';
  return error?.message || 'The request failed.';
}

export async function api(path, options = {}) {
  const { timeoutMs = 0, signal, headers, ...rest } = options;
  const timeout = withTimeout(signal, timeoutMs);
  try {
    const response = await fetch(path, {
      ...rest,
      signal: timeout.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-FaceForge-Token': token,
        ...(headers ?? {})
      }
    });
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
    return payload;
  } catch (error) {
    throw new Error(humanizeRequestError(error));
  } finally {
    timeout.cancelTimeout();
  }
}

export const apiGet = (path, options = {}) => api(path, { method: 'GET', ...options });
export const apiPost = (path, body = {}, options = {}) => api(path, { method: 'POST', body: JSON.stringify(body), ...options });
