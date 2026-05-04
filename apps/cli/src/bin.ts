import { Command } from 'commander';
import { runSync } from './commands/sync';

const program = new Command();

program
  .name('claw-sync')
  .description('Sync your repository with the ServerlessClaw Mother Hub')
  .requiredOption('--hub <owner/repo>', 'Hub repository in format owner/repo')
  .option('--prefix <path>', 'Subtree prefix (e.g., core/)', 'core/')
  .option('--method <method>', 'Sync method: fork or subtree', 'subtree')
  .option('--working-dir <path>', 'Working directory', process.cwd())
  .option('--check', 'Check if sync is feasible without making changes')
  .option('--abort-on-conflict', 'Abort immediately if conflicts detected')
  .option('--json', 'Output results as JSON')
  .option('--dry-run', 'Validate sync without making changes')
  .option('--verbose', 'Verbose output')
  .parse(process.argv);

const options = program.opts();

runSync({
  hub: options.hub,
  prefix: options.prefix,
  method: options.method,
  workingDir: options.workingDir,
  check: options.check,
  abortOnConflict: options.abortOnConflict,
  json: options.json,
  dryRun: options.dryRun,
  verbose: options.verbose,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
