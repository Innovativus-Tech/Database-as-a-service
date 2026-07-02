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
  signup: ({ email, password, fullName, organizationName }) =>
    request('/api/auth/signup', { method: 'POST', body: { email, password, fullName, organizationName } }),
  login:  (email, password, totp) => request('/api/auth/login',  { method: 'POST', body: { email, password, ...(totp ? { totp } : {}) } }),
  forgotPassword: (email) => request('/api/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword:  ({ token, password }) => request('/api/auth/reset-password', { method: 'POST', body: { token, password } }),
  me:     () => request('/api/auth/me'),
  updateProfile:  (data) => request('/api/auth/me', { method: 'PATCH', body: data }),
  changePassword: (data) => request('/api/auth/password', { method: 'POST', body: data }),
  deleteAccount:  () => request('/api/auth/me', { method: 'DELETE', body: { confirm: 'CONFIRM' } }),

  getSessions:   () => request('/api/auth/sessions'),
  revokeSession: (id) => request(`/api/auth/sessions/${id}`, { method: 'DELETE' }),

  setup2FA:   () => request('/api/auth/2fa/setup', { method: 'POST' }),
  verify2FA:  (code) => request('/api/auth/2fa/verify', { method: 'POST', body: { code } }),
  disable2FA: (code) => request('/api/auth/2fa/disable', { method: 'POST', body: { code } }),

  listDatabases:  () => request('/api/databases'),
  getDatabase:    (id) => request(`/api/databases/${id}`),
  getStats:       (id) => request(`/api/databases/${id}/stats`),
  createDatabase: (name, type) => request('/api/databases/create', { method: 'POST', body: { name, type } }),
  startDatabase:  (id) => request(`/api/databases/${id}/start`, { method: 'POST' }),
  deleteDatabase: (id) => request(`/api/databases/${id}`, { method: 'DELETE' }),
  importFile:     (id, file, target) => {
    const fd = new FormData();
    fd.append('file', file);
    const qs = target ? `?target=${encodeURIComponent(target)}` : '';
    return request(`/api/databases/${id}/import${qs}`, { method: 'POST', formData: fd });
  },
  getImportJobStatus: (id, jobId) => request(`/api/databases/${id}/import/${jobId}/status`),

  listSchemas: (id) => request(`/api/databases/${id}/schemas`),
  createSchema: (id, payload) => request(`/api/databases/${id}/schemas`, { method: 'POST', body: payload }),
  dropSchema: (id, name) => request(`/api/databases/${id}/schemas/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  listCollections: (id, schema) => {
    const qs = schema ? `?schema=${encodeURIComponent(schema)}` : '';
    return request(`/api/databases/${id}/collections${qs}`);
  },
  createCollection: (id, payload) => request(`/api/databases/${id}/collections`, { method: 'POST', body: payload }),
  dropCollection: (id, name, schema) => {
    const qs = schema ? `?schema=${encodeURIComponent(schema)}` : '';
    return request(`/api/databases/${id}/collections/${encodeURIComponent(name)}${qs}`, { method: 'DELETE' });
  },
  getColumnTypes: () => request('/api/databases/columnTypes'),
  browseCollection: (id, name, { skip = 0, limit = 50, filter, schema } = {}) => {
    const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    if (filter) params.set('filter', filter);
    if (schema) params.set('schema', schema);
    return request(`/api/databases/${id}/collections/${encodeURIComponent(name)}?${params}`);
  },
  updateDocument: (id, name, docId, payload, schema) =>
    request(`/api/databases/${id}/collections/${encodeURIComponent(name)}/${encodeURIComponent(docId)}`, {
      method: 'PUT', body: schema ? { ...payload, schema } : payload,
    }),
  deleteDocument: (id, name, docId, schema) => {
    const qs = schema ? `?schema=${encodeURIComponent(schema)}` : '';
    return request(`/api/databases/${id}/collections/${encodeURIComponent(name)}/${encodeURIComponent(docId)}${qs}`, { method: 'DELETE' });
  },
};
