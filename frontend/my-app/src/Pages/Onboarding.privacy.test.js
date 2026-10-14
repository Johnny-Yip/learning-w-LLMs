import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from './Onboarding';
import SignUp from './SignUp';
import useAuthStore from '../state/authStore';
import * as authApi from '../lib/authApi';

jest.mock('../components/ui/toast', () => ({ toastBus: { publish: jest.fn() } }));
const response = body => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
const draft = { name: 'A draft name', username: 'a_draft', password: 'SyntheticPassword1014!' };
let revision = 0;
let lockTail = Promise.resolve();
beforeEach(async () => {
  Object.defineProperty(window, 'crypto', { configurable: true, value: { randomUUID: () => `onboarding-${++revision}` } });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name, _options, callback) => {
    const next = lockTail.then(callback); lockTail = next.catch(() => {}); return next;
  } } });
  global.fetch = jest.fn().mockResolvedValue(response({ data: { revocationConfirmed: true } }));
  await authApi.logout(); sessionStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const switchToB = () => {
  authApi.setAccessToken('B-token');
  useAuthStore.setState({ user: { _id: 'B', username: 'b' }, isAuthenticated: true });
};
const enterTopic = () => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A private topic' } });
  fireEvent.click(screen.getByRole('button', { name: '+' }));
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
};

test('external account changes clear private onboarding fields and the pending draft', async () => {
  sessionStorage.setItem('pendingSignup', JSON.stringify(draft));
  render(<MemoryRouter><Onboarding /></MemoryRouter>); enterTopic();
  act(() => switchToB());
  expect(screen.getByRole('heading', { name: 'Academic Background' })).toBeInTheDocument();
  expect(screen.queryByText('A private topic')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(sessionStorage.getItem('pendingSignup')).toBeNull();
});

test('normal signup retains its own onboarding form until profile save completes', async () => {
  sessionStorage.setItem('pendingSignup', JSON.stringify(draft));
  jest.spyOn(authApi, 'checkUsername').mockResolvedValue({ exists: false });
  const user = { _id: 'A', username: 'a_draft', name: 'A draft name', profile: {} };
  fetch.mockImplementation(url => Promise.resolve(response({ data:
    url.endsWith('/signup') ? { user, accessToken: 'A-token' } :
    url.endsWith('/me') ? { user: { ...user, profile: { recentTopics: ['A private topic'], onboardingCompleted: true } } } :
      { profile: { recentTopics: ['A private topic'] } },
  })));
  render(<MemoryRouter><Onboarding /></MemoryRouter>); enterTopic();
  fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
  await waitFor(() => expect(useAuthStore.getState().user?.profile?.onboardingCompleted).toBe(true));
  const profileRequest = fetch.mock.calls.find(([url, options]) => url.endsWith('/profile') && options.method === 'PUT');
  expect(profileRequest).toBeDefined();
  expect(JSON.parse(profileRequest[1].body).recentTopics).toEqual(['A private topic']);
  expect(profileRequest[1].headers.Authorization).toBe('Bearer A-token');
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, user: { _id: 'A' } });
  expect(sessionStorage.getItem('pendingSignup')).toBeNull();
});

test('a late signup username check cannot recreate A credentials after B logs in', async () => {
  let release;
  jest.spyOn(authApi, 'checkUsername').mockReturnValue(new Promise(resolve => { release = resolve; }));
  const view = render(<MemoryRouter><SignUp /></MemoryRouter>);
  const fields = screen.getAllByRole('textbox');
  fireEvent.change(fields[0], { target: { value: 'A draft name' } });
  fireEvent.change(fields[1], { target: { value: 'a_draft' } });
  fireEvent.change(view.container.querySelector('input[type="password"]'), { target: { value: draft.password } });
  fireEvent.click(screen.getByRole('button', { name: /Continue to Onboarding/ }));
  expect(authApi.checkUsername).toHaveBeenCalled();
  act(() => switchToB());
  await act(async () => release({ exists: false }));
  expect(sessionStorage.getItem('pendingSignup')).toBeNull();
  expect(useAuthStore.getState().user._id).toBe('B');
});

test('late onboarding checks cannot submit A signup or profile after switching to B', async () => {
  let release;
  jest.spyOn(authApi, 'checkUsername').mockReturnValue(new Promise(resolve => { release = resolve; }));
  sessionStorage.setItem('pendingSignup', JSON.stringify(draft));
  fetch.mockClear();
  render(<MemoryRouter><Onboarding /></MemoryRouter>); enterTopic();
  fireEvent.click(screen.getByRole('button', { name: /Finish/ }));
  act(() => switchToB());
  await act(async () => release({ exists: false }));
  expect(fetch).not.toHaveBeenCalled();
  expect(useAuthStore.getState().user._id).toBe('B');
  expect(screen.getByRole('textbox')).toHaveValue('');
});
