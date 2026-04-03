#!/usr/bin/env tsx
/**
 * Coverage Trend Tracker
 *
 * Tracks code coverage over time and detects regressions.
 * Generates a coverage report and optionally fails CI if coverage drops.
 *
 * Usage:
 *   tsx scripts/quality/coverage-trend.ts [--threshold <percent>] [--baseline <file>]
 *
 * Options:
 *   --threshold <percent>  Fail if coverage drops by more than this percent (default: 5)
 *   --baseline <file>      Path to baseline coverage file (default: .coverage-baseline.json)
 *   --update-baseline      Update the baseline with current coverage
 *   --output <file>        Output report file (default: coverage-trend-report.md)
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

interface CoverageSummary {
  lines: { pct: number };
  functions: { pct: number };
  statements: { pct: number };
  branches: { pct: number };
}

interface CoverageTrend {
  timestamp: string;
  commit?: string;
  lines: number;
  functions: number;
  statements: number;
  branches: number;
}

interface CoverageBaseline {
  history: CoverageTrend[];
  latest: CoverageTrend;
}

function parseArgs(): {
  threshold: number;
  baselineFile: string;
  updateBaseline: boolean;
  outputFile: string;
} {
  const args = process.argv.slice(2);
  let threshold = 5;
  let baselineFile = '.coverage-baseline.json';
  let updateBaseline = false;
  let outputFile = 'coverage-trend-report.md';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--threshold':
        threshold = parseFloat(args[++i]);
        break;
      case '--baseline':
        baselineFile = args[++i];
        break;
      case '--update-baseline':
        updateBaseline = true;
        break;
      case '--output':
        outputFile = args[++i];
        break;
    }
  }

  return { threshold, baselineFile, updateBaseline, outputFile };
}

function getGitCommit(): string | undefined {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return undefined;
  }
}

function getCoverageSummary(): CoverageSummary {
  // Run vitest with coverage and parse the JSON output
  try {
    execSync('pnpm exec vitest run --coverage --reporter=json --outputFile=.coverage-output.json', {
      stdio: 'pipe',
    });
  } catch {
    console.error('Failed to run coverage. Make sure vitest is configured with coverage.');
    process.exit(1);
  }

  // Parse the coverage summary from the JSON output
  const coverageJsonPath = join(process.cwd(), '.coverage-output.json');
  if (!existsSync(coverageJsonPath)) {
    console.error('Coverage output file not found. Check vitest configuration.');
    process.exit(1);
  }

  const coverageData = JSON.parse(readFileSync(coverageJsonPath, 'utf-8'));

  // Extract summary from vitest JSON output
  const summary = coverageData.coverage?.summary || coverageData.coverage;

  if (!summary) {
    console.error('Could not parse coverage summary from output.');
    process.exit(1);
  }

  return {
    lines: { pct: summary.lines?.pct || summary.lines?.total?.pct || 0 },
    functions: { pct: summary.functions?.pct || summary.functions?.total?.pct || 0 },
    statements: { pct: summary.statements?.pct || summary.statements?.total?.pct || 0 },
    branches: { pct: summary.branches?.pct || summary.branches?.total?.pct || 0 },
  };
}

function loadBaseline(baselineFile: string): CoverageBaseline {
  const baselinePath = join(process.cwd(), baselineFile);
  if (existsSync(baselinePath)) {
    return JSON.parse(readFileSync(baselinePath, 'utf-8'));
  }
  return {
    history: [],
    latest: { timestamp: '', lines: 0, functions: 0, statements: 0, branches: 0 },
  };
}

function saveBaseline(baseline: CoverageBaseline, baselineFile: string): void {
  const baselinePath = join(process.cwd(), baselineFile);
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
}

function generateReport(
  current: CoverageSummary,
  baseline: CoverageBaseline,
  threshold: number,
  _outputFile: string
): { passed: boolean; report: string } {
  const latest = baseline.latest;
  const linesDelta = current.lines.pct - latest.lines;
  const functionsDelta = current.functions.pct - latest.functions;
  const statementsDelta = current.statements.pct - latest.statements;
  const branchesDelta = current.branches.pct - latest.branches;

  const maxDrop = Math.max(-linesDelta, -functionsDelta, -statementsDelta, -branchesDelta);

  const passed = maxDrop <= threshold;

  const emoji = (delta: number) => {
    if (delta > 0) return '📈';
    if (delta < 0) return '📉';
    return '➡️';
  };

  const formatDelta = (delta: number) => {
    if (delta > 0) return `+${delta.toFixed(2)}%`;
    if (delta < 0) return `${delta.toFixed(2)}%`;
    return '0.00%';
  };

  const report = `# Coverage Trend Report

## Current Coverage

| Metric      | Coverage | Delta vs Baseline |
|-------------|----------|-------------------|
| Lines       | ${current.lines.pct.toFixed(2)}% | ${emoji(linesDelta)} ${formatDelta(linesDelta)} |
| Functions   | ${current.functions.pct.toFixed(2)}% | ${emoji(functionsDelta)} ${formatDelta(functionsDelta)} |
| Statements  | ${current.statements.pct.toFixed(2)}% | ${emoji(statementsDelta)} ${formatDelta(statementsDelta)} |
| Branches    | ${current.branches.pct.toFixed(2)}% | ${emoji(branchesDelta)} ${formatDelta(branchesDelta)} |

## Threshold Check

- **Max Drop**: ${maxDrop.toFixed(2)}%
- **Threshold**: ${threshold}%
- **Status**: ${passed ? '✅ PASSED' : '❌ FAILED'}

${!passed ? `\n⚠️ **Coverage regression detected!** Coverage dropped by ${maxDrop.toFixed(2)}%, which exceeds the ${threshold}% threshold.\n` : ''}

## History (Last 10 entries)

| Date | Commit | Lines | Functions | Statements | Branches |
|------|--------|-------|-----------|------------|----------|
${baseline.history
  .slice(-10)
  .reverse()
  .map(
    (h) =>
      `| ${h.timestamp.split('T')[0]} | ${h.commit || 'N/A'} | ${h.lines.toFixed(2)}% | ${h.functions.toFixed(2)}% | ${h.statements.toFixed(2)}% | ${h.branches.toFixed(2)}% |`
  )
  .join('\n')}
`;

  return { passed, report };
}

function main(): void {
  const { threshold, baselineFile, updateBaseline, outputFile } = parseArgs();

  console.log('📊 Running coverage analysis...');

  const current = getCoverageSummary();
  const baseline = loadBaseline(baselineFile);

  console.log(`  Lines:      ${current.lines.pct.toFixed(2)}%`);
  console.log(`  Functions:  ${current.functions.pct.toFixed(2)}%`);
  console.log(`  Statements: ${current.statements.pct.toFixed(2)}%`);
  console.log(`  Branches:   ${current.branches.pct.toFixed(2)}%`);

  const { passed, report } = generateReport(current, baseline, threshold, outputFile);

  // Write report
  const reportPath = join(process.cwd(), outputFile);
  writeFileSync(reportPath, report);
  console.log(`\n📝 Report written to: ${outputFile}`);

  // Update baseline if requested
  if (updateBaseline) {
    const newEntry: CoverageTrend = {
      timestamp: new Date().toISOString(),
      commit: getGitCommit(),
      lines: current.lines.pct,
      functions: current.functions.pct,
      statements: current.statements.pct,
      branches: current.branches.pct,
    };

    baseline.history.push(newEntry);
    // Keep last 100 entries
    if (baseline.history.length > 100) {
      baseline.history = baseline.history.slice(-100);
    }
    baseline.latest = newEntry;

    saveBaseline(baseline, baselineFile);
    console.log(`✅ Baseline updated: ${baselineFile}`);
  }

  // Exit with error if coverage dropped
  if (!passed) {
    console.error(`\n❌ Coverage regression detected! Max drop: ${threshold}%`);
    process.exit(1);
  }

  console.log('\n✅ Coverage check passed!');
}

main();
