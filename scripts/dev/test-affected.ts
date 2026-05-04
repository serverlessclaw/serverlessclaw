#!/usr/bin/env tsx
/**
 * Smart Test Runner - Test Impact Analysis
 *
 * Analyzes code changes and runs only tests that are affected by those changes.
 * This significantly reduces test execution time for incremental changes.
 *
 * Usage:
 *   tsx scripts/test-affected.ts [options]
 *
 * Examples:
 *   tsx scripts/test-affected.ts                    # Compare HEAD with main
 *   tsx scripts/test-affected.ts --base main        # Same as above
 *   tsx scripts/test-affected.ts --base HEAD~1      # Compare with previous commit
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, relative, dirname, extname, resolve } from 'path';

export interface DependencyGraph {
  [file: string]: Set<string>;
}

export interface TestFile {
  path: string;
  dependencies: Set<string>;
}

export interface AliasMap {
  [prefix: string]: string;
}

export const CONFIG_TRIGGERS = [
  'vitest.config.ts',
  'vitest.config.mts',
  'tsconfig.json',
  'apps/dashboard/tsconfig.json',
  'package.json',
  'pnpm-lock.yaml',
];

export class TestImpactAnalyzer {
  private rootDir: string;
  private dependencyGraph: DependencyGraph = {};
  private testFiles: TestFile[] = [];
  private aliases: AliasMap = {};

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.aliases = this.loadAliases();
  }

  /**
   * Load path aliases from vitest.config.ts
   */
  private loadAliases(): AliasMap {
    const aliases: AliasMap = {};
    const configPath = join(this.rootDir, 'vitest.config.ts');

    if (!existsSync(configPath)) return aliases;

    try {
      const content = readFileSync(configPath, 'utf-8');

      // Extract alias definitions from vitest config
      // Pattern: '@': path.resolve(__dirname, './dashboard/src')
      const aliasRegex = /['"]([^'"]+)['"]:\s*path\.resolve\(__dirname,\s*['"]([^'"]+)['"]\)/g;
      let match;
      while ((match = aliasRegex.exec(content)) !== null) {
        const prefix = match[1];
        const targetDir = resolve(this.rootDir, match[2]);
        aliases[prefix] = targetDir;
      }
    } catch {
      // If parsing fails, return empty aliases
    }

    return aliases;
  }

  /**
   * Get list of changed files between two git references
   */
  getChangedFiles(baseRef: string = 'main', headRef: string = 'HEAD'): string[] {
    try {
      const output = execSync(`git diff --name-only ${baseRef}...${headRef}`, {
        cwd: this.rootDir,
        encoding: 'utf-8',
      });

      return output
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((file) => join(this.rootDir, file));
    } catch (error) {
      console.error('Error getting changed files:', error);
      return [];
    }
  }

  /**
   * Check if any changed file is a config trigger
   */
  isConfigChange(changedFiles: string[]): boolean {
    return changedFiles.some((file) => {
      const rel = relative(this.rootDir, file);
      return CONFIG_TRIGGERS.includes(rel);
    });
  }

  /**
   * Parse TypeScript/JavaScript file to extract imports and exports
   */
  extractImports(filePath: string): string[] {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const imports: string[] = [];

      // Unified regex for static imports and re-exports
      const staticImportRegex =
        /(?:import|export)\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/gs;
      let match;
      while ((match = staticImportRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      // Match require statements
      const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = requireRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      // Match dynamic imports
      const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = dynamicImportRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }

      return imports;
    } catch {
      return [];
    }
  }

  /**
   * Resolve import path to absolute file path
   */
  resolveImportPath(importPath: string, fromFile: string): string | null {
    const fromDir = dirname(fromFile);

    // Check path aliases first (e.g., @/ → dashboard/src)
    for (const [prefix, targetDir] of Object.entries(this.aliases)) {
      if (importPath === prefix || importPath.startsWith(prefix + '/')) {
        const suffix = importPath === prefix ? '' : importPath.slice(prefix.length);
        const resolvedPath = join(targetDir, suffix);
        return this.resolveFilePath(resolvedPath);
      }
    }

    // Skip other non-relative imports (bare specifiers like 'lodash')
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const resolvedPath = join(fromDir, importPath);
    return this.resolveFilePath(resolvedPath);
  }

  /**
   * Try to resolve a path to an actual file with extensions and index files
   */
  private resolveFilePath(resolvedPath: string): string | null {
    // Try different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
    for (const ext of extensions) {
      const fullPath = resolvedPath + ext;
      if (existsSync(fullPath) && !statSync(fullPath).isDirectory()) {
        return fullPath;
      }
    }

    // Try index files for directories
    if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const indexPath = join(resolvedPath, 'index' + ext);
        if (existsSync(indexPath)) {
          return indexPath;
        }
      }
    }

    return null;
  }

  /**
   * Find all source files in the project
   */
  private findSourceFiles(): string[] {
    const files: string[] = [];
    const ignoreDirs = new Set([
      'node_modules',
      '.git',
      '.sst',
      '.next',
      '.open-next',
      'reports',
      'coverage',
    ]);
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];

    const walkDir = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relPath = relative(this.rootDir, fullPath);

        if (entry.isDirectory()) {
          if (!ignoreDirs.has(entry.name) && !relPath.startsWith('.') && relPath !== '') {
            walkDir(fullPath);
          }
        } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
          files.push(fullPath);
        }
      }
    };

    walkDir(this.rootDir);
    return files;
  }

  /**
   * Find all test files in the project
   */
  findTestFiles(): void {
    console.log('Finding test files...');

    const testPatterns = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];
    const sourceFiles = this.findSourceFiles();

    for (const file of sourceFiles) {
      const isTestFile = testPatterns.some((pattern) => file.endsWith(pattern));

      if (isTestFile) {
        const imports = this.extractImports(file);
        const dependencies = new Set<string>();

        for (const importPath of imports) {
          const resolvedPath = this.resolveImportPath(importPath, file);
          if (resolvedPath) {
            dependencies.add(resolvedPath);
          }
        }

        this.testFiles.push({
          path: file,
          dependencies,
        });
      }
    }

    console.log(`Found ${this.testFiles.length} test files`);
  }

  /**
   * Build the dependency graph for all source files
   */
  buildDependencyGraph(): void {
    console.log('Building dependency graph...');

    const sourceFiles = this.findSourceFiles();

    for (const file of sourceFiles) {
      const imports = this.extractImports(file);
      const dependencies = new Set<string>();

      for (const importPath of imports) {
        const resolvedPath = this.resolveImportPath(importPath, file);
        if (resolvedPath) {
          dependencies.add(resolvedPath);
        }
      }

      this.dependencyGraph[file] = dependencies;
    }
  }

  /**
   * Find tests that depend on a changed file
   */
  findAffectedTests(changedFiles: string[]): string[] {
    const affectedTests = new Set<string>();
    const visited = new Set<string>();

    const findDependents = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);

      // Find files that import this file
      for (const [sourceFile, deps] of Object.entries(this.dependencyGraph)) {
        if (deps.has(file)) {
          // Check if this is a test file
          const testFile = this.testFiles.find((tf) => tf.path === sourceFile);
          if (testFile) {
            affectedTests.add(sourceFile);
          }

          // Recursively find dependents
          findDependents(sourceFile);
        }
      }
    };

    for (const changedFile of changedFiles) {
      findDependents(changedFile);

      // Also check if the changed file itself is a test file
      const testFile = this.testFiles.find((tf) => tf.path === changedFile);
      if (testFile) {
        affectedTests.add(changedFile);
      }
    }

    return Array.from(affectedTests);
  }

  /**
   * Run affected tests
   */
  runAffectedTests(testFiles: string[], dryRun: boolean = false): boolean {
    if (testFiles.length === 0) {
      console.log('No affected tests found');
      return true;
    }

    console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Running ${testFiles.length} affected test(s):`);
    testFiles.forEach((file) => {
      console.log(`  - ${relative(this.rootDir, file)}`);
    });

    if (dryRun) {
      console.log('\n[DRY RUN] Skipping test execution');
      return true;
    }

    const testPaths = testFiles.map((file) => relative(this.rootDir, file)).join(' ');

    try {
      execSync(`pnpm exec vitest run ${testPaths}`, { cwd: this.rootDir, stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run full test suite
   */
  runAllTests(dryRun: boolean = false): boolean {
    console.log('\nRunning full test suite...');

    if (dryRun) {
      console.log('[DRY RUN] Would run: pnpm exec vitest run');
      return true;
    }

    try {
      execSync('pnpm exec vitest run', { cwd: this.rootDir, stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Main execution flow
   */
  async run(
    baseRef: string = 'main',
    headRef: string = 'HEAD',
    dryRun: boolean = false,
    runAll: boolean = false
  ): Promise<boolean> {
    if (runAll) {
      return this.runAllTests(dryRun);
    }

    console.log(`Analyzing changes between ${baseRef} and ${headRef}...\n`);

    // Get changed files
    const changedFiles = this.getChangedFiles(baseRef, headRef);

    if (changedFiles.length === 0) {
      console.log('No changes detected');
      return true;
    }

    console.log(`Found ${changedFiles.length} changed file(s):`);
    changedFiles.forEach((file) => {
      console.log(`  - ${relative(this.rootDir, file)}`);
    });
    console.log('');

    // Check for config changes — run all tests as fail-safe
    if (this.isConfigChange(changedFiles)) {
      console.log('⚠️  Config file changed — running full test suite as fail-safe\n');
      return this.runAllTests(dryRun);
    }

    // Filter to only source files (not config, docs, etc.)
    const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx'];
    const changedSourceFiles = changedFiles.filter((file) =>
      sourceExtensions.some((ext) => file.endsWith(ext))
    );

    if (changedSourceFiles.length === 0) {
      console.log('No source file changes detected');
      return true;
    }

    // Build dependency graph
    this.buildDependencyGraph();

    // Find test files
    this.findTestFiles();

    // Find affected tests
    const affectedTests = this.findAffectedTests(changedSourceFiles);

    // Run affected tests
    return this.runAffectedTests(affectedTests, dryRun);
  }
}

// CLI interface — only run when executed directly
const isMainModule = process.argv[1] && process.argv[1].includes('test-affected');
if (isMainModule) {
  async function main() {
    const args = process.argv.slice(2);
    let baseRef = 'main';
    let headRef = 'HEAD';
    let dryRun = false;
    let runAll = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--help' || args[i] === '-h') {
        console.log(`
Smart Test Runner - Test Impact Analysis

Usage:
  tsx scripts/test-affected.ts [options]

Options:
  --base <ref>    Git reference to compare against (default: main)
  --head <ref>    Git reference for current state (default: HEAD)
  --dry-run       Analyze changes but do not execute vitest
  --list          List affected test files and exit
  --all           Force run all tests regardless of changes
  --help, -h      Show this help message
        `);
        process.exit(0);
      }

      if (args[i] === '--base' && args[i + 1]) {
        baseRef = args[i + 1];
        i++;
      } else if (args[i] === '--head' && args[i + 1]) {
        headRef = args[i + 1];
        i++;
      } else if (args[i] === '--dry-run' || args[i] === '--list') {
        dryRun = true;
      } else if (args[i] === '--all') {
        runAll = true;
      }
    }

    const rootDir = process.cwd();
    const analyzer = new TestImpactAnalyzer(rootDir);

    const success = await analyzer.run(baseRef, headRef, dryRun, runAll);
    process.exit(success ? 0 : 1);
  }

  main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
