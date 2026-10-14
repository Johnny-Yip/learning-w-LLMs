import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TopBar from './TopBar';
import useSessionStore from '../../state/sessionStore';

jest.mock('../../state/sessionStore', () => ({ __esModule: true, default: jest.fn() }));
const renderTopBar = onStartNewChat => render(
  <MemoryRouter initialEntries={['/chat']}><TopBar onStartNewChat={onStartNewChat} /></MemoryRouter>
);

describe('TopBar', () => {
  const mockOnStartNewChat = jest.fn();
  beforeEach(() => {
    useSessionStore.mockReset();
    mockOnStartNewChat.mockReset();
    jest.spyOn(window, 'confirm').mockReturnValue(false);
  });
  afterEach(() => jest.restoreAllMocks());

  test('shows title presence by phase - displays title when not in pre/assessing', () => {
    useSessionStore.mockReturnValue({ phase: 'learning', topic: 'Python Basics', sessionId: 'test-session' });
    renderTopBar(mockOnStartNewChat);
    expect(screen.getByText('Studying', { selector: 'strong' }).parentElement)
      .toHaveTextContent('You are Studying: Python Basics');
  });
  test('shows title presence by phase - hides title when in pre phase', () => {
    useSessionStore.mockReturnValue({ phase: 'pre', topic: '', sessionId: null });
    renderTopBar(mockOnStartNewChat);
    expect(screen.queryByText('Studying', { selector: 'strong' })).not.toBeInTheDocument();
  });
  test('shows title presence by phase - hides title when in assessing phase', () => {
    useSessionStore.mockReturnValue({ phase: 'assessing', topic: '', sessionId: 'test-session' });
    renderTopBar(mockOnStartNewChat);
    expect(screen.queryByText('Studying', { selector: 'strong' })).not.toBeInTheDocument();
  });
  test('Start Chat confirm firing - calls onStartNewChat when no active session', async () => {
    useSessionStore.mockReturnValue({ phase: 'pre', topic: '', sessionId: null });
    renderTopBar(mockOnStartNewChat);
    fireEvent.click(screen.getByRole('button', { name: /Start Chat/ }));
    await waitFor(() => expect(mockOnStartNewChat).toHaveBeenCalledTimes(1));
    expect(window.confirm).not.toHaveBeenCalled();
  });
  test('Start Chat confirm firing - shows confirmation dialog when active session exists', () => {
    useSessionStore.mockReturnValue({ phase: 'learning', topic: 'Python Basics', sessionId: 'test-session' });
    renderTopBar(mockOnStartNewChat);
    fireEvent.click(screen.getByRole('button', { name: /Start Chat/ }));
    expect(window.confirm).toHaveBeenCalledWith('Start new chat? Current session will be saved.');
    expect(mockOnStartNewChat).not.toHaveBeenCalled();
  });
  test('Start Chat confirm firing - calls onStartNewChat when confirmed', async () => {
    window.confirm.mockReturnValue(true);
    useSessionStore.mockReturnValue({ phase: 'learning', topic: 'Python Basics', sessionId: 'test-session' });
    renderTopBar(mockOnStartNewChat);
    fireEvent.click(screen.getByRole('button', { name: /Start Chat/ }));
    await waitFor(() => expect(mockOnStartNewChat).toHaveBeenCalledTimes(1));
    expect(window.confirm).toHaveBeenCalledTimes(1);
  });
  test('Start Chat confirm firing - does not call onStartNewChat when cancelled', async () => {
    useSessionStore.mockReturnValue({ phase: 'learning', topic: 'Python Basics', sessionId: 'test-session' });
    renderTopBar(mockOnStartNewChat);
    fireEvent.click(screen.getByRole('button', { name: /Start Chat/ }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledTimes(1));
    expect(mockOnStartNewChat).not.toHaveBeenCalled();
  });
});
