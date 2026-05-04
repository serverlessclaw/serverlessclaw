// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import OperationCard from './OperationCard';
import { DynamicComponent } from '@claw/hooks';

describe('OperationCard', () => {
  const defaultProps: {
    component: DynamicComponent;
    onAction: (id: string, payload?: unknown) => void;
  } = {
    component: {
      id: '1',
      componentType: 'operation-card',
      props: {
        title: 'Security Scan',
        status: 'active',
        description: 'Vulnerability assessment in progress.',
        details: {
          scanned_files: 150,
          threats_found: 0,
        },
      },
      actions: [
        { id: 'stop', label: 'Stop Scan', type: 'danger' },
        { id: 'view-report', label: 'View Report', type: 'primary' },
      ],
    },
    onAction: vi.fn() as (id: string, payload?: unknown) => void,
  };

  it('renders correctly with all props', () => {
    render(<OperationCard component={defaultProps.component} onAction={defaultProps.onAction} />);
    expect(screen.getByText('Security Scan')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('Vulnerability assessment in progress.')).toBeInTheDocument();
    expect(screen.getByText(/scanned files/i)).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
  });

  it('calls onAction when buttons are clicked', () => {
    render(<OperationCard component={defaultProps.component} onAction={defaultProps.onAction} />);

    fireEvent.click(screen.getByText('Stop Scan'));
    expect(defaultProps.onAction).toHaveBeenCalledWith('stop', undefined);

    fireEvent.click(screen.getByText('View Report'));
    expect(defaultProps.onAction).toHaveBeenCalledWith('view-report', undefined);
  });

  it('renders without status or details', () => {
    const minimalProps = {
      component: {
        id: '2',
        componentType: 'operation-card',
        props: {
          title: 'Simple Task',
        },
      },
    };
    render(<OperationCard component={minimalProps.component as DynamicComponent} />);
    expect(screen.getByText('Simple Task')).toBeInTheDocument();
    expect(screen.queryByText('active')).not.toBeInTheDocument();
  });
});
