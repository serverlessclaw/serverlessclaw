// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PageHeader from './PageHeader';

// Mock useTranslations hook
vi.mock('@/components/Providers/TranslationsProvider', () => ({
  useTranslations: () => ({
    t: (key: string) => key, // Return the key as the translation
  }),
}));

describe('PageHeader Component', () => {
  it('renders title and subtitle using translation keys', () => {
    render(<PageHeader titleKey="TEST_TITLE" subtitleKey="TEST_SUBTITLE" />);

    expect(screen.getByText('TEST_TITLE')).toBeInTheDocument();
    expect(screen.getByText('TEST_SUBTITLE')).toBeInTheDocument();
  });

  it('renders children correctly', () => {
    render(
      <PageHeader titleKey="TITLE" subtitleKey="SUBTITLE">
        <button data-testid="test-button">Click Me</button>
      </PageHeader>
    );

    expect(screen.getByTestId('test-button')).toBeInTheDocument();
    expect(screen.getByText('Click Me')).toBeInTheDocument();
  });

  it('renders stats correctly', () => {
    render(
      <PageHeader
        titleKey="TITLE"
        subtitleKey="SUBTITLE"
        stats={<span data-testid="test-stats">Stats: 100</span>}
      />
    );

    expect(screen.getByTestId('test-stats')).toBeInTheDocument();
    expect(screen.getByText('Stats: 100')).toBeInTheDocument();
  });

  it('applies correct responsive layout classes', () => {
    const { container } = render(<PageHeader titleKey="TITLE" subtitleKey="SUBTITLE" />);
    const header = container.querySelector('header');

    expect(header?.className).toContain('flex flex-col lg:flex-row');
    expect(header?.className).toContain('lg:justify-between');
  });
});
