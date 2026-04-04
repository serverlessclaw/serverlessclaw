// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CyberConfirm from './CyberConfirm';

describe('CyberConfirm Component', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <CyberConfirm
        isOpen={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        title="Test"
        message="Message"
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when isOpen is true', () => {
    render(
      <CyberConfirm
        isOpen={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        title="Delete?"
        message="Are you sure?"
      />
    );
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('renders default button text', () => {
    render(
      <CyberConfirm isOpen={true} onConfirm={vi.fn()} onCancel={vi.fn()} title="T" message="M" />
    );
    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByText('Abort Operation')).toBeInTheDocument();
  });

  it('renders custom button text', () => {
    render(
      <CyberConfirm
        isOpen={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        title="T"
        message="M"
        confirmText="Yes, delete"
        cancelText="No, keep"
      />
    );
    expect(screen.getByText('Yes, delete')).toBeInTheDocument();
    expect(screen.getByText('No, keep')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <CyberConfirm isOpen={true} onConfirm={onConfirm} onCancel={vi.fn()} title="T" message="M" />
    );

    await user.click(screen.getByText('Confirm Action'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <CyberConfirm isOpen={true} onConfirm={vi.fn()} onCancel={onCancel} title="T" message="M" />
    );

    await user.click(screen.getByText('Abort Operation'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <CyberConfirm isOpen={true} onConfirm={vi.fn()} onCancel={onCancel} title="T" message="M" />
    );

    const backdrop = document.querySelector('.bg-black\\/80');
    if (backdrop) await user.click(backdrop as HTMLElement);
    expect(onCancel).toHaveBeenCalled();
  });
});
