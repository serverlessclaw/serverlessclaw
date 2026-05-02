#!/usr/bin/env tsx
/**
 * Documentation Validator
 *
 * Validates that documentation stays in sync with code changes.
 * Supports semantic validation of agent rosters, tool registries, and anchor links.
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
import { readFileSync, existsSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, relative, dirname, extname } from 'path';

export interface DocIssue {
  type:
    | 'missing_update'
    | 'broken_link'
    | 'outdated_diagram'
    | 'missing_doc'
    | 'agent_roster_mismatch'
    | 'tool_registry_mismatch'
    | 'broken_anchor';
  file: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface DocMapping {
  codePattern: RegExp;
  docFile: string;
  description: string;
}

export class DocumentationValidator {
  private rootDir: string;
  private strict: boolean;
  private issues: DocIssue[] = [];

  // Mapping of code changes to required documentation updates (loaded from JSON)
  private docMappings: DocMapping[] = [];

  constructor(rootDir: string, strict: boolean = false) {
    this.rootDir = rootDir;
    this.strict = strict;
    this.loadMappings();
  }

  /**
   * Load documentation mappings from .github/doc-mapping.json
   */
  private loadMappings(): void {
    const mappingPath = join(this.rootDir, '.github/doc-mapping.json');
    if (!existsSync(mappingPath)) {
      console.warn('⚠️  Warning: .github/doc-mapping.json not found. Using empty mappings.');
      return;
    }

    try {
      const data = JSON.parse(readFileSync(mappingPath, 'utf-8'));
      this.docMappings = data.mappings.map((m: any) => {
        // Convert glob-style patterns to RegExp if they aren't already regex-like
        let pattern = m.pattern;
        if (!pattern.startsWith('^') && (pattern.includes('*') || pattern.includes('/**'))) {
          pattern = '^' + pattern
            .replace(/\./g, '\\.')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*') + '$';
        }
        
        return {
          codePattern: new RegExp(pattern),
          docFile: m.docs[0],
          description: m.description || `Changes in ${m.pattern} require documentation updates`,
        };
      });
    } catch (error) {
      console.error('❌ Error parsing doc-mapping.json:', error);
    }
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
  extractLinks(content: string): { text: string; url: string }[] {
    const links: { text: string; url: string }[] = [];

    // Match markdown links [text](url)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      links.push({ text: match[1], url: match[2] });
    }

    return links;
  }

  /**
   * Extract all headers from markdown content as anchor targets
   */
  extractAnchors(content: string): Set<string> {
    const anchors = new Set<string>();
    const headerRegex = /^#{1,6}\s+(.+)$/gm;
    let match;

    while ((match = headerRegex.exec(content)) !== null) {
      // Convert header to anchor: lowercase, replace spaces/special chars with hyphens
      const anchor = match[1]
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      anchors.add(anchor);
    }

    return anchors;
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
        const anchors = this.extractAnchors(content);

        for (const link of links) {
          // Skip external links
          if (link.url.startsWith('http://') || link.url.startsWith('https://')) {
            continue;
          }

          // Handle anchor-only links (#section)
          if (link.url.startsWith('#')) {
            const anchor = link.url.slice(1);
            if (!anchors.has(anchor)) {
              this.issues.push({
                type: 'broken_anchor',
                file: relative(this.rootDir, file),
                message: `Broken anchor link: ${link.url} (target not found)`,
                severity: 'warning',
              });
            }
            continue;
          }

          // Handle file links with anchor (./other.md#section)
          let filePath = link.url;
          let anchor: string | null = null;
          const hashIndex = link.url.indexOf('#');
          if (hashIndex !== -1) {
            filePath = link.url.slice(0, hashIndex);
            anchor = link.url.slice(hashIndex + 1);
          }

          // Skip empty path (pure anchor links handled above)
          if (!filePath) continue;

          // Check if local file exists
          const linkPath = filePath.startsWith('/')
            ? join(this.rootDir, filePath)
            : join(dirname(file), filePath);

          if (!existsSync(linkPath)) {
            this.issues.push({
              type: 'broken_link',
              file: relative(this.rootDir, file),
              message: `Broken link: ${link.url}`,
              severity: 'error',
            });
          } else if (anchor) {
            // Validate anchor exists in target file
            try {
              const targetContent = readFileSync(linkPath, 'utf-8');
              const targetAnchors = this.extractAnchors(targetContent);
              if (!targetAnchors.has(anchor)) {
                this.issues.push({
                  type: 'broken_anchor',
                  file: relative(this.rootDir, file),
                  message: `Broken anchor in cross-file link: ${link.url} (anchor '#${anchor}' not found in ${filePath})`,
                  severity: 'warning',
                });
              }
            } catch {
              // Ignore read errors for cross-file anchor checks
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  /**
   * Find all markdown files using readdirSync (no shell-out)
   */
  findMarkdownFiles(): string[] {
    const files: string[] = [];
    const ignoreDirs = new Set(['node_modules', '.git', '.sst', '.next', '.open-next']);

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
          if (!ignoreDirs.has(entry.name) && !relPath.startsWith('.')) {
            walkDir(fullPath);
          }
        } else if (entry.isFile() && extname(entry.name) === '.md') {
          files.push(fullPath);
        }
      }
    };

    walkDir(this.rootDir);
    return files;
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
      'docs/intelligence/AGENTS.md',
      'docs/intelligence/TOOLS.md',
      'docs/intelligence/MEMORY.md',
      'docs/intelligence/LLM.md',
      'docs/governance/DEVOPS.md',
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
   * Validate that agent roster in docs/AGENTS.md matches core/agents/ directory
   */
  validateAgentRoster(): void {
    console.log('Validating agent roster...\n');

    const agentsDocPath = join(this.rootDir, 'docs/intelligence/AGENTS.md');
    const agentsDirPath = join(this.rootDir, 'core/agents');

    if (!existsSync(agentsDocPath) || !existsSync(agentsDirPath)) {
      return;
    }

    // Get agent files from core/agents/ (non-test .ts files at top level)
    const agentFiles = new Set<string>();
    try {
      const entries = readdirSync(agentsDirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          agentFiles.add(entry.name.replace(/\.ts$/, ''));
        }
      }
    } catch {
      return;
    }

    // Extract agent names from docs/AGENTS.md table
    const docContent = readFileSync(agentsDocPath, 'utf-8');
    const documentedAgents = new Set<string>();

    // Match table rows with agent links like `core/agents/coder.ts`
    const agentRefRegex = /core\/agents\/([a-z][a-z0-9-]+)\.ts/g;
    let match;
    while ((match = agentRefRegex.exec(docContent)) !== null) {
      documentedAgents.add(match[1]);
    }

    // Check for agents in code but not in docs
    for (const agent of agentFiles) {
      if (!documentedAgents.has(agent)) {
        this.issues.push({
          type: 'agent_roster_mismatch',
          file: 'docs/intelligence/AGENTS.md',
          message: `Agent '${agent}' exists in core/agents/ but is not documented in AGENTS.md`,
          severity: 'warning',
        });
      }
    }

    // Check for agents in docs but not in code
    for (const agent of documentedAgents) {
      if (!agentFiles.has(agent)) {
        this.issues.push({
          type: 'agent_roster_mismatch',
          file: 'docs/intelligence/AGENTS.md',
          message: `Agent '${agent}' is documented in AGENTS.md but has no file in core/agents/`,
          severity: 'warning',
        });
      }
    }
  }

  /**
   * Validate that tool registry in docs/TOOLS.md matches TOOLS enum in constants.ts
   */
  validateToolRegistry(): void {
    console.log('Validating tool registry...\n');

    const toolsDocPath = join(this.rootDir, 'docs/intelligence/TOOLS.md');
    const constantsPath = join(this.rootDir, 'core/lib/constants.ts');

    if (!existsSync(toolsDocPath) || !existsSync(constantsPath)) {
      return;
    }

    // Extract tool names from TOOLS enum in constants.ts
    const constantsContent = readFileSync(constantsPath, 'utf-8');
    const codeTools = new Set<string>();

    // Match entries in the TOOLS object: toolName: 'toolName',
    const toolsBlock = constantsContent.match(
      /export const TOOLS\s*=\s*\{([\s\S]*?)\}[\s;]*as\s+const/
    );
    if (toolsBlock) {
      const toolEntryRegex = /(\w+)\s*:/g;
      let toolMatch;
      while ((toolMatch = toolEntryRegex.exec(toolsBlock[1])) !== null) {
        codeTools.add(toolMatch[1]);
      }
    }

    // Extract tool names mentioned in docs/TOOLS.md
    const docContent = readFileSync(toolsDocPath, 'utf-8');
    const documentedTools = new Set<string>();

    // Match tool names in code blocks or inline code: `toolName`
    const docToolRegex = /`([a-z][a-zA-Z]+)`/g;
    let docMatch;
    while ((docMatch = docToolRegex.exec(docContent)) !== null) {
      documentedTools.add(docMatch[1]);
    }

    // Check for tools in code but not in docs
    for (const tool of codeTools) {
      if (!documentedTools.has(tool)) {
        this.issues.push({
          type: 'tool_registry_mismatch',
          file: 'docs/intelligence/TOOLS.md',
          message: `Tool '${tool}' exists in TOOLS enum (core/lib/constants.ts) but is not documented in TOOLS.md`,
          severity: 'warning',
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
      report += 'No documentation issues found!\n';
      return report;
    }

    // Group by type
    const byType: Record<string, DocIssue[]> = {};
    for (const issue of this.issues) {
      if (!byType[issue.type]) byType[issue.type] = [];
      byType[issue.type].push(issue);
    }

    report += '## Summary\n\n';
    report += `| Issue Type | Count |\n`;
    report += `|------------|-------|\n`;
    for (const [type, issues] of Object.entries(byType)) {
      const title = type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      report += `| ${title} | ${issues.length} |\n`;
    }
    report += `| **Total** | **${this.issues.length}** |\n\n`;

    // Details
    for (const [type, issues] of Object.entries(byType)) {
      const title = type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
      report += `## ${title} (${issues.length})\n\n`;

      for (const issue of issues) {
        const icon = issue.severity === 'error' ? 'FAIL' : 'WARN';
        report += `[${icon}] **${issue.file}**\n`;
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
    this.validateAgentRoster();
    this.validateToolRegistry();

    // Generate and print report
    const report = this.generateReport();
    console.log(report);

    // Save report
    const reportPath = join(this.rootDir, 'reports', 'docs-validation-report.md');
    const reportDir = dirname(reportPath);
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true });
    }
    writeFileSync(reportPath, report);
    console.log(`Report saved to: ${reportPath}\n`);

    // Check if we should fail
    const hasErrors = this.issues.some((i) => i.severity === 'error');
    const hasWarnings = this.issues.some((i) => i.severity === 'warning');

    if (hasErrors || (this.strict && hasWarnings)) {
      console.error('Documentation validation failed');
      return false;
    }

    console.log('Documentation validation passed');
    return true;
  }
}

// CLI interface — only run when executed directly
const isMainModule = process.argv[1] && process.argv[1].includes('docs-check');
if (isMainModule) {
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
}
