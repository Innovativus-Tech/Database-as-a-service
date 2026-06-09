const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const TOKEN_KEY = 'customdb.token';
const EMAIL_KEY = 'customdb.email';

export function setSession({ token, email }) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
  if (email) localStorage.setItem(EMAIL_KEY, email);
}
export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}
export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function getEmail() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(EMAIL_KEY);
}

async function request(path, { method = 'GET', body, formData, headers = {} } = {}) {
  const token = getToken();
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  } else if (formData) {
    init.body = formData; // browser sets multipart boundary
  }

  const res = await fetch(`${API_URL}${path}`, init);
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((payload && payload.error) || res.statusText || 'Request failed');
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

export const api = {
  signup: (email, password) => request('/api/auth/signup', { method: 'POST', body: { email, password } }),
  login:  (email, password) => request('/api/auth/login',  { method: 'POST', body: { email, password } }),
  me:     () => request('/api/auth/me'),
  listDatabases:  () => request('/api/databases'),
  getDatabase:    (id) => request(`/api/databases/${id}`),
  getStats:       (id) => request(`/api/databases/${id}/stats`),
  createDatabase: (name, type) => request('/api/databases/create', { method: 'POST', body: { name, type } }),
  deleteDatabase: (id) => request(`/api/databases/${id}`, { method: 'DELETE' }),
  importFile:     (id, file, target) => {
    const fd = new FormData();
    fd.append('file', file);
    const qs = target ? `?target=${encodeURIComponent(target)}` : '';
    return request(`/api/databases/${id}/import${qs}`, { method: 'POST', formData: fd });
  },
};
