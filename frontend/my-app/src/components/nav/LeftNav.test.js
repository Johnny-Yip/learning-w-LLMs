import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import LeftNav from './LeftNav';
import useSessionStore from '../../state/sessionStore';
import useAuthStore from '../../state/authStore';

jest.mock('../../state/sessionStore', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../state/authStore', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../study/StudyPanelNav', () => () => <div data-testid="study-panel-nav">Study Panel Nav</div>);
jest.mock('./RecentChats', () => () => <div data-testid="recent-chats">Recent Chats</div>);
function Location() { return <span data-testid="location">{useLocation().pathname}</span>; }
const renderNav = (route = '/chat') => render(
  <MemoryRouter initialEntries={[route]}><LeftNav /><Location /></MemoryRouter>
);

describe('LeftNav', () => {
  let auth;
  beforeEach(() => {
    useSessionStore.mockReset();
    useAuthStore.mockReset();
    useSessionStore.mockReturnValue({ phase: 'pre', plan: [], points: 25, gems: 1, reset: jest.fn() });
    auth = { user: { name: 'Demo User', role: 'student', stats: { gemsTotal: 7 } },
      logout: jest.fn().mockResolvedValue(), fetchUser: jest.fn().mockResolvedValue() };
    useAuthStore.mockImplementation(selector => selector ? selector(auth) : auth);
  });
  test('conditionally renders StudyPanelNav by phase - shows when not in pre/assessing', () => {
    useSessionStore.mockReturnValue({ phase: 'learning', plan: [{ id: '1' }] });
    renderNav();
    expect(screen.getByTestId('study-panel-nav')).toBeInTheDocument();
    expect(screen.queryByTestId('recent-chats')).not.toBeInTheDocument();
  });
  test('conditionally renders StudyPanelNav by phase - hides when in pre phase', () => {
    renderNav();
    expect(screen.queryByTestId('study-panel-nav')).not.toBeInTheDocument();
    expect(screen.getByTestId('recent-chats')).toBeInTheDocument();
  });
  test('conditionally renders StudyPanelNav by phase - hides when in assessing phase', () => {
    useSessionStore.mockReturnValue({ phase: 'assessing', plan: [{ id: '1' }] });
    renderNav();
    expect(screen.queryByTestId('study-panel-nav')).not.toBeInTheDocument();
  });
  test('renders navigation links', () => {
    renderNav();
    for (const [name, href] of [['Chat History', '/history'], ['Performance', '/performance'],
      ['Favourites', '/favorites'], ['My courses', '/courses']]) {
      expect(screen.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', href);
    }
    expect(screen.queryByRole('link', { name: 'Teach' })).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Quiz', { exact: true })).not.toBeInTheDocument();
  });
  test('renders profile chip with correct props', () => {
    renderNav();
    expect(screen.getByText('Demo User')).toBeInTheDocument();
    expect(screen.getByAltText('diamond').parentElement).toHaveTextContent('7');
    expect(auth.fetchUser).toHaveBeenCalledTimes(1);
  });
  test('does not show a study panel without a plan or outside Chat', () => {
    useSessionStore.mockReturnValue({ phase: 'learning', plan: [] });
    const view = renderNav();
    expect(screen.queryByTestId('study-panel-nav')).not.toBeInTheDocument();
    view.unmount();
    useSessionStore.mockReturnValue({ phase: 'learning', plan: [{ id: '1' }] });
    renderNav('/history');
    expect(screen.queryByTestId('study-panel-nav')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recent-chats')).not.toBeInTheDocument();
  });
  test('uses the authenticated global gem total rather than deriving it from session points', () => {
    auth.user.stats.gemsTotal = 0;
    renderNav();
    expect(screen.getByAltText('diamond').parentElement).toHaveTextContent(/^0$/);
  });
  test('logout completes before navigating to sign-in', async () => {
    let finishLogout;
    auth.logout.mockReturnValue(new Promise(resolve => { finishLogout = resolve; }));
    renderNav();
    fireEvent.click(screen.getByText('Demo User'));
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location')).toHaveTextContent('/chat');
    finishLogout();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/signin'));
  });
});
