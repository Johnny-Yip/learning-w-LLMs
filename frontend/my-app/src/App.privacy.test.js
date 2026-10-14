import { render, screen, act, waitFor } from '@testing-library/react';
import App from './App';
import useAuthStore from './state/authStore';
import * as authApi from './lib/authApi';
import * as sessionApi from './lib/sessionApi';

jest.mock('./components/ui/toast', () => ({ ToastContainer: () => null, toastBus: { publish: jest.fn() } }));
jest.mock('./Pages/ChatInterface', () => () => null);
const response = body => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
let revision = 0;
let lockTail = Promise.resolve();
const authenticate = id => {
  authApi.setAccessToken('test-token');
  useAuthStore.setState({ user: { _id: id, name: `User ${id}`, profile: {} }, isAuthenticated: true, isLoading: false });
};
beforeEach(async () => {
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => `ui-${++revision}` } });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name, _options, callback) => {
    const next = lockTail.then(callback); lockTail = next.catch(() => {}); return next;
  } } });
  global.fetch = jest.fn().mockResolvedValue(response({ data: { revocationConfirmed: true } }));
  await authApi.logout();
  jest.spyOn(useAuthStore.getState(), 'initialize').mockImplementation(async () => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  window.history.replaceState({}, '', '/history');
});
afterEach(() => jest.restoreAllMocks());

test('mounted History and recent-chat caches clear when B replaces A, and A can reload history', async () => {
  authenticate('A');
  const saved = { id: 'A-session', chatTitle: 'Private A history', mode: 'studying', createdAt: new Date().toISOString(), progressPct: 30, plan: [{ id: 'module' }] };
  let releaseB;
  const pendingB = new Promise(resolve => { releaseB = resolve; });
  const list = jest.spyOn(sessionApi, 'getSessions').mockResolvedValue({ success: true, data: { sessions: [saved] } });
  render(<App />);
  await screen.findAllByText('Private A history');
  list.mockReturnValue(pendingB);
  act(() => authenticate('B'));
  expect(screen.queryByText('Private A history')).not.toBeInTheDocument();
  await act(async () => releaseB({ success: true, data: { sessions: [] } }));
  await waitFor(() => expect(screen.queryByText('Private A history')).not.toBeInTheDocument());
  list.mockResolvedValue({ success: true, data: { sessions: [saved] } });
  act(() => authenticate('A'));
  await screen.findAllByText('Private A history');
});
