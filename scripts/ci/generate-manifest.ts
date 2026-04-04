#!/usr/bin/env tsx
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

const FailureEntrySchema = z.object({
  gate: z.string(),
  command: z.string(),
  exitCode: z.number(),
  logPath: z.string(),
  summary: z.string().optional(),
  errorType: z.enum(['lint', 'test', 'type-check', 'security', 'docs', 'deploy', 'unknown']),
  affectedPackages: z.array(z.string()),
  affectedFiles: z.array(z.string()),
  rawErrors: z.array(z.string()),
});

const FailureManifestSchema = z.object({
  timestamp: z.string(),
  buildId: z.string().optional(),
  commitHash: z.string(),
  triggeredBy: z.object({
    author: z.string(),
    message: z.string(),
    changedFiles: z.array(z.string()),
  }),
  failures: z.array(FailureEntrySchema),
  remediationAttempted: z.boolean(),
  remediationSuccess: z.boolean(),
  actionTaken: z.string().optional(),
  nextStep: z.enum(['retry', 'fix_requested', 'fail_hard']),
});

type FailureEntry = z.infer<typeof FailureEntrySchema>;
type FailureManifest = z.infer<typeof FailureManifestSchema>;

class ManifestGenerator {
  private logDir: string;
  private outputDir: string;

  constructor(logDir = '/tmp/ci-logs', outputDir = '.') {
    this.logDir = logDir;
    this.outputDir = outputDir;
  }

  private getGitInfo() {
    try {
      const author = execSync('git log -1 --format="%an <%ae>"', { encoding: 'utf-8' }).trim();
      const message = execSync('git log -1 --format="%s"', { encoding: 'utf-8' }).trim();
      const commitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      const changedFiles = execSync('git diff --name-only HEAD~1', { encoding: 'utf-8' })
        .split('\n')
        .filter(Boolean);
      return { author, message, commitHash, changedFiles };
    } catch {
      return {
        author: 'unknown',
        message: 'unknown',
        commitHash: process.env.CODEBUILD_RESOLVED_SOURCE_VERSION || 'unknown',
        changedFiles: [],
      };
    }
  }

  private parseLog(gate: string, logPath: string): FailureEntry | null {
    if (!existsSync(logPath)) return null;

    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');
    const rawErrors: string[] = [];
    const affectedPackages = new Set<string>();
    const affectedFiles = new Set<string>();

    // Basic heuristic for error extraction
    for (const line of lines) {
      if (line.includes('ERROR') || line.includes('FAIL') || line.includes('error:')) {
        rawErrors.push(line.trim());
      }
      // Turbo package detection: @project/package:task
      const turboMatch = line.match(/^(@[^/]+\/[^:]+):/);
      if (turboMatch) {
        affectedPackages.add(turboMatch[1]);
      }
      // File path detection (simple heuristic)
      const fileMatch = line.match(/([a-zA-Z0-9._/-]+\.(ts|tsx|js|jsx|md|json|yml|mk))/);
      if (fileMatch && !fileMatch[1].includes('node_modules')) {
        affectedFiles.add(fileMatch[1]);
      }
    }

    let errorType: FailureEntry['errorType'] = 'unknown';
    const lowerGate = gate.toLowerCase();
    if (lowerGate.includes('lint')) errorType = 'lint';
    else if (lowerGate.includes('test')) errorType = 'test';
    else if (lowerGate.includes('type-check')) errorType = 'type-check';
    else if (lowerGate.includes('security')) errorType = 'security';
    else if (lowerGate.includes('docs')) errorType = 'docs';
    else if (lowerGate.includes('deploy')) errorType = 'deploy';

    return {
      gate,
      command: `make ${gate}`,
      exitCode: 1,
      logPath,
      summary: rawErrors.length > 0 ? rawErrors[0] : 'Unknown error',
      errorType,
      affectedPackages: Array.from(affectedPackages),
      affectedFiles: Array.from(affectedFiles).filter((f) => existsSync(f)),
      rawErrors: rawErrors.slice(0, 10),
    };
  }

  generate() {
    const gitInfo = this.getGitInfo();
    const failures: FailureEntry[] = [];

    if (existsSync(this.logDir)) {
      const files = readdirSync(this.logDir);
      for (const file of files) {
        if (file.endsWith('.log')) {
          const gate = file.replace('.log', '');
          const entry = this.parseLog(gate, join(this.logDir, file));
          if (entry && entry.rawErrors.length > 0) {
            failures.push(entry);
          }
        }
      }
    }

    const manifest: FailureManifest = {
      timestamp: new Date().toISOString(),
      buildId: process.env.CODEBUILD_BUILD_ID,
      commitHash: gitInfo.commitHash,
      triggeredBy: {
        author: gitInfo.author,
        message: gitInfo.message,
        changedFiles: gitInfo.changedFiles,
      },
      failures,
      remediationAttempted: false, // We moved auto-fix to agent side
      remediationSuccess: false,
      nextStep: failures.length > 0 ? 'fix_requested' : 'fail_hard',
    };

    // Validate before saving
    FailureManifestSchema.parse(manifest);

    const outputPath = join(this.outputDir, 'failure-manifest.json');
    writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
    console.log(`Failure manifest generated at ${outputPath}`);
  }
}

const generator = new ManifestGenerator(process.argv[2] || '/tmp/ci-logs', process.argv[3] || '.');
generator.generate();
