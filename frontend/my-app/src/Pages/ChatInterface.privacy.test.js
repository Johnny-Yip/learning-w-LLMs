import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatHistory from './ChatHistory';
import Favorites from './Favorites';
import ChatInterface from './ChatInterface';
import useAuthStore from '../state/authStore';
import useSessionStore from '../state/sessionStore';
import * as authApi from '../lib/authApi';
import * as sessionApi from '../lib/sessionApi';
import * as chatApi from '../lib/chatApi';

jest.mock('../components/ui/toast', () => ({ toastBus: { publish: jest.fn() } }));
jest.mock('react-confetti', () => () => null);
jest.mock('../components/quiz/QuizOverlay', () => () => null);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const authenticate = id => {
  authApi.setAccessToken('synthetic-token');
  useAuthStore.setState({ user: { _id: id, profile: {} }, isAuthenticated: true });
};
const saved = { sessionId: 'aaaaaaaaaaaaaaaaaaaaaaaa', phase: 'learning', messages: [{ role: 'user', content: 'A message' }], topic: 'A topic', plan: [] };
let revision = 0;
let lockTail = Promise.resolve();
beforeEach(async () => {
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => `page-${++revision}` } });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name, _options, callback) => {
    const next = lockTail.then(callback); lockTail = next.catch(() => {}); return next;
  } } });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { revocationConfirmed: true } }) });
  await authApi.logout(); authenticate('A'); useSessionStore.setState(saved);
  global.IntersectionObserver = class { observe() {} disconnect() {} };
  HTMLElement.prototype.scrollTo = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('late chat failures from an unmounted A page cannot set errors in B session state', async () => {
  jest.spyOn(sessionApi, 'resumeSession').mockResolvedValue({ success: true, data: saved });
  const pending = deferred();
  jest.spyOn(chatApi, 'sendMessageStream').mockReturnValue(pending.promise.then(() => { throw new Error('A private server error'); }));
  const view = render(<ChatInterface />);
  await waitFor(() => expect(useSessionStore.getState().loading).toBe(false));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A prompt' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' });
  expect(chatApi.sendMessageStream).toHaveBeenCalled();
  view.unmount(); authenticate('B');
  useSessionStore.setState({ sessionId: 'B-session', topic: 'B topic', messages: [{ content: 'B message' }], error: null });
  await act(async () => pending.resolve());
  expect(useSessionStore.getState()).toMatchObject({ sessionId: 'B-session', topic: 'B topic', messages: [{ content: 'B message' }], error: null, loading: false });
});

test('a cancelled initialization cannot clear B session or create a fallback session', async () => {
  const pending = deferred();
  jest.spyOn(sessionApi, 'resumeSession').mockReturnValue(pending.promise);
  const create = jest.spyOn(sessionApi, 'createSession');
  const view = render(<ChatInterface />);
  view.unmount(); authenticate('B'); useSessionStore.setState({ sessionId: 'B-session', topic: 'B topic', error: null });
  await act(async () => pending.resolve({ success: true, data: saved }));
  expect(create).not.toHaveBeenCalled();
  expect(useSessionStore.getState()).toMatchObject({ sessionId: 'B-session', topic: 'B topic', messages: [], error: null });
});

test.each([[ChatHistory, 'chat-history-item'], [Favorites, 'favorites-item']])('late rename on a private history page cannot overwrite B title', async (Page, itemClass) => {
  const record = { id: saved.sessionId, chatTitle: 'A private history', mode: 'studying', createdAt: new Date().toISOString() };
  jest.spyOn(sessionApi, 'getSessions').mockResolvedValue({ success: true, data: { sessions: [record] } });
  const pending = deferred();
  jest.spyOn(sessionApi, 'updateSessionTitle').mockReturnValue(pending.promise);
  const view = render(<MemoryRouter><Page /></MemoryRouter>);
  const title = await screen.findByText('A private history');
  fireEvent.mouseEnter(title.closest(`.${itemClass}`));
  fireEvent.click(screen.getByTitle('Rename chat'));
  fireEvent.change(screen.getByDisplayValue('A private history'), { target: { value: 'A private rename' } });
  fireEvent.keyPress(screen.getByDisplayValue('A private rename'), { key: 'Enter', charCode: 13 });
  expect(sessionApi.updateSessionTitle).toHaveBeenCalledWith(saved.sessionId, 'A private rename');
  view.unmount(); authenticate('B'); useSessionStore.setState({ sessionId: 'B-session', topic: 'B topic', chatTitle: 'B title' });
  await act(async () => pending.resolve({ success: true }));
  expect(useSessionStore.getState()).toMatchObject({ sessionId: 'B-session', topic: 'B topic', chatTitle: 'B title' });
});

test('late history resume cannot start A revision quiz under B credentials', async () => {
  const record = { id: saved.sessionId, chatTitle: 'A revision', topic: 'A private topic', mode: 'reviewing', createdAt: new Date().toISOString() };
  jest.spyOn(sessionApi, 'getSessions').mockResolvedValue({ success: true, data: { sessions: [record] } });
  const pending = deferred();
  jest.spyOn(useSessionStore.getState(), 'resumeSessionFromServer').mockReturnValue(pending.promise);
  const quiz = jest.spyOn(useSessionStore.getState(), 'startRevisionQuiz');
  const view = render(<MemoryRouter><ChatHistory /></MemoryRouter>);
  fireEvent.click(await screen.findByText('A revision'));
  view.unmount(); authenticate('B');
  await act(async () => pending.resolve(saved));
  expect(quiz).not.toHaveBeenCalled(); expect(useSessionStore.getState().topic).toBe('');
});
