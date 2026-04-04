// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Input from './Input';

describe('Input Component', () => {
  it('renders input element', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
  });

  it('renders label when provided', () => {
    render(<Input label="Email" placeholder="Enter email" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('does not render label when not provided', () => {
    const { container } = render(<Input placeholder="No label" />);
    expect(container.querySelector('label')).not.toBeInTheDocument();
  });

  it('handles value changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input onChange={onChange} placeholder="Type here" />);

    const input = screen.getByPlaceholderText('Type here');
    await user.type(input, 'hello');

    expect(onChange).toHaveBeenCalled();
    expect(input).toHaveValue('hello');
  });

  it('displays error message when error prop is provided', () => {
    render(<Input error="This field is required" placeholder="Required field" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('applies error styling when error is present', () => {
    render(<Input error="Error" placeholder="Error field" />);
    const input = screen.getByPlaceholderText('Error field');
    expect(input.className).toContain('border-red-500/50');
  });

  it('does not show error message when error is not provided', () => {
    const { container } = render(<Input placeholder="No error" />);
    expect(container.querySelector('.text-red-400')).not.toBeInTheDocument();
  });

  it('forwards ref correctly', () => {
    const ref = vi.fn();
    render(<Input ref={ref} placeholder="Ref input" />);
    expect(ref).toHaveBeenCalled();
  });

  it('applies custom className', () => {
    render(<Input className="custom-class" placeholder="Custom" />);
    const input = screen.getByPlaceholderText('Custom');
    expect(input.className).toContain('custom-class');
  });

  it('is disabled when disabled prop is true', () => {
    render(<Input disabled placeholder="Disabled" />);
    expect(screen.getByPlaceholderText('Disabled')).toBeDisabled();
  });

  it('passes through HTML input attributes', () => {
    render(<Input type="email" maxLength={50} placeholder="Email" />);
    const input = screen.getByPlaceholderText('Email');
    expect(input).toHaveAttribute('type', 'email');
    expect(input).toHaveAttribute('maxlength', '50');
  });
});
