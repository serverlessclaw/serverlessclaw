// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CyberTooltip from './CyberTooltip';

describe('CyberTooltip Component', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders children correctly', () => {
    render(
      <CyberTooltip content="Tooltip Content">
        <button>Hover Me</button>
      </CyberTooltip>
    );
    
    expect(screen.getByText('Hover Me')).toBeInTheDocument();
  });

  it('shows tooltip content on mouse enter', async () => {
    render(
      <CyberTooltip content="Tooltip Content">
        <button>Hover Me</button>
      </CyberTooltip>
    );

    const trigger = screen.getByText('Hover Me');
    fireEvent.mouseEnter(trigger);

    // Since it uses Portals, we look for it in the document body
    expect(screen.getByText('Tooltip Content')).toBeInTheDocument();
  });

  it('hides tooltip content on mouse leave', async () => {
    render(
      <CyberTooltip content="Tooltip Content">
        <button>Hover Me</button>
      </CyberTooltip>
    );

    const trigger = screen.getByText('Hover Me');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByText('Tooltip Content')).toBeInTheDocument();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByText('Tooltip Content')).not.toBeInTheDocument();
  });

  it('renders info icon when no children are provided and showIcon is true', () => {
    const { container } = render(<CyberTooltip content="Tooltip Content" showIcon={true} />);
    
    // Lucide-react Info icon should be present
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('does not render info icon when showIcon is false', () => {
    const { container } = render(<CyberTooltip content="Tooltip Content" showIcon={false} />);
    
    const svg = container.querySelector('svg');
    expect(svg).not.toBeInTheDocument();
  });

  it('applies custom width class', async () => {
    render(
      <CyberTooltip content="Tooltip Content" width="w-96">
        <button>Hover Me</button>
      </CyberTooltip>
    );

    fireEvent.mouseEnter(screen.getByText('Hover Me'));
    
    await waitFor(() => {
      const tooltip = screen.getByTestId('cyber-tooltip-content');
      expect(tooltip).toHaveClass('w-96');
    });
  });

  describe('Smart Positioning', () => {
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    beforeEach(() => {
      window.innerHeight = 1000;
      window.innerWidth = 1000;
    });

    afterEach(() => {
      window.innerHeight = originalInnerHeight;
      window.innerWidth = originalInnerWidth;
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    });

    it('flips from top to bottom when near the top edge', async () => {
      HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
        top: 20,
        bottom: 50,
        left: 500,
        right: 550,
        width: 50,
        height: 30,
        x: 500,
        y: 20,
        toJSON: () => {},
      })) as any;

      render(
        <CyberTooltip content="Tooltip Content" position="top">
          <div>Hover Me</div>
        </CyberTooltip>
      );

      fireEvent.mouseEnter(screen.getByText('Hover Me'));
      
      await waitFor(() => {
        const tooltip = screen.getByTestId('cyber-tooltip-content');
        expect(tooltip).toHaveClass('translate-y-0');
        expect(tooltip).not.toHaveClass('-translate-y-full');
      });
    });

    it('flips from bottom to top when near the bottom edge', async () => {
      HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
        top: 950,
        bottom: 980,
        left: 500,
        right: 550,
        width: 50,
        height: 30,
        x: 500,
        y: 950,
        toJSON: () => {},
      })) as any;

      render(
        <CyberTooltip content="Tooltip Content" position="bottom">
          <div>Hover Me</div>
        </CyberTooltip>
      );

      fireEvent.mouseEnter(screen.getByText('Hover Me'));
      
      await waitFor(() => {
        const tooltip = screen.getByTestId('cyber-tooltip-content');
        expect(tooltip).toHaveClass('-translate-y-full');
      });
    });

    it('flips from left to right when near the left edge', async () => {
      HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
        top: 500,
        bottom: 530,
        left: 20,
        right: 70,
        width: 50,
        height: 30,
        x: 20,
        y: 500,
        toJSON: () => {},
      })) as any;

      render(
        <CyberTooltip content="Tooltip Content" position="left">
          <div>Hover Me</div>
        </CyberTooltip>
      );

      fireEvent.mouseEnter(screen.getByText('Hover Me'));
      
      await waitFor(() => {
        const tooltip = screen.getByTestId('cyber-tooltip-content');
        expect(tooltip).toHaveClass('translate-x-0');
      });
    });
  });
});
