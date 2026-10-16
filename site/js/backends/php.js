// Comptes par l'API PHP de Recto (site/api) : il faut un hébergement avec PHP 8.1+ et HTTPS.
import { api, ApiError } from '../api.js';

export const phpBackend = {
  kind: 'php',
  loginLabel: 'Pseudo ou adresse e-mail',
  loginType: 'text',
  canResetPassword: false,
  me: async () => (await api('me')).user,
  register: async (username, email, password) => (await api('register', { method: 'POST', body: { username, email, password } })).user,
  login: async (login, password) => (await api('login', { method: 'POST', body: { login, password } })).user,
  logout: () => api('logout', { method: 'POST' }).catch(() => {}),
  deleteAccount: (password) => api('account/delete', { method: 'POST', body: { password } }),
  resetPassword: async () => { throw new ApiError(400, 'not_supported'); },
  listSets: async () => (await api('sets')).sets,
  saveSet: (set, { keepalive = false } = {}) => api('set', { method: 'PUT', body: { set }, keepalive }),
  deleteSet: (id) => api('set/delete', { method: 'POST', body: { id } }),
};
