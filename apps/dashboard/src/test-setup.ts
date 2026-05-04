import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  key: vi.fn(),
  length: 0,
};
global.localStorage = localStorageMock as unknown as Storage;

// Global mock for ExtensionProvider to support tests of components that use it
vi.mock('@/components/Providers/ExtensionProvider', async (importOriginal) => {
  const actual = (await importOriginal()) as unknown;
  return {
    ...(actual as Record<string, unknown>),
    useExtensions: vi.fn(() => ({
      sidebarExtensions: [],
      dynamicComponents: new Map(),
      layoutExtensions: new Map(),
      registerSidebarExtension: vi.fn(),
      registerDynamicComponent: vi.fn(),
      registerLayoutExtension: vi.fn(),
    })),
  };
});
