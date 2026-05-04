// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Sidebar from './Sidebar';

// Define the mock before hoisting it
const {
  mockUseRouter,
  mockUseUICommand,
  mockUseRealtimeContext,
  mockUseTheme,
  mockUseTranslations,
  mockUseTenant,
} = vi.hoisted(() => ({
  mockUseRouter: vi.fn().mockReturnValue({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  mockUseUICommand: vi.fn().mockReturnValue({
    isSidebarCollapsed: false,
    setSidebarCollapsed: vi.fn(),
  }),
  mockUseRealtimeContext: vi.fn().mockReturnValue({
    isConnected: true,
  }),
  mockUseTheme: vi.fn().mockReturnValue({
    theme: 'dark',
    setTheme: vi.fn(),
  }),
  mockUseTranslations: vi.fn().mockReturnValue({
    t: (key: string) => key,
  }),
  mockUseTenant: vi.fn().mockReturnValue({
    activeWorkspaceId: null,
    workspaces: [],
    tenantInfo: null,
    isLoading: false,
    setActiveWorkspace: vi.fn(),
  }),
}));

// Mock dependencies using the hoisted mocks
vi.mock('@/components/Providers/TranslationsProvider', () => ({
  useTranslations: mockUseTranslations,
}));

vi.mock('@/components/Providers/RealtimeProvider', () => ({
  useRealtimeContext: mockUseRealtimeContext,
}));

vi.mock('@/components/Providers/UICommandProvider', () => ({
  useUICommand: mockUseUICommand,
}));

vi.mock('@/components/Providers/TenantProvider', () => ({
  useTenant: mockUseTenant,
}));

vi.mock('next-themes', () => ({
  useTheme: mockUseTheme,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: mockUseRouter,
  useSearchParams: () => ({
    get: vi.fn(),
  }),
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Activity: () => <div data-testid="icon-activity" />,
  MessageSquare: () => <div data-testid="icon-messages" />,
  Settings: () => <div data-testid="icon-settings" />,
  Lock: () => <div data-testid="icon-lock" />,
  Share2: () => <div data-testid="icon-share" />,
  Zap: () => <div data-testid="icon-zap" />,
  Menu: () => <div data-testid="icon-menu" />,
  X: () => <div data-testid="icon-x" />,
  Check: () => <div data-testid="icon-check" />,
  Plus: () => <div data-testid="icon-plus" />,
  ChevronRight: () => <div data-testid="icon-chevron-right" />,
  ChevronDown: () => <div data-testid="icon-chevron-down" />,
  PanelLeftClose: () => <div data-testid="icon-panel-close" />,
  PanelLeftOpen: () => <div data-testid="icon-panel-open" />,
  Users: () => <div data-testid="icon-users" />,
  Brain: () => <div data-testid="icon-brain" />,
  Wrench: () => <div data-testid="icon-wrench" />,
  Server: () => <div data-testid="icon-server" />,
  Calendar: () => <div data-testid="icon-calendar" />,
  BrainCircuit: () => <div data-testid="icon-brain-circuit" />,
  Building2: () => <div data-testid="icon-building" />,
  Globe: () => <div data-testid="icon-globe" />,
  Vote: () => <div data-testid="icon-vote" />,
  Sun: () => <div data-testid="icon-sun" />,
  Moon: () => <div data-testid="icon-moon" />,
  Monitor: () => <div data-testid="icon-monitor" />,
  LogOut: () => <div data-testid="icon-logout" />,
  Radio: () => <div data-testid="icon-radio" />,
  Keyboard: () => <div data-testid="icon-keyboard" />,
  Fingerprint: () => <div data-testid="icon-fingerprint" />,
}));

// Mock CyberTooltip
vi.mock('@/components/CyberTooltip', () => ({
  default: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
    <div
      data-testid="cyber-tooltip"
      data-content={typeof content === 'string' ? content : 'complex-content'}
    >
      {children}
    </div>
  ),
}));

describe('Sidebar Component', () => {
  it('renders in expanded mode by default', () => {
    mockUseUICommand.mockReturnValue({
      isSidebarCollapsed: false,
      setSidebarCollapsed: vi.fn(),
    });

    render(<Sidebar />);

    // Check for some labels that should be visible when expanded
    // Note: The labels are translated, so they'll be the keys because of our mock
    expect(screen.getByText('OPERATIONS')).toBeInTheDocument();
    expect(screen.getByText('AGENTS')).toBeInTheDocument();

    // Tooltips should NOT be present for main nav links when expanded
    expect(screen.queryByTestId('cyber-tooltip')).not.toBeInTheDocument();
  });

  it('renders in collapsed mode and shows tooltips', () => {
    mockUseUICommand.mockReturnValue({
      isSidebarCollapsed: true,
      setSidebarCollapsed: vi.fn(),
    });

    render(<Sidebar />);

    // Labels should NOT be visible directly (they are inside tooltips or hidden)
    // Wait, the labels might still be in the DOM but hidden.
    // In our mock, CyberTooltip renders children, so the Link with labels might still be there.

    // Verification: CyberTooltip should be present for nav links when collapsed
    const tooltips = screen.getAllByTestId('cyber-tooltip');
    expect(tooltips.length).toBeGreaterThan(0);
  });

  it('toggles theme when theme button is clicked', () => {
    mockUseUICommand.mockReturnValue({ isSidebarCollapsed: false, setSidebarCollapsed: vi.fn() });
    const setTheme = vi.fn();
    mockUseTheme.mockReturnValue({ theme: 'dark', setTheme });
    render(<Sidebar />);

    const themeButton = screen.getByTestId('icon-sun').closest('button');
    fireEvent.click(themeButton!);

    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it('toggles locale when locale button is clicked', () => {
    mockUseUICommand.mockReturnValue({ isSidebarCollapsed: false, setSidebarCollapsed: vi.fn() });
    const setLocale = vi.fn();
    mockUseTranslations.mockReturnValue({ t: (k: string) => k, locale: 'en', setLocale });
    render(<Sidebar />);

    const localeButton = screen.getByText('CN');
    fireEvent.click(localeButton);

    expect(setLocale).toHaveBeenCalledWith('cn');
  });

  it('calls logout API and redirects on logout click', async () => {
    mockUseUICommand.mockReturnValue({ isSidebarCollapsed: false, setSidebarCollapsed: vi.fn() });
    const push = vi.fn();
    mockUseRouter.mockReturnValue({ push, refresh: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);

    render(<Sidebar />);

    const logoutButton = screen.getByText('EXIT').closest('button');
    fireEvent.click(logoutButton!);

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login');
    });
  });

  it('shows online status when connected', () => {
    mockUseUICommand.mockReturnValue({ isSidebarCollapsed: false, setSidebarCollapsed: vi.fn() });
    mockUseRealtimeContext.mockReturnValue({ isConnected: true });
    render(<Sidebar />);
    expect(screen.getByText('ONLINE')).toBeInTheDocument();
  });

  it('shows offline status when disconnected', () => {
    mockUseUICommand.mockReturnValue({ isSidebarCollapsed: false, setSidebarCollapsed: vi.fn() });
    mockUseRealtimeContext.mockReturnValue({ isConnected: false });
    render(<Sidebar />);
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
  });

  it('toggles sidebar collapse state', () => {
    const setSidebarCollapsed = vi.fn();
    mockUseUICommand.mockReturnValue({ isSidebarCollapsed: false, setSidebarCollapsed });
    render(<Sidebar />);

    const toggleButton = screen.getByTestId('icon-panel-close').closest('button');
    fireEvent.click(toggleButton!);
    expect(setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it('toggles mobile menu', () => {
    // We need to trigger the mobile view condition, but since we're using JSDOM
    // it's always "desktop" unless we mock matchMedia or just find the button that is hidden by CSS.
    // In React, the button is always rendered but hidden by CSS.
    mockUseUICommand.mockReturnValue({ isSidebarCollapsed: false, setSidebarCollapsed: vi.fn() });
    render(<Sidebar />);

    const mobileMenuButton = screen.getByTestId('icon-menu').closest('button');
    fireEvent.click(mobileMenuButton!);

    // mobile menu should be open, check for the close icon
    expect(screen.getAllByTestId('icon-x')[0]).toBeInTheDocument();

    fireEvent.click(screen.getAllByTestId('icon-x')[0].closest('button')!);
    expect(screen.getByTestId('icon-menu')).toBeInTheDocument();
  });

  it('closes mobile menu when backdrop is clicked', async () => {
    mockUseUICommand.mockReturnValue({ isSidebarCollapsed: false, setSidebarCollapsed: vi.fn() });
    render(<Sidebar />);

    // Open it first
    fireEvent.click(screen.getByTestId('icon-menu').closest('button')!);

    // Find backdrop by class
    const backdrop = document.querySelector('.bg-background\\/60');
    fireEvent.click(backdrop!);

    await waitFor(() => {
      // The toggle button should show menu icon again
      expect(screen.getByTestId('icon-menu')).toBeInTheDocument();
    });
  });

  it('triggers shortcuts modal when keyboard icon is clicked', () => {
    const setActiveModal = vi.fn();
    mockUseUICommand.mockReturnValue({
      isSidebarCollapsed: false,
      setSidebarCollapsed: vi.fn(),
      setActiveModal,
    });
    render(<Sidebar />);

    const shortcutsButton = screen.getByTestId('icon-keyboard').closest('button');
    fireEvent.click(shortcutsButton!);
    expect(setActiveModal).toHaveBeenCalledWith('shortcuts');
  });

  it('handles logout fetch failure gracefully', async () => {
    mockUseUICommand.mockReturnValue({ isSidebarCollapsed: false, setSidebarCollapsed: vi.fn() });
    const push = vi.fn();
    mockUseRouter.mockReturnValue({ push, refresh: vi.fn() });

    const fetchMock = vi.fn().mockRejectedValue(new Error('Logout failed'));
    vi.stubGlobal('fetch', fetchMock);

    render(<Sidebar />);

    const logoutButton = screen.getByText('EXIT').closest('button');
    fireEvent.click(logoutButton!);

    // Should still redirect even if fetch fails (finally block)
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login');
    });
  });
});
