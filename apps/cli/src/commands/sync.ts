import { execSync } from 'child_process';

export interface CLISyncOptions {
  hub: string;
  prefix: string;
  workingDir: string;
  method: 'subtree' | 'fork';
  check?: boolean;
  abortOnConflict?: boolean;
  json?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface SyncCheckResult {
  canSync: boolean;
  reachable: boolean;
  conflicts: string[];
  message: string;
}

export interface SyncResult {
  success: boolean;
  message: string;
  commitHash?: string;
  conflicts?: string[];
}

function log(msg: string, options: CLISyncOptions): void {
  if (options.verbose || !options.json) {
    console.log(`[Claw Sync] ${msg}`);
  }
}

function outputJson(data: unknown, options: CLISyncOptions): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function ensureRemote(cwd: string, name: string, url: string): void {
  try {
    execSync(`git remote add ${name} ${url}`, { cwd, stdio: 'ignore' });
  } catch {
    execSync(`git remote set-url ${name} ${url}`, { cwd, stdio: 'ignore' });
  }
}

function checkRemoteReachable(cwd: string, remote: string): boolean {
  try {
    execSync(`git ls-remote --exit-code ${remote} main`, { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkForConflicts(
  cwd: string,
  method: 'subtree' | 'fork',
  remote: string,
  prefix: string
): SyncCheckResult {
  const conflicts: string[] = [];

  try {
    if (method === 'fork') {
      execSync(`git fetch ${remote} main`, { cwd, stdio: 'ignore' });
      const mergeBase = execSync(`git merge-base HEAD ${remote}/main`, {
        cwd,
        encoding: 'utf-8',
      }).trim();

      const localChanges = execSync(`git diff --name-only ${mergeBase} HEAD`, {
        cwd,
        encoding: 'utf-8',
      }).trim();

      const remoteChanges = execSync(`git diff --name-only ${mergeBase} ${remote}/main`, {
        cwd,
        encoding: 'utf-8',
      }).trim();

      if (localChanges && remoteChanges) {
        const localFiles = localChanges.split('\n').filter(Boolean);
        const remoteFiles = remoteChanges.split('\n').filter(Boolean);
        const overlap = localFiles.filter((f) => remoteFiles.includes(f));
        if (overlap.length > 0) {
          conflicts.push(...overlap);
        }
      }
    } else {
      execSync(`git fetch ${remote} main`, { cwd, stdio: 'ignore' });
      const subtreeDiff = execSync(`git diff ${remote}/main...HEAD -- ${prefix}`, {
        cwd,
        encoding: 'utf-8',
      });
      if (subtreeDiff.trim()) {
        conflicts.push(`${prefix} has local modifications`);
      }
    }
  } catch (e: unknown) {
    return {
      canSync: false,
      reachable: true,
      conflicts: [],
      message: `Failed to check conflicts: ${(e as Error).message}`,
    };
  }

  return {
    canSync: conflicts.length === 0,
    reachable: true,
    conflicts,
    message:
      conflicts.length > 0
        ? `Conflict detected in: ${conflicts.join(', ')}`
        : 'Sync is safe to proceed',
  };
}

export async function runSync(options: CLISyncOptions): Promise<void> {
  const { hub, prefix, workingDir, method = 'subtree' } = options;
  const hubUrl = `https://github.com/${hub}.git`;
  const hubRemote = 'hub-origin';

  if (options.verbose) {
    log(`Starting sync with options: ${JSON.stringify(options)}`, options);
  }

  log(`Syncing ${workingDir} with Hub: ${hubUrl} using ${method} method...`, options);

  try {
    ensureRemote(workingDir, hubRemote, hubUrl);

    const reachable = checkRemoteReachable(workingDir, hubRemote);
    if (!reachable) {
      const result = {
        success: false,
        message: `Cannot reach remote: ${hubUrl}`,
      };
      log(result.message, options);
      outputJson(result, options);
      process.exit(1);
    }

    if (options.check) {
      const checkResult = checkForConflicts(workingDir, method, hubRemote, prefix);
      outputJson(checkResult, options);
      if (!checkResult.canSync) {
        process.exit(1);
      }
      return;
    }

    if (options.dryRun) {
      const checkResult = checkForConflicts(workingDir, method, hubRemote, prefix);
      const result = {
        success: checkResult.canSync,
        message: checkResult.canSync
          ? 'Dry run: sync would succeed'
          : `Dry run: conflicts detected - ${checkResult.conflicts.join(', ')}`,
        conflicts: checkResult.conflicts,
      };
      outputJson(result, options);
      if (!checkResult.canSync && options.abortOnConflict) {
        process.exit(1);
      }
      return;
    }

    log(`Fetching updates from ${hubRemote}...`, options);
    execSync(`git fetch ${hubRemote} main`, {
      cwd: workingDir,
      stdio: options.verbose ? 'inherit' : 'ignore',
    });

    let syncResult: SyncResult;

    if (method === 'fork') {
      log(`Merging changes from ${hubRemote}/main...`, options);
      try {
        execSync(
          `git merge ${hubRemote}/main -m "chore: sync with serverlessclaw hub via fork merge"`,
          {
            cwd: workingDir,
            stdio: options.verbose ? 'inherit' : 'pipe',
            env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no' },
          }
        );
        const commitHash = execSync('git rev-parse HEAD', {
          cwd: workingDir,
          encoding: 'utf-8',
        }).trim();
        syncResult = {
          success: true,
          message: 'Sync completed successfully',
          commitHash,
        };
      } catch (mergeError: unknown) {
        const errMsg = (mergeError as Error).message;
        if (options.abortOnConflict) {
          syncResult = {
            success: false,
            message: `Merge conflict detected. Aborting. Error: ${errMsg}`,
          };
          log(syncResult.message, options);
          outputJson(syncResult, options);
          execSync('git merge --abort', { cwd: workingDir, stdio: 'ignore' });
          process.exit(1);
        }
        syncResult = {
          success: false,
          message: `Merge conflict detected. Please resolve manually. Error: ${errMsg}`,
        };
      }
    } else {
      log(`Pulling subtree updates for prefix ${prefix}...`, options);
      try {
        execSync(
          `git subtree pull --prefix=${prefix} ${hubRemote} main --squash -m "chore: sync with serverlessclaw hub via subtree"`,
          {
            cwd: workingDir,
            stdio: options.verbose ? 'inherit' : 'pipe',
            env: { ...process.env, GIT_MERGE_AUTOEDIT: 'no' },
          }
        );
        const commitHash = execSync('git rev-parse HEAD', {
          cwd: workingDir,
          encoding: 'utf-8',
        }).trim();
        syncResult = {
          success: true,
          message: 'Sync completed successfully',
          commitHash,
        };
      } catch (error: unknown) {
        const errMsg = (error as Error).message;
        if (options.abortOnConflict) {
          syncResult = {
            success: false,
            message: `Subtree conflict detected. Aborting. Error: ${errMsg}`,
          };
          log(syncResult.message, options);
          outputJson(syncResult, options);
          process.exit(1);
        }
        syncResult = {
          success: false,
          message: `Conflict detected during subtree pull. Please resolve manually. Error: ${errMsg}`,
        };
      }
    }

    log(syncResult.message, options);
    outputJson(syncResult, options);

    if (!syncResult.success) {
      process.exit(1);
    }
  } catch (error: unknown) {
    const result = {
      success: false,
      message: `Failed: ${(error as Error).message}`,
    };
    log(result.message, options);
    outputJson(result, options);
    process.exit(1);
  }
}
