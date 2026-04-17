#!/usr/bin/env tsx
/**
 * Principles Verification Scanner
 *
 * Verifies that key architectural principles are properly implemented in the codebase.
 * This helps prevent recurring issues like race conditions and fail-open behavior.
 *
 * Principles checked:
 * - Principle 13: Atomic State Integrity (conditional updates)
 * - Principle 14: Selection Integrity (enabled check before selection)
 * - Principle 15: Monotonic Progress Guards (atomic increment)
 *
 * Usage:
 *   npx tsx scripts/quality/verify-principles.ts [--verbose]
 */

import { readFileSync, globSync } from 'fs';
import { join, relative } from 'path';

interface Finding {
  file: string;
  line: number;
  principle: string;
  issue: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
}

const CORE_DIR = join(process.cwd(), 'core');

function verifyFailClosed(): Finding[] {
  const findings: Finding[] = [];
  const stateFiles = globSync(`${CORE_DIR}/**/distributed-state.ts`);

  stateFiles.forEach((file) => {
    if (file.includes('.test.') || file.includes('.d.ts')) return;
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      if (
        line.includes('rateLimit') &&
        line.includes('return true') &&
        !line.includes('return false')
      ) {
        findings.push({
          file: relative(process.cwd(), file),
          line: idx + 1,
          principle: 'Principle 13',
          issue: 'Fail-open rate limiting - MUST return false on DynamoDB failure',
          severity: 'P1',
        });
      }
    });
  });

  return findings;
}

function verifySelectionIntegrity(): Finding[] {
  const findings: Finding[] = [];
  const routerFiles = globSync(`${CORE_DIR}/**/routing/AgentRouter*.ts`);

  routerFiles.forEach((file) => {
    if (file.includes('.test.') || file.includes('.d.ts')) return;
    const content = readFileSync(file, 'utf-8');

    if ((content.includes('route') || content.includes('select')) && !content.includes('enabled')) {
      findings.push({
        file: relative(process.cwd(), file),
        line: 1,
        principle: 'Principle 14',
        issue: 'Missing enabled check in router - MUST verify enabled === true before selection',
        severity: 'P1',
      });
    }
  });

  return findings;
}

function verifyMonotonicProgress(): Finding[] {
  const findings: Finding[] = [];
  const recursionFiles = globSync(`${CORE_DIR}/**/recursion*.ts`);

  recursionFiles.forEach((file) => {
    if (file.includes('.test.') || file.includes('.d.ts')) return;
    const content = readFileSync(file, 'utf-8');

    if (content.includes('depth') || content.includes('recursion')) {
      if (content.includes('++') || content.includes('+= 1')) {
        findings.push({
          file: relative(process.cwd(), file),
          line: 1,
          principle: 'Principle 15',
          issue: 'Non-atomic increment - MUST use if_not_exists + 1 for monotonic progress',
          severity: 'P1',
        });
      }
    }
  });

  return findings;
}

function verifyAtomicUpdates(): Finding[] {
  const findings: Finding[] = [];
  const files = globSync(`${CORE_DIR}/lib/**/*.ts`);

  files.forEach((file) => {
    if (file.includes('.test.') || file.includes('.d.ts')) return;
    const content = readFileSync(file, 'utf-8');

    if (content.includes('Table.put') || content.includes('Table.update')) {
      if (!content.includes('conditionExpression') && !content.includes('atomicUpdate')) {
        findings.push({
          file: relative(process.cwd(), file),
          line: 1,
          principle: 'Principle 13',
          issue: 'Missing conditional update - use atomicUpdateMapField',
          severity: 'P2',
        });
      }
    }
  });

  return findings;
}

async function main() {
  const verbose = process.argv.includes('--verbose');

  console.log('\n🔍 Principles Verification\n');
  console.log('Checking key principles for proper implementation...\n');

  const allFindings: Finding[] = [
    ...verifyFailClosed(),
    ...verifySelectionIntegrity(),
    ...verifyMonotonicProgress(),
    ...verifyAtomicUpdates(),
  ];

  if (verbose || allFindings.length > 0) {
    console.log(`\n📊 Found ${allFindings.length} potential issues:\n`);

    const byPrinciple = new Map<string, Finding[]>();
    allFindings.forEach((f) => {
      const key = f.principle;
      if (!byPrinciple.has(key)) byPrinciple.set(key, []);
      byPrinciple.get(key)!.push(f);
    });

    byPrinciple.forEach((findings, principle) => {
      console.log(`\n### ${principle} (${findings.length} findings)`);
      findings.forEach((f) => {
        console.log(`  ${f.file}:${f.line} [${f.severity}]`);
        console.log(`    ${f.issue}`);
      });
    });
  } else {
    console.log('\n✅ All principles verified successfully!\n');
  }

  const p0Count = allFindings.filter((f) => f.severity === 'P0').length;
  const p1Count = allFindings.filter((f) => f.severity === 'P1').length;

  if (p0Count > 0) {
    console.log(`\n❌ BLOCKING: ${p0Count} P0 issues found\n`);
    process.exit(1);
  }

  if (p1Count > 0) {
    console.log(`\n⚠️  WARNING: ${p1Count} P1 issues found - should fix in current sprint\n`);
  }

  process.exit(p0Count > 0 ? 1 : 0);
}

main().catch(console.error);
