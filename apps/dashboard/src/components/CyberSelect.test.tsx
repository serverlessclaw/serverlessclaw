// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CyberSelect from './CyberSelect';

const mockOptions = [
  { value: 'opt1', label: 'Option 1' },
  { value: 'opt2', label: 'Option 2' },
  { value: 'opt3', label: 'Option 3' },
];

describe('CyberSelect Component', () => {
  it('renders with placeholder when no value selected', () => {
    render(
      <CyberSelect value="" onChange={vi.fn()} options={mockOptions} placeholder="Choose..." />
    );
    expect(screen.getByText('Choose...')).toBeInTheDocument();
  });

  it('renders selected option label', () => {
    render(<CyberSelect value="opt2" onChange={vi.fn()} options={mockOptions} />);
    expect(screen.getByText('Option 2')).toBeInTheDocument();
  });

  it('opens dropdown on click', async () => {
    const user = userEvent.setup();
    render(<CyberSelect value="" onChange={vi.fn()} options={mockOptions} />);

    await user.click(screen.getByText('Select option...'));
    expect(screen.getByText('Option 1')).toBeInTheDocument();
    expect(screen.getByText('Option 2')).toBeInTheDocument();
    expect(screen.getByText('Option 3')).toBeInTheDocument();
  });

  it('calls onChange when option is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CyberSelect value="" onChange={onChange} options={mockOptions} />);

    await user.click(screen.getByText('Select option...'));
    await user.click(screen.getByText('Option 2'));

    expect(onChange).toHaveBeenCalledWith('opt2');
  });

  it('closes dropdown after selection', async () => {
    const user = userEvent.setup();
    render(<CyberSelect value="" onChange={vi.fn()} options={mockOptions} />);

    await user.click(screen.getByText('Select option...'));
    await user.click(screen.getByText('Option 1'));

    expect(screen.queryByText('Option 2')).not.toBeInTheDocument();
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(<CyberSelect value="" onChange={vi.fn()} options={mockOptions} disabled />);

    await user.click(screen.getByText('Select option...'));
    expect(screen.queryByText('Option 1')).not.toBeInTheDocument();
  });

  it('shows "No options available" when options is empty', async () => {
    const user = userEvent.setup();
    render(<CyberSelect value="" onChange={vi.fn()} options={[]} />);

    await user.click(screen.getByText('Select option...'));
    expect(screen.getByText('No options available')).toBeInTheDocument();
  });

  it('renders hidden input when name is provided', () => {
    render(<CyberSelect value="opt1" onChange={vi.fn()} options={mockOptions} name="mySelect" />);
    const input = document.querySelector('input[type="hidden"]');
    expect(input).toHaveAttribute('name', 'mySelect');
    expect(input).toHaveAttribute('value', 'opt1');
  });

  it('does not render hidden input when name is not provided', () => {
    render(<CyberSelect value="opt1" onChange={vi.fn()} options={mockOptions} />);
    const input = document.querySelector('input[type="hidden"]');
    expect(input).not.toBeInTheDocument();
  });
});
