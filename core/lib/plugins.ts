import { PluginManager } from './plugin-manager';

/**
 * Hub for all internal monorepo plugins.
 * Projects like 'voltx' or specialized integrations can register their
 * capabilities here.
 */
export async function initializePlugins() {
  await PluginManager.initialize();
  
  // Example: Manual registration of an internal project's capabilities
  // In a real monorepo setup, you might use dynamic imports or 
  // generated code to avoid circular dependencies.
  
  /*
  try {
    const { voltxPlugin } = await import('../../integrations/voltx/plugin');
    await PluginManager.register(voltxPlugin);
  } catch (e) {
    // Ignore if project is not present in this build
  }
  */
  
  try {
    const { githubPlugin } = await import('../../integrations/github/plugin');
    await PluginManager.register(githubPlugin);
  } catch (e) {
    // Ignore if github integration is not present
  }
}
