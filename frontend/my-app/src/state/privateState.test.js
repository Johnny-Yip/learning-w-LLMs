import useAuthStore from './authStore';
import useSessionStore from './sessionStore';
import useToastStore from './toastStore';
import * as authApi from '../lib/authApi';
import * as sessionApi from '../lib/sessionApi';
import * as profileApi from '../lib/profileApi';
import * as assessmentApi from '../lib/assessmentApi';
import * as quizApi from '../lib/quizApi';
import * as chatApi from '../lib/chatApi';
import { guardedFetch } from '../lib/privateScope';

jest.mock('../components/ui/toast', () => ({ toastBus: { publish: jest.fn() } }));
const response = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(body), json: async () => body,
});
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const token = `header.${btoa(JSON.stringify({ exp: 4102444800 }))}.signature`;
let lockTail = Promise.resolve();
let revision = 0;
const account = id => ({ _id: id, name: `User ${id}`, profile: { background: `${id} profile` } });
const authenticate = id => {
  authApi.setAccessToken(token);
  useAuthStore.setState({ user: account(id), accessToken: token, isAuthenticated: true });
};
const privateData = {
  sessionId: 'A-session', topic: 'A topic', chatTitle: 'A title',
  messages: [{ id: 'A-message', role: 'user', content: 'A private message' }],
  profile: { name: 'A profile' }, plan: [{ id: 'A-module', title: 'A plan' }],
  points: 40, gems: 2, progressPct: 40, meta: { outstandingCheck: 'A check' },
  courseId: 'A-course', courseTopicId: 'A-course-topic', courseName: 'A course', courseTopicTitle: 'A lesson',
  quizDraft: [{ question: 'A question' }], quizResult: { feedback: 'A feedback' },
  pendingQuizModuleId: 'A-module', loading: true, isQuizSubmitting: true, error: 'A error',
};
const expectClean = () => {
  expect(useSessionStore.getState()).toMatchObject({
    sessionId: null, topic: '', chatTitle: '', messages: [], profile: null, plan: [],
    points: 0, gems: 0, progressPct: 0, courseId: null, courseTopicId: null,
    courseName: null, courseTopicTitle: null, quizDraft: null, quizResult: null,
    pendingQuizModuleId: null, loading: false, isQuizSubmitting: false, error: null,
    meta: { outstandingCheck: null, countSinceLastCheck: 0, assessClarifyCount: 0 },
  });
  expect(localStorage.getItem('session-storage')).toBeNull();
};
beforeEach(async () => {
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => `privacy-${++revision}` } });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (_name, _options, callback) => {
      const next = lockTail.then(callback); lockTail = next.catch(() => {}); return next;
    },
  } });
  global.fetch = jest.fn().mockResolvedValue(response({ success: true, data: { revocationConfirmed: true } }));
  await useAuthStore.getState().logout();
  useSessionStore.getState().clearSession();
  useSessionStore.persist.clearStorage();
  sessionStorage.clear();
  global.fetch.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('logout clears all private frontend state immediately without deleting saved sessions', async () => {
  authenticate('A'); useSessionStore.setState(privateData);
  useToastStore.getState().showToast('A private toast');
  sessionStorage.setItem('pendingSignup', 'A draft');
  localStorage.setItem('unrelated-preference', 'keep');
  const pending = deferred(); fetch.mockReturnValue(pending.promise);
  const logout = useAuthStore.getState().logout();
  // Server revocation is still pending, but private data must already be gone.
  expectClean();
  expect(useAuthStore.getState().user).toBeNull();
  expect(useToastStore.getState()).toMatchObject({ message: '', show: false });
  expect(sessionStorage.getItem('pendingSignup')).toBeNull();
  expect(localStorage.getItem('unrelated-preference')).toBe('keep');
  pending.resolve(response({ success: true, data: { revocationConfirmed: true } }));
  await logout;
  expect(fetch.mock.calls.map(([url, options]) => [url.split('/').pop(), options.method])).toEqual([['logout', 'POST']]);
  expect(JSON.parse(localStorage.getItem('auth-storage')).state).toMatchObject({ user: null, accessToken: null, isAuthenticated: false });
});

test('direct account switching cannot expose User A memory or persisted cache to User B', async () => {
  authenticate('A'); useSessionStore.setState(privateData);
  expect(JSON.parse(localStorage.getItem('session-storage')).state.ownerId).toBe('A');
  fetch.mockResolvedValue(response({ data: { user: account('B'), accessToken: token } }));
  await useAuthStore.getState().login({ username: 'B', password: 'synthetic' });
  expect(useAuthStore.getState().user._id).toBe('B'); expectClean();
  expect(fetch.mock.calls.every(([, options]) => options.method !== 'DELETE')).toBe(true);
});

test.each(['A', undefined, null])('B rejects persisted caches owned by %s, including legacy unscoped state', ownerId => {
  authenticate('B');
  localStorage.setItem('session-storage', JSON.stringify({ state: { ...privateData, ownerId }, version: 0 }));
  useSessionStore.persist.rehydrate();
  expectClean();
});

test('same-account reload accepts an owned snapshot and normal token refresh preserves it', async () => {
  authenticate('A'); useSessionStore.setState(privateData);
  useSessionStore.persist.rehydrate();
  expect(useSessionStore.getState().topic).toBe('A topic');
  fetch.mockResolvedValue(response({ data: { accessToken: 'refreshed-token' } }));
  await useAuthStore.getState().refreshToken();
  expect(useSessionStore.getState()).toMatchObject(privateData);
  expect(useAuthStore.getState().accessToken).toBe('refreshed-token');
});

test('A logs back in and restores saved messages and progress with existing history/resume APIs', async () => {
  authenticate('A'); useSessionStore.setState(privateData);
  await useAuthStore.getState().logout(); authenticate('B'); expectClean();
  await useAuthStore.getState().logout();
  const saved = { ...privateData, loading: false, isQuizSubmitting: false, error: null };
  fetch.mockImplementation(url => Promise.resolve(response({ success: true, data:
    url.endsWith('/login') ? { user: account('A'), accessToken: token } :
      url.endsWith('/resume') ? saved : { sessions: [{ id: 'A-session', chatTitle: 'A title' }] },
  })));
  await useAuthStore.getState().login({ username: 'A', password: 'synthetic' });
  expectClean();
  const history = await sessionApi.getSessions();
  expect(history.data.sessions[0].id).toBe('A-session');
  await useSessionStore.getState().resumeSessionFromServer(history.data.sessions[0].id);
  expect(useSessionStore.getState()).toMatchObject({ sessionId: 'A-session', messages: privateData.messages, topic: 'A topic', points: 40 });
  expect(fetch.mock.calls.every(([, options]) => options.method !== 'DELETE')).toBe(true);
});

test.each(['resumeSessionFromServer', 'createSession', 'loadOlderMessages'])('stale %s responses cannot restore A data after switching accounts', async action => {
  authenticate('A'); useSessionStore.setState({ ...privateData, loading: false, hasMoreMessages: true });
  const pending = deferred();
  const apiName = { resumeSessionFromServer: 'resumeSession', createSession: 'createSession', loadOlderMessages: 'getSessionMessagesWithFallback' }[action];
  jest.spyOn(sessionApi, apiName).mockReturnValue(pending.promise);
  const request = useSessionStore.getState()[action]('A-session').catch(error => error);
  authenticate('B'); expectClean();
  pending.resolve({ success: true, data: { ...privateData, id: 'A-session' } });
  expect((await request).code).toBe('AUTH_CANCELLED'); expectClean();
});

test('a streamed reply cannot append chunks or fall back under a new account', async () => {
  authenticate('A'); useSessionStore.setState({ ...privateData, loading: false });
  const pending = deferred(); let chunk;
  jest.spyOn(chatApi, 'sendMessageStream').mockImplementation(options => { chunk = options.onChunk; return pending.promise; });
  const fallback = jest.spyOn(chatApi, 'sendMessage');
  const request = useSessionStore.getState().sendChatMessage('A prompt').catch(error => error);
  authenticate('B'); expectClean();
  expect(() => chunk('A private answer')).toThrow('Authentication request cancelled');
  pending.resolve({ data: { message: 'A answer', points: 50 } });
  expect((await request).code).toBe('AUTH_CANCELLED');
  expect(fallback).not.toHaveBeenCalled(); expectClean();
});

test('failed stale streaming never triggers a non-streaming retry for another user', async () => {
  authenticate('A'); useSessionStore.setState({ ...privateData, loading: false });
  const pending = deferred();
  jest.spyOn(chatApi, 'sendMessageStream').mockReturnValue(pending.promise.then(() => { throw new Error('stream failed'); }));
  const fallback = jest.spyOn(chatApi, 'sendMessage');
  const request = useSessionStore.getState().sendChatMessage('A prompt').catch(error => error);
  authenticate('B'); pending.resolve();
  expect((await request).code).toBe('AUTH_CANCELLED'); expect(fallback).not.toHaveBeenCalled(); expectClean();
});

test.each(['updateProfile', 'updatePreferences', 'uploadAvatar'])('late %s cannot overwrite B profile or launch an old follow-up request', async action => {
  authenticate('A'); const pending = deferred();
  jest.spyOn(profileApi, action).mockReturnValue(pending.promise);
  const request = useAuthStore.getState()[action]({}).catch(error => error);
  authenticate('B'); pending.resolve({ profile: privateData.profile, preferences: { language: 'A' }, avatarUrl: 'A-avatar' });
  expect((await request).message).toBe('Authentication request cancelled');
  expect(useAuthStore.getState().user).toEqual(account('B')); expect(fetch).not.toHaveBeenCalled();
});

test('delayed history headers and body reads reject stale private data', async () => {
  authenticate('A'); const headers = deferred(); fetch.mockReturnValue(headers.promise);
  const request = sessionApi.getSessions().catch(error => error);
  authenticate('B'); headers.resolve(response({ data: privateData }));
  expect((await request).code).toBe('AUTH_CANCELLED');
  authenticate('A'); const body = deferred(); const started = deferred();
  fetch.mockResolvedValue({ ...response({}), text: () => { started.resolve(); return body.promise; } });
  const bodyRequest = sessionApi.getSessions().catch(error => error); await started.promise;
  authenticate('B'); body.resolve(JSON.stringify({ data: privateData }));
  expect((await bodyRequest).code).toBe('AUTH_CANCELLED'); expectClean();
});

test('delayed stream reader rejects old chunks even after A logs back in', async () => {
  authenticate('A'); const pending = deferred();
  fetch.mockResolvedValue({ ...response({}), body: { getReader: () => ({ read: () => pending.promise }) } });
  const responseForA = await guardedFetch('/private-stream');
  const reading = responseForA.body.getReader().read().catch(error => error);
  await useAuthStore.getState().logout(); authenticate('A');
  pending.resolve({ done: false, value: 'A old chunk' });
  expect((await reading).code).toBe('AUTH_CANCELLED'); expectClean();
});

test.each([['startAssessment', 'assess'], ['startQuizFromChat', 'startQuiz'], ['submitQuiz', 'submitQuiz']])('late %s cannot restore an old assessment or quiz', async (action, method) => {
  authenticate('A'); useSessionStore.setState({ ...privateData, activeModuleId: 'A-module', loading: false, quizDraft: null });
  const pending = deferred();
  jest.spyOn(method === 'assess' ? assessmentApi : quizApi, method).mockReturnValue(pending.promise);
  const request = useSessionStore.getState()[action]('A-module').catch(error => error);
  authenticate('B');
  pending.resolve({ questions: [{ question: 'A question' }], data: { plan: privateData.plan, topic: 'A topic', passed: true, feedbackMarkdown: 'A feedback' } });
  expect((await request).code).toBe('AUTH_CANCELLED'); expectClean();
});
