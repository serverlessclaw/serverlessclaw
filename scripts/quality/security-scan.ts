#!/usr/bin/env tsx
/**
 * Dependency Security Scanner
 *
 * Scans project dependencies for known vulnerabilities and generates a report.
 * Supports SARIF output for GitHub Security tab integration.
 *
 * Usage:
 *   tsx scripts/security-scan.ts [--severity <level>] [--fix] [--sarif] [--output <path>]
 *
 * Examples:
 *   tsx scripts/security-scan.ts                          # Scan all vulnerabilities
 *   tsx scripts/security-scan.ts --severity critical      # Only fail on critical
 *   tsx scripts/security-scan.ts --fix                    # Attempt auto-fix (max 1 retry)
 *   tsx scripts/security-scan.ts --sarif                  # Generate SARIF output
 *   tsx scripts/security-scan.ts --output report.md       # Custom report location
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

export interface Vulnerability {
  name: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  title: string;
  url: string;
  range: string;
  fixAvailable: boolean | { name: string; version: string };
}

export interface AuditResult {
  vulnerabilities: Vulnerability[];
  summary: {
    total: number;
    low: number;
    moderate: number;
    high: number;
    critical: number;
  };
}

export class SecurityScanner {
  private rootDir: string;
  private severityThreshold: 'low' | 'moderate' | 'high' | 'critical';
  private autoFix: boolean;
  private maxFixAttempts: number;
  private fixAttempts: number = 0;
  private sarifOutput: boolean;
  private outputPath: string;

  constructor(
    rootDir: string,
    severityThreshold: 'low' | 'moderate' | 'high' | 'critical' = 'high',
    autoFix: boolean = false,
    sarifOutput: boolean = false,
    outputPath?: string
  ) {
    this.rootDir = rootDir;
    this.severityThreshold = severityThreshold;
    this.autoFix = autoFix;
    this.maxFixAttempts = 1;
    this.sarifOutput = sarifOutput;
    this.outputPath = outputPath || join(rootDir, 'reports', 'security-audit-report.md');
  }

  /**
   * Run pnpm audit and parse results
   */
  async runAudit(): Promise<AuditResult> {
    console.log('Running security audit...\n');

    try {
      const output = execSync('pnpm audit --json', {
        cwd: this.rootDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return this.parseAuditOutput(output);
    } catch (error: any) {
      // pnpm audit returns non-zero exit code when vulnerabilities are found
      if (error.stdout) {
        return this.parseAuditOutput(error.stdout);
      }
      throw error;
    }
  }

  /**
   * Parse pnpm audit JSON output
   */
  parseAuditOutput(output: string): AuditResult {
    try {
      const data = JSON.parse(output);
      const vulnerabilities: Vulnerability[] = [];

      // Parse advisories (pnpm audit format)
      if (data.advisories) {
        for (const [_id, advisory] of Object.entries(data.advisories) as [string, any][]) {
          vulnerabilities.push({
            name: advisory.module_name,
            severity: advisory.severity,
            title: advisory.title,
            url: advisory.url,
            range: advisory.vulnerable_versions,
            fixAvailable: advisory.patched_versions ? true : false,
          });
        }
      }

      // Parse vulnerabilities (newer pnpm audit format)
      if (data.vulnerabilities) {
        for (const [name, vuln] of Object.entries(data.vulnerabilities) as [string, any][]) {
          vulnerabilities.push({
            name,
            severity: vuln.severity,
            title: vuln.title || 'No title available',
            url: vuln.url || '',
            range: vuln.range || '',
            fixAvailable: vuln.fixAvailable || false,
          });
        }
      }

      // Calculate summary
      const summary = {
        total: vulnerabilities.length,
        low: vulnerabilities.filter((v) => v.severity === 'low').length,
        moderate: vulnerabilities.filter((v) => v.severity === 'moderate').length,
        high: vulnerabilities.filter((v) => v.severity === 'high').length,
        critical: vulnerabilities.filter((v) => v.severity === 'critical').length,
      };

      return { vulnerabilities, summary };
    } catch (error) {
      console.error('Error parsing audit output:', error);
      return {
        vulnerabilities: [],
        summary: { total: 0, low: 0, moderate: 0, high: 0, critical: 0 },
      };
    }
  }

  /**
   * Check if vulnerability meets severity threshold
   */
  meetsThreshold(severity: string): boolean {
    const levels = ['low', 'moderate', 'high', 'critical'];
    const thresholdIndex = levels.indexOf(this.severityThreshold);
    const severityIndex = levels.indexOf(severity);
    return severityIndex >= thresholdIndex;
  }

  /**
   * Attempt to fix vulnerabilities automatically
   */
  async attemptFix(): Promise<boolean> {
    console.log('\nAttempting automatic fixes...\n');

    try {
      execSync('pnpm audit fix', {
        cwd: this.rootDir,
        stdio: 'inherit',
      });
      return true;
    } catch (error) {
      console.error('Auto-fix failed:', error);
      return false;
    }
  }

  /**
   * Generate SARIF format output for GitHub Security tab
   */
  generateSarif(result: AuditResult): string {
    const sarif = {
      $schema:
        'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'pnpm-audit',
              version: '1.0.0',
              informationUri: 'https://docs.npmjs.com/cli/v10/commands/npm-audit',
              rules: result.vulnerabilities.map((vuln, idx) => ({
                id: `VULN-${idx}`,
                shortDescription: { text: `${vuln.name}: ${vuln.title}` },
                fullDescription: { text: `${vuln.name}@${vuln.range} - ${vuln.title}` },
                helpUri: vuln.url || 'https://github.com/advisories',
                properties: { severity: vuln.severity },
                defaultConfiguration: {
                  level: this.sarifSeverityToLevel(vuln.severity),
                },
              })),
            },
          },
          results: result.vulnerabilities.map((vuln, idx) => ({
            ruleId: `VULN-${idx}`,
            level: this.sarifSeverityToLevel(vuln.severity),
            message: { text: `${vuln.name}@${vuln.range}: ${vuln.title}` },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'package.json' },
                  region: { startLine: 1, startColumn: 1 },
                },
              },
            ],
          })),
        },
      ],
    };

    return JSON.stringify(sarif, null, 2);
  }

  private sarifSeverityToLevel(severity: string): string {
    switch (severity) {
      case 'critical':
        return 'error';
      case 'high':
        return 'error';
      case 'moderate':
        return 'warning';
      default:
        return 'note';
    }
  }

  /**
   * Generate markdown report
   */
  generateReport(result: AuditResult): string {
    const { vulnerabilities, summary } = result;

    let report = '# Security Audit Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;

    // Summary
    report += '## Summary\n\n';
    report += `| Severity | Count |\n`;
    report += `|----------|-------|\n`;
    report += `| Critical | ${summary.critical} |\n`;
    report += `| High     | ${summary.high} |\n`;
    report += `| Moderate | ${summary.moderate} |\n`;
    report += `| Low      | ${summary.low} |\n`;
    report += `| **Total** | **${summary.total}** |\n\n`;

    if (vulnerabilities.length === 0) {
      report += 'No vulnerabilities found!\n';
      return report;
    }

    // Group by severity
    const bySeverity = {
      critical: vulnerabilities.filter((v) => v.severity === 'critical'),
      high: vulnerabilities.filter((v) => v.severity === 'high'),
      moderate: vulnerabilities.filter((v) => v.severity === 'moderate'),
      low: vulnerabilities.filter((v) => v.severity === 'low'),
    };

    for (const [severity, vulns] of Object.entries(bySeverity)) {
      if (vulns.length === 0) continue;

      report += `## ${severity.toUpperCase()} (${vulns.length})\n\n`;

      for (const vuln of vulns) {
        report += `### ${vuln.name}\n\n`;
        report += `- **Title**: ${vuln.title}\n`;
        report += `- **Affected Versions**: ${vuln.range}\n`;
        report += `- **Fix Available**: ${vuln.fixAvailable ? 'Yes' : 'No'}\n`;
        if (vuln.url) {
          report += `- **More Info**: ${vuln.url}\n`;
        }
        report += '\n';
      }
    }

    return report;
  }

  /**
   * Main execution flow
   */
  async run(): Promise<boolean> {
    try {
      const result = await this.runAudit();
      const report = this.generateReport(result);

      // Print report to console
      console.log(report);

      // Save report to file
      const reportDir = dirname(this.outputPath);
      if (!existsSync(reportDir)) {
        mkdirSync(reportDir, { recursive: true });
      }
      writeFileSync(this.outputPath, report);
      console.log(`Report saved to: ${this.outputPath}\n`);

      // Generate SARIF output if requested
      if (this.sarifOutput) {
        const sarifPath = join(reportDir, 'security-audit-results.sarif');
        const sarif = this.generateSarif(result);
        writeFileSync(sarifPath, sarif);
        console.log(`SARIF output saved to: ${sarifPath}\n`);
      }

      // Check if any vulnerabilities meet the threshold
      const criticalVulns = result.vulnerabilities.filter((v) => this.meetsThreshold(v.severity));

      if (criticalVulns.length > 0) {
        console.error(
          `Found ${criticalVulns.length} vulnerability(ies) at or above ${this.severityThreshold} severity`
        );

        if (this.autoFix && this.fixAttempts < this.maxFixAttempts) {
          this.fixAttempts++;
          const fixed = await this.attemptFix();
          if (fixed) {
            console.log('\nAuto-fix applied. Re-running audit...\n');
            return this.run();
          }
        }

        return false;
      }

      console.log('No vulnerabilities at or above threshold');
      return true;
    } catch (error) {
      console.error('Security scan failed:', error);
      return false;
    }
  }
}

// CLI interface — only run when executed directly
const isMainModule = process.argv[1] && process.argv[1].includes('security-scan');
if (isMainModule) {
  async function main() {
    const args = process.argv.slice(2);
    let severity: 'low' | 'moderate' | 'high' | 'critical' = 'high';
    let autoFix = false;
    let sarifOutput = false;
    let outputPath: string | undefined;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--severity' && args[i + 1]) {
        const level = args[i + 1] as 'low' | 'moderate' | 'high' | 'critical';
        if (['low', 'moderate', 'high', 'critical'].includes(level)) {
          severity = level;
        }
        i++;
      } else if (args[i] === '--fix') {
        autoFix = true;
      } else if (args[i] === '--sarif') {
        sarifOutput = true;
      } else if (args[i] === '--output' && args[i + 1]) {
        outputPath = args[i + 1];
        i++;
      }
    }

    const rootDir = process.cwd();
    const scanner = new SecurityScanner(rootDir, severity, autoFix, sarifOutput, outputPath);

    const success = await scanner.run();
    process.exit(success ? 0 : 1);
  }

  main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
