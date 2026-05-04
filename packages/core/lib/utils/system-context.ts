import fs from 'fs';
import { join } from 'path';
import { logger } from '../logger';

export interface SystemContextInfo {
  version: string;
  dependencies: Record<string, string>;
  nodeVersion: string;
  platform: string;
  env: string;
}

/**
 * System Context Utility
 * Provides static analysis data about the environment and codebase.
 * (Principle 17: Advanced Cognitive Resilience)
 */
export class SystemContext {
  private static cachedContext: string | null = null;

  /**
   * Reads and caches the environmental constraints block.
   */
  static getEnvironmentalConstraints(): string {
    if (this.cachedContext) return this.cachedContext;

    try {
      const rootPath = process.cwd();
      const pkgPath = join(rootPath, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      const info: SystemContextInfo = {
        version: pkg.version || 'unknown',
        dependencies: pkg.dependencies || {},
        nodeVersion: process.version,
        platform: process.platform,
        env: process.env.NODE_ENV || 'development',
      };

      const deps = Object.entries(info.dependencies)
        .map(([name, ver]) => `${name}@${ver}`)
        .join(', ');

      this.cachedContext = `
[ENVIRONMENTAL_CONSTRAINTS]:
- VERSION: ${info.version}
- RUNTIME: Node ${info.nodeVersion} on ${info.platform}
- ENVIRONMENT: ${info.env}
- KEY_DEPENDENCIES: ${deps}
- PROJECT_TYPE: Monorepo (SST v4 + Next.js 16)
`;
      return this.cachedContext;
    } catch (e) {
      logger.warn('[SYSTEM_CONTEXT] Failed to load package.json:', e);
      return '\n[ENVIRONMENTAL_CONSTRAINTS]:\n- Status: Unavailable\n';
    }
  }

  /**
   * Refreshes the cached context (useful if package.json changes during runtime).
   */
  static refresh(): void {
    this.cachedContext = null;
  }
}
