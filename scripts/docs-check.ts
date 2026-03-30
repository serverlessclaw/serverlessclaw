#!/usr/bin/env tsx
/**
 * Documentation Validator
 *
 * Validates that documentation stays in sync with code changes.
 * Checks for missing documentation updates, broken links, and outdated content.
 *
 * Usage:
 *   tsx scripts/docs-check.ts [--base <branch>] [--strict]
 *
 * Examples:
 *   tsx scripts/docs-check.ts                  # Check docs against changes
 *   tsx scripts/docs-check.ts --base main      # Compare with main branch
 *   tsx scripts/docs-check.ts --strict         # Fail on any issues
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, relative, dirname } from 'path';

interface DocIssue {
  type: 'missing_update' | 'broken_link' | 'outdated_diagram' | 'missing_doc';
  file: string;
  message: string;
  severity: 'warning' | 'error';
}

interface DocMapping {
  codePattern: RegExp;
  docFile: string;
  description: string;
}

class DocumentationValidator {
  private rootDir: string;
  private strict: boolean;
  private issues: DocIssue[] = [];

  // Mapping of code changes to required documentation updates
  private docMappings: DocMapping[] = [
    {
      codePattern: /core\/agents\/.*\.ts$/,
      docFile: 'docs/AGENTS.md',
      description: 'Agent changes require AGENTS.md update',
    },
    {
      codePattern: /core\/tools\/.*\.ts$/,
      docFile: 'docs/TOOLS.md',
      description: 'Tool changes require TOOLS.md update',
    },
    {
      codePattern: /core\/handlers\/events\.ts$/,
      docFile: 'ARCHITECTURE.md',
      description: 'Event handler changes require ARCHITECTURE.md update',
    },
    {
      codePattern: /core\/handlers\/monitor\.ts$/,
      docFile: 'ARCHITECTURE.md',
      description: 'Monitor changes require ARCHITECTURE.md update',
    },
    {
      codePattern: /core\/lib\/types\/.*\.ts$/,
      docFile: 'ARCHITECTURE.md',
      description: 'Type changes may require ARCHITECTURE.md update',
    },
    {
      codePattern: /core\/lib\/memory\/.*\.ts$/,
      docFile: 'docs/MEMORY.md',
      description: 'Memory changes require MEMORY.md update',
    },
    {
      codePattern: /core\/lib\/providers\/.*\.ts$/,
      docFile: 'docs/LLM.md',
      description: 'Provider changes require LLM.md update',
    },
    {
      codePattern: /infra\/.*\.ts$/,
      docFile: 'ARCHITECTURE.md',
      description: 'Infrastructure changes require ARCHITECTURE.md update',
    },
    {
      codePattern: /makefiles\/.*\.mk$/,
      docFile: 'docs/DEVOPS.md',
      description: 'Makefile changes require DEVOPS.md update',
    },
  ];

  constructor(rootDir: string, strict: boolean = false) {
    this.rootDir = rootDir;
    this.strict = strict;
  }

  /**
   * Get list of changed files between two git references
   */
  getChangedFiles(baseRef: string = 'main'): string[] {
    try {
      const output = execSync(`git diff --name-only ${baseRef}...HEAD`, {
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
   * Check if documentation was updated for code changes
   */
  checkDocUpdates(changedFiles: string[]): void {
    console.log('Checking documentation updates...\n');

    const changedDocs = new Set<string>();
    const codeChangesNeedingDocs: { codeFile: string; docFile: string; description: string }[] = [];

    // Identify which docs were changed
    for (const file of changedFiles) {
      const relativePath = relative(this.rootDir, file);
      if (relativePath.endsWith('.md')) {
        changedDocs.add(relativePath);
      }
    }

    // Check if code changes require doc updates
    for (const file of changedFiles) {
      const relativePath = relative(this.rootDir, file);

      for (const mapping of this.docMappings) {
        if (mapping.codePattern.test(relativePath)) {
          const docRelative = mapping.docFile;

          if (!changedDocs.has(docRelative)) {
            codeChangesNeedingDocs.push({
              codeFile: relativePath,
              docFile: docRelative,
              description: mapping.description,
            });
          }
        }
      }
    }

    // Report issues
    for (const { codeFile, docFile, description } of codeChangesNeedingDocs) {
      this.issues.push({
        type: 'missing_update',
        file: codeFile,
        message: `${description}. Changed: ${codeFile}, Expected update: ${docFile}`,
        severity: 'warning',
      });
    }
  }

  /**
   * Extract links from markdown file
   */
  extractLinks(content: string): string[] {
    const links: string[] = [];

    // Match markdown links [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      links.push(match[2]);
    }

    // Match reference links [text][ref]
    const refRegex = /\[([^\]]+)\]\[([^\]]+)\]/g;
    while ((match = refRegex.exec(content)) !== null) {
      links.push(match[2]);
    }

    return links;
  }

  /**
   * Check for broken links in documentation
   */
  checkBrokenLinks(): void {
    console.log('Checking for broken links...\n');

    const mdFiles = this.findMarkdownFiles();

    for (const file of mdFiles) {
      try {
        const content = readFileSync(file, 'utf-8');
        const links = this.extractLinks(content);

        for (const link of links) {
          // Skip external links
          if (link.startsWith('http://') || link.startsWith('https://')) {
            continue;
          }

          // Skip anchors
          if (link.startsWith('#')) {
            continue;
          }

          // Check if local file exists
          const linkPath = link.startsWith('/')
            ? join(this.rootDir, link)
            : join(dirname(file), link);

          if (!existsSync(linkPath)) {
            this.issues.push({
              type: 'broken_link',
              file: relative(this.rootDir, file),
              message: `Broken link: ${link}`,
              severity: 'error',
            });
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  /**
   * Find all markdown files in the project
   */
  findMarkdownFiles(): string[] {
    try {
      const output = execSync(
        'find . -name "*.md" -type f ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/.sst/*"',
        { cwd: this.rootDir, encoding: 'utf-8' }
      );

      return output
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((file) => join(this.rootDir, file));
    } catch {
      return [];
    }
  }

  /**
   * Check for ASCII diagrams in documentation
   */
  checkDiagrams(): void {
    console.log('Checking ASCII diagrams...\n');

    const mdFiles = this.findMarkdownFiles();

    for (const file of mdFiles) {
      try {
        const content = readFileSync(file, 'utf-8');

        // Look for ASCII diagram patterns
        const hasDiagram = /```\s*\n[\s\S]*?[+\-|][\s\S]*?```/.test(content);

        if (hasDiagram) {
          const relativePath = relative(this.rootDir, file);

          // Check if diagram looks outdated (heuristic: very old diagrams often lack proper formatting)
          const diagramBlocks = content.match(/```\s*\n[\s\S]*?[+\-|][\s\S]*?```/g) || [];

          for (const block of diagramBlocks) {
            // Check for common signs of outdated diagrams
            const lines = block.split('\n');
            const hasProperFormatting = lines.some(
              (line) => line.includes('+---+') || line.includes('|') || line.includes('--->')
            );

            if (!hasProperFormatting) {
              this.issues.push({
                type: 'outdated_diagram',
                file: relativePath,
                message: 'ASCII diagram may need review for proper formatting',
                severity: 'warning',
              });
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  /**
   * Check for missing documentation files
   */
  checkMissingDocs(): void {
    console.log('Checking for missing documentation...\n');

    const requiredDocs = [
      'README.md',
      'ARCHITECTURE.md',
      'docs/AGENTS.md',
      'docs/TOOLS.md',
      'docs/MEMORY.md',
      'docs/LLM.md',
      'docs/DEVOPS.md',
    ];

    for (const doc of requiredDocs) {
      const docPath = join(this.rootDir, doc);
      if (!existsSync(docPath)) {
        this.issues.push({
          type: 'missing_doc',
          file: doc,
          message: `Required documentation file is missing: ${doc}`,
          severity: 'error',
        });
      }
    }
  }

  /**
   * Generate report
   */
  generateReport(): string {
    let report = '# Documentation Validation Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    if (this.issues.length === 0) {
      report += '✅ No documentation issues found!\n';
      return report;
    }

    // Group by type
    const byType = {
      missing_update: this.issues.filter((i) => i.type === 'missing_update'),
      broken_link: this.issues.filter((i) => i.type === 'broken_link'),
      outdated_diagram: this.issues.filter((i) => i.type === 'outdated_diagram'),
      missing_doc: this.issues.filter((i) => i.type === 'missing_doc'),
    };

    report += '## Summary\n\n';
    report += `| Issue Type | Count |\n`;
    report += `|------------|-------|\n`;
    report += `| Missing Updates | ${byType.missing_update.length} |\n`;
    report += `| Broken Links | ${byType.broken_link.length} |\n`;
    report += `| Outdated Diagrams | ${byType.outdated_diagram.length} |\n`;
    report += `| Missing Docs | ${byType.missing_doc.length} |\n`;
    report += `| **Total** | **${this.issues.length}** |\n\n`;

    // Details
    for (const [type, issues] of Object.entries(byType)) {
      if (issues.length === 0) continue;

      const title = type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      report += `## ${title} (${issues.length})\n\n`;

      for (const issue of issues) {
        const icon = issue.severity === 'error' ? '❌' : '⚠️';
        report += `${icon} **${issue.file}**\n`;
        report += `   ${issue.message}\n\n`;
      }
    }

    return report;
  }

  /**
   * Main execution flow
   */
  async run(baseRef: string = 'main'): Promise<boolean> {
    console.log(`Validating documentation against ${baseRef}...\n`);

    // Get changed files
    const changedFiles = this.getChangedFiles(baseRef);

    if (changedFiles.length === 0) {
      console.log('No changes detected');
      return true;
    }

    console.log(`Found ${changedFiles.length} changed file(s)\n`);

    // Run all checks
    this.checkDocUpdates(changedFiles);
    this.checkBrokenLinks();
    this.checkDiagrams();
    this.checkMissingDocs();

    // Generate and print report
    const report = this.generateReport();
    console.log(report);

    // Save report
    const reportPath = join(this.rootDir, 'docs-validation-report.md');
    writeFileSync(reportPath, report);
    console.log(`Report saved to: ${reportPath}\n`);

    // Check if we should fail
    const hasErrors = this.issues.some((i) => i.severity === 'error');
    const hasWarnings = this.issues.some((i) => i.severity === 'warning');

    if (hasErrors || (this.strict && hasWarnings)) {
      console.error('❌ Documentation validation failed');
      return false;
    }

    console.log('✅ Documentation validation passed');
    return true;
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  let baseRef = 'main';
  let strict = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
      baseRef = args[i + 1];
      i++;
    } else if (args[i] === '--strict') {
      strict = true;
    }
  }

  const rootDir = process.cwd();
  const validator = new DocumentationValidator(rootDir, strict);

  const success = await validator.run(baseRef);
  process.exit(success ? 0 : 1);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
