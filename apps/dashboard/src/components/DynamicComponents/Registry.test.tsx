// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { DynamicComponentRegistry } from './Registry';

// Mock child components
vi.mock('./OperationCard', () => ({ default: () => <div data-testid="op-card" /> }));
vi.mock('./UICommand', () => ({ default: () => <div data-testid="ui-command" /> }));
vi.mock('./StatusFlow', () => ({ default: () => <div data-testid="status-flow" /> }));
vi.mock('./ResourcePreview', () => ({ default: () => <div data-testid="resource-preview" /> }));
vi.mock('./CodeDiff', () => ({ default: () => <div data-testid="code-diff" /> }));
vi.mock('./PlanEditor', () => ({ default: () => <div data-testid="plan-editor" /> }));

describe('DynamicComponentRegistry', () => {
  it('renders OperationCard for operation-card type', () => {
    render(
      <DynamicComponentRegistry
        component={{ componentType: 'operation-card', props: {}, id: '1' }}
      />
    );
    expect(screen.getByTestId('op-card')).toBeInTheDocument();
  });

  it('renders UICommand for ui-command type', () => {
    render(
      <DynamicComponentRegistry component={{ componentType: 'ui-command', props: {}, id: '2' }} />
    );
    expect(screen.getByTestId('ui-command')).toBeInTheDocument();
  });

  it('renders StatusFlow for status-flow type', () => {
    render(
      <DynamicComponentRegistry component={{ componentType: 'status-flow', props: {}, id: '3' }} />
    );
    expect(screen.getByTestId('status-flow')).toBeInTheDocument();
  });

  it('renders ResourcePreview for resource-preview type', () => {
    render(
      <DynamicComponentRegistry
        component={{ componentType: 'resource-preview', props: {}, id: '4' }}
      />
    );
    expect(screen.getByTestId('resource-preview')).toBeInTheDocument();
  });

  it('renders CodeDiff for code-diff type', () => {
    render(
      <DynamicComponentRegistry component={{ componentType: 'code-diff', props: {}, id: '5' }} />
    );
    expect(screen.getByTestId('code-diff')).toBeInTheDocument();
  });

  it('renders PlanEditor for plan-editor type', () => {
    render(
      <DynamicComponentRegistry component={{ componentType: 'plan-editor', props: {}, id: '6' }} />
    );
    expect(screen.getByTestId('plan-editor')).toBeInTheDocument();
  });

  it('renders error message for unsupported component types', () => {
    render(
      <DynamicComponentRegistry component={{ componentType: 'unknown', props: {}, id: '7' }} />
    );
    expect(screen.getByText(/UNSUPPORTED DYNAMIC COMPONENT/i)).toBeInTheDocument();
  });
});
