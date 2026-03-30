#!/usr/bin/env tsx
/**
 * Smart Test Runner - Test Impact Analysis
 *
 * Analyzes code changes and runs only tests that are affected by those changes.
 * This significantly reduces test execution time for incremental changes.
 *
 * Usage:
 *   tsx scripts/test-affected.ts [--base <branch>] [--head <branch>]
 *
 * Examples:
 *   tsx scripts/test-affected.ts                    # Compare HEAD with main
 *   tsx scripts/test-affected.ts --base main        # Same as above
 *   tsx scripts/test-affected.ts --base HEAD~1      # Compare with previous commit
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, relative, dirname, extname } from 'path';

interface DependencyGraph {
  [file: string]: Set<string>;
}

interface TestFile {
  path: string;
  dependencies: Set<string>;
}

class TestImpactAnalyzer {
  private rootDir: string;
  private dependencyGraph: DependencyGraph = {};
  private testFiles: TestFile[] = [];
  private changedFiles: Set<string> = new Set();

  constructor(rootDir: string) {
    this.rootDir = rootDir;
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
   * Parse TypeScript/JavaScript file to extract imports
   */
  extractImports(filePath: string): string[] {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const imports: string[] = [];

      // Match ES6 imports
      const importRegex =
        /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
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

    // Skip node_modules and external imports
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const resolvedPath = join(fromDir, importPath);

    // Try different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', ''];
    for (const ext of extensions) {
      const fullPath = resolvedPath + ext;
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        return fullPath;
      }
    }

    // Try index files
    const indexExtensions = ['.ts', '.tsx', '.js', '.jsx'];
    for (const ext of indexExtensions) {
      const indexPath = join(resolvedPath, `index${ext}`);
      if (existsSync(indexPath) && statSync(indexPath).isFile()) {
        return indexPath;
      }
    }

    return null;
  }

  /**
   * Build dependency graph for the project
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

    console.log(`Built dependency graph with ${Object.keys(this.dependencyGraph).length} files`);
  }

  /**
   * Find all source files in the project
   */
  findSourceFiles(): string[] {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    const ignoreDirs = ['node_modules', '.git', '.sst', 'dist', 'build', 'coverage'];

    const files: string[] = [];

    const walkDir = (dir: string) => {
      try {
        const entries = execSync(`find "${dir}" -type f`, { encoding: 'utf-8' })
          .split('\n')
          .filter((line) => line.trim() !== '');

        for (const entry of entries) {
          const fullPath = join(this.rootDir, entry);
          const ext = extname(fullPath);

          if (extensions.includes(ext)) {
            const relativePath = relative(this.rootDir, fullPath);
            const shouldIgnore = ignoreDirs.some(
              (ignoreDir) => relativePath.startsWith(ignoreDir + '/') || relativePath === ignoreDir
            );

            if (!shouldIgnore) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Ignore errors
      }
    };

    walkDir('.');
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
  runAffectedTests(testFiles: string[]): boolean {
    if (testFiles.length === 0) {
      console.log('No affected tests found');
      return true;
    }

    console.log(`\nRunning ${testFiles.length} affected test(s):`);
    testFiles.forEach((file) => {
      console.log(`  - ${relative(this.rootDir, file)}`);
    });

    const testPaths = testFiles.map((file) => relative(this.rootDir, file)).join(' ');

    try {
      execSync(`pnpm exec vitest run ${testPaths}`, { cwd: this.rootDir, stdio: 'inherit' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Main execution flow
   */
  async run(baseRef: string = 'main', headRef: string = 'HEAD'): Promise<boolean> {
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
    return this.runAffectedTests(affectedTests);
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  let baseRef = 'main';
  let headRef = 'HEAD';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
      baseRef = args[i + 1];
      i++;
    } else if (args[i] === '--head' && args[i + 1]) {
      headRef = args[i + 1];
      i++;
    }
  }

  const rootDir = process.cwd();
  const analyzer = new TestImpactAnalyzer(rootDir);

  const success = await analyzer.run(baseRef, headRef);
  process.exit(success ? 0 : 1);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
