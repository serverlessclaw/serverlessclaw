// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CodeDiff from './CodeDiff';
import { DynamicComponent } from '../Chat/types';

describe('CodeDiff Component', () => {
  const mockAction = vi.fn();

  const mockComponent: DynamicComponent = {
    id: 'diff-1',
    componentType: 'code-diff',
    props: {
      fileName: 'test.ts',
      language: 'typescript',
      description: 'Test changes',
      lines: [
        { type: 'context', content: 'import { foo } from "bar";', lineNumber: 1 },
        { type: 'removed', content: 'const x = 1;', lineNumber: 2 },
        { type: 'added', content: 'const x = 2;', lineNumber: 3 },
      ],
    },
    actions: [
      { id: 'approve', label: 'Approve', type: 'primary' },
      { id: 'reject', label: 'Reject', type: 'danger' },
    ],
  };

  it('renders file information and description', () => {
    render(<CodeDiff component={mockComponent} onAction={mockAction} />);
    
    expect(screen.getByText(/test.ts/i)).toBeInTheDocument();
    expect(screen.getByText(/typescript/i)).toBeInTheDocument();
    expect(screen.getByText('Test changes')).toBeInTheDocument();
  });

  it('renders diff lines correctly', () => {
    render(<CodeDiff component={mockComponent} onAction={mockAction} />);
    
    expect(screen.getByText('import { foo } from "bar";')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(screen.getByText('const x = 2;')).toBeInTheDocument();
    
    // Check for line numbers
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('triggers actions when buttons are clicked', () => {
    render(<CodeDiff component={mockComponent} onAction={mockAction} />);
    
    const approveButton = screen.getByText('Approve');
    fireEvent.click(approveButton);
    
    expect(mockAction).toHaveBeenCalledWith('approve', undefined);

    const rejectButton = screen.getByText('Reject');
    fireEvent.click(rejectButton);
    
    expect(mockAction).toHaveBeenCalledWith('reject', undefined);
  });

  it('renders empty state when no lines are provided', () => {
    const emptyComponent = { ...mockComponent, props: { ...mockComponent.props, lines: [] } };
    render(<CodeDiff component={emptyComponent} />);
    
    expect(screen.getByText('No changes to display in this patch')).toBeInTheDocument();
  });
});
