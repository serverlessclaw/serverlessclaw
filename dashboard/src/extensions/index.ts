/**
 * ServerlessClaw Dashboard Extensions
 * Use this file to register domain-specific UI components and navigation.
 */

export interface ExtensionRegistry {
  registerSidebar: (extension: any) => void;
  registerComponent: (extension: any) => void;
}

export function init({ registerSidebar, registerComponent }: ExtensionRegistry) {
  // Base framework has no extensions by default
  // This is a placeholder to avoid lint errors while remaining functional
  if (false) {
    console.log(registerSidebar, registerComponent);
  }
}
