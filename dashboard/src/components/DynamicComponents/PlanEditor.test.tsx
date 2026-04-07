// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlanEditor from './PlanEditor';
import { DynamicComponent } from '../Chat/types';

describe('PlanEditor Component', () => {
  const mockAction = vi.fn();

  const mockComponent: DynamicComponent = {
    id: 'plan-1',
    componentType: 'plan-editor',
    props: {
      planId: 'test-plan-123',
      content: {
        steps: [
          { id: 'step-1', task: 'Task 1' },
          { id: 'step-2', task: 'Task 2' },
        ],
      },
    },
    actions: [
      { id: 'execute', label: 'Execute Now', type: 'primary' },
      { id: 'cancel', label: 'Cancel', type: 'danger' },
    ],
  };

  it('renders plan editor with initial content', () => {
    render(<PlanEditor component={mockComponent} onAction={mockAction} />);
    
    expect(screen.getByText(/PLAN EDITOR: test-plan-123/i)).toBeInTheDocument();
    
    const textarea = screen.getByDisplayValue(/Task 1/);
    expect(textarea).toBeInTheDocument();
  });

  it('updates content and shows "Unsaved Changes"', () => {
    render(<PlanEditor component={mockComponent} onAction={mockAction} />);
    
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '{"modified": true}' } });
    
    expect(screen.getByText(/Unsaved Changes/i)).toBeInTheDocument();
  });

  it('resets content back to initial when reset button clicked', () => {
    render(<PlanEditor component={mockComponent} onAction={mockAction} />);
    
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"modified": true}' } });
    
    const resetButton = screen.getByText(/Reset/i);
    fireEvent.click(resetButton);
    
    expect(textarea.value).toContain('Task 1');
    expect(screen.queryByText(/Unsaved Changes/i)).not.toBeInTheDocument();
  });

  it('triggers actions with current content in payload', () => {
    render(<PlanEditor component={mockComponent} onAction={mockAction} />);
    
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '{"modified": true}' } });
    
    const executeButton = screen.getByText('Execute Now');
    fireEvent.click(executeButton);
    
    expect(mockAction).toHaveBeenCalledWith('execute', expect.objectContaining({
      planId: 'test-plan-123',
      content: { modified: true },
    }));
  });

  it('auto-adds "Save & Apply" button if not provided in actions', () => {
    const componentNoSave = { ...mockComponent, actions: [] };
    render(<PlanEditor component={componentNoSave} onAction={mockAction} />);
    
    expect(screen.getByText(/Save & Apply/i)).toBeInTheDocument();
  });
});
