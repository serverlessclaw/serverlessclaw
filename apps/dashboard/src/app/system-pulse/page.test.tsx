// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import SystemPulsePage from './page';
import { redirect } from 'next/navigation';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

describe('SystemPulsePage', () => {
  it('redirects to /observability', () => {
    render(<SystemPulsePage />);
    expect(redirect).toHaveBeenCalledWith('/observability');
  });
});
