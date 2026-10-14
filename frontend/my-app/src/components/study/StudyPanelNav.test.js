import React from 'react';
import { render, screen, within } from '@testing-library/react';
import StudyPanelNav from './StudyPanelNav';
import useSessionStore from '../../state/sessionStore';

jest.mock('../../state/sessionStore', () => ({ __esModule: true, default: jest.fn() }));
describe('StudyPanelNav', () => {
  beforeEach(() => {
    useSessionStore.mockReturnValue({
      topic: 'Python Basics', points: 25, progressPct: 25, activeModuleId: 'module-1', meta: { currentMilestoneIndex: 2 },
      plan: [
        { id: 'module-1', title: 'Setup', points: 40, status: 'in_progress', milestones: [
          { text: 'Install python', completed: true }, { text: 'Basic syntax', completed: true },
          { text: 'Control structure', completed: false } ] },
        { id: 'module-2', title: 'Data Structures', points: 60, status: 'locked', milestones: [
          { text: 'Lists', completed: false }, { text: 'Dictionaries', completed: false } ] },
      ],
    });
  });
  test('shows session points while gem balance is displayed in profile navigation', () => {
    render(<StudyPanelNav />);
    expect(screen.getByText('25/100 points')).toBeInTheDocument();
    expect(screen.queryByAltText('diamond')).not.toBeInTheDocument();
  });
  test('maps module status icons correctly', () => {
    render(<StudyPanelNav />);
    const active = screen.getByText('Setup').closest('li');
    const locked = screen.getByText('Data Structures').closest('li');
    expect(within(active).queryByRole('img', { name: 'Locked module' })).not.toBeInTheDocument();
    expect(within(locked).getByRole('img', { name: 'Locked module' })).toBeInTheDocument();
    expect(within(active).getByText('Install python').closest('li')).toHaveTextContent('✓Install python');
    expect(within(active).getByText('Control structure').closest('li')).toHaveTextContent('●Control structure');
  });
  test('has sticky header behavior (class presence)', () => {
    render(<StudyPanelNav />);
    expect(screen.getByText('Topic: Python Basics').parentElement).toHaveClass('sticky', 'top-0');
    expect(screen.getByText('Overall Progress').parentElement.parentElement).toHaveClass('sticky', 'bottom-0');
  });
  test('shows topic and points correctly', () => {
    render(<StudyPanelNav />);
    expect(screen.getByText('Topic: Python Basics')).toBeInTheDocument();
    expect(screen.getByText('25/100 points')).toBeInTheDocument();
  });
  test('displays progress percentage', () => {
    render(<StudyPanelNav />);
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(document.querySelector('[style="width: 25%;"]')).toBeInTheDocument();
  });
  test('preserves zero points instead of displaying the fallback', () => {
    useSessionStore.mockReturnValue({ topic: 'Python Basics', points: 0, progressPct: 0, plan: [] });
    render(<StudyPanelNav />);
    expect(screen.getByText('0/100 points')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
