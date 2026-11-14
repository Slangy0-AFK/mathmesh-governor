const TOKEN_KEY = 'mathmesh_session';

function currentToken() {
  return typeof window === 'undefined' ? '' : window.localStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('accept', 'application/json');
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const token = currentToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.response = { status: response.status, data };
    throw error;
  }
  return data;
}

function entityClient(entity) {
  return {
    list: (sort = '-created_date', limit = 100) => request(`/api/entities/${entity}/list?sort=${encodeURIComponent(sort)}&limit=${limit}`),
    filter: (criteria = {}, sort = '-created_date', limit = 100) => request(`/api/entities/${entity}/filter`, { method: 'POST', body: { criteria, sort, limit } }),
    create: (record) => request(`/api/entities/${entity}/create`, { method: 'POST', body: record }),
    update: (id, patch) => request(`/api/entities/${entity}/update`, { method: 'POST', body: { id, patch } }),
    delete: (id) => request(`/api/entities/${entity}/delete`, { method: 'POST', body: { id } }),
  };
}

export const apiClient = {
  entities: new Proxy({}, { get: (_target, entity) => entityClient(entity) }),
  functions: {
    invoke: async (name, body = {}) => ({ data: await request(`/api/functions/${name}`, { method: 'POST', body }) }),
  },
  auth: {
    me: () => request('/api/auth/me'),
    loginViaEmailPassword: async (email, password) => {
      const session = await request('/api/auth/login', { method: 'POST', body: { email, password } });
      setToken(session.access_token);
      return session;
    },
    setToken,
    logout: (redirect = false) => {
      setToken('');
      if (redirect && typeof window !== 'undefined') window.location.href = '/login';
    },
    redirectToLogin: () => {
      if (typeof window !== 'undefined') window.location.href = '/login';
    },
  },
};
