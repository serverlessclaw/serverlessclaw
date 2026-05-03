import { SidebarExtension, DynamicComponentExtension } from '../components/Providers/ExtensionProvider';

/**
 * ServerlessClaw Dashboard Extensions
 * This is the central hub for registering domain-specific UI components and navigation
 * from other projects in the monorepo (e.g., VoltX).
 */
export interface ExtensionRegistry {
  registerSidebar: (extension: SidebarExtension) => void;
  registerComponent: (extension: DynamicComponentExtension) => void;
}

export function init({ registerSidebar, registerComponent }: ExtensionRegistry) {
  // Base framework has no extensions by default.
  // Add project-specific initializations here:
  // e.g., voltx.init({ registerSidebar, registerComponent });
}
