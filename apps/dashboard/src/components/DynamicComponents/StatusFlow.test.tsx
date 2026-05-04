// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import StatusFlow from './StatusFlow';
import { DynamicComponent } from '@claw/hooks';

describe('StatusFlow', () => {
  const defaultProps: {
    component: DynamicComponent;
    onAction: (id: string, payload?: unknown) => void;
  } = {
    component: {
      id: '1',
      componentType: 'status-flow',
      props: {
        title: 'Deployment Pipeline',
        steps: [
          { id: '1', label: 'Build', status: 'completed', description: 'Docker image built.' },
          { id: '2', label: 'Test', status: 'active', description: 'Running unit tests...' },
          { id: '3', label: 'Deploy', status: 'pending' },
        ],
      },
      actions: [{ id: 'cancel', label: 'Cancel Deployment', type: 'danger' }],
    },
    onAction: vi.fn(),
  };

  it('renders correctly with all step statuses', () => {
    render(<StatusFlow component={defaultProps.component} onAction={defaultProps.onAction} />);
    expect(screen.getByText('Deployment Pipeline')).toBeInTheDocument();

    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('Docker image built.')).toBeInTheDocument();

    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('Running unit tests...')).toBeInTheDocument();

    expect(screen.getByText('Deploy')).toBeInTheDocument();
  });

  it('renders failed status', () => {
    const failedProps = {
      component: {
        ...defaultProps.component,
        props: {
          steps: [{ id: '1', label: 'Build', status: 'failed', description: 'Build error.' }],
        },
      },
    };
    render(<StatusFlow component={failedProps.component as DynamicComponent} />);
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('Build error.')).toBeInTheDocument();
  });

  it('calls onAction when footer buttons are clicked', () => {
    render(<StatusFlow component={defaultProps.component} onAction={defaultProps.onAction} />);
    fireEvent.click(screen.getByText('Cancel Deployment'));
    expect(defaultProps.onAction).toHaveBeenCalledWith('cancel', undefined);
  });
});
