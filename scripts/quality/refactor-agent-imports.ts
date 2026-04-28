import { Project } from 'ts-morph';

const project = new Project({
  tsConfigFilePath: 'tsconfig.json',
});

// The mapping of exports from agent.ts to their original sources
const mapping = {
  UserRole: 'core/lib/types/common',
  Attachment: 'core/lib/types/llm',
  isValidAttachment: 'core/lib/types/llm',
  BaseEventPayload: 'core/lib/schema/events',
  TaskEventPayload: 'core/lib/schema/events',
  BuildEventPayload: 'core/lib/schema/events',
  CompletionEventPayload: 'core/lib/schema/events',
  OutboundMessageEventPayload: 'core/lib/schema/events',
  FailureEventPayload: 'core/lib/schema/events',
  HealthReportEventPayload: 'core/lib/schema/events',
  ProactiveHeartbeatPayloadInferred: 'core/lib/schema/events',
  BaseEvent: 'core/lib/schema/events',
  TaskEvent: 'core/lib/schema/events',
  BuildEvent: 'core/lib/schema/events',
  CompletionEvent: 'core/lib/schema/events',
  OutboundMessageEvent: 'core/lib/schema/events',
  FailureEvent: 'core/lib/schema/events',
  HealthReportEvent: 'core/lib/schema/events',
  ProactiveHeartbeatPayload: 'core/lib/schema/events',

  // From agent/index.ts -> constants
  AgentCategory: 'core/lib/types/agent/constants',
  SafetyTier: 'core/lib/types/agent/constants',
  ConnectionProfile: 'core/lib/types/agent/constants',

  // From agent/index.ts -> status
  EvolutionMode: 'core/lib/types/agent/status',
  AgentStatus: 'core/lib/types/agent/status',

  // From agent/index.ts -> config
  IAgentConfig: 'core/lib/types/agent/config',
  InstalledSkill: 'core/lib/types/agent/config',
  AgentSignal: 'core/lib/types/agent/config',

  // From agent/index.ts -> safety
  SafetyPolicy: 'core/lib/types/agent/safety',

  // From agent/index.ts -> events
  EventType: 'core/lib/types/agent/events',
};

// Also 'AgentTypes' might be imported as a namespace, but let's focus on named imports first.

const files = project.getSourceFiles();

let changedFiles = 0;

for (const file of files) {
  let changed = false;

  const imports = file.getImportDeclarations();
  for (const imp of imports) {
    const moduleSpecifier = imp.getModuleSpecifierValue();

    // Check if it's importing from core/lib/types/agent or similar
    if (
      moduleSpecifier.endsWith('/types/agent') ||
      moduleSpecifier === '../types/agent' ||
      moduleSpecifier === '../../types/agent' ||
      moduleSpecifier === '../../../types/agent'
    ) {
      const namedImports = imp.getNamedImports();
      if (namedImports.length > 0) {
        changed = true;

        // Group by destination
        const dests = {};
        for (const named of namedImports) {
          const name = named.getName();
          const dest = mapping[name] || 'core/lib/types/agent/index';

          if (!dests[dest]) dests[dest] = [];
          dests[dest].push(name);
        }

        // Remove original import
        imp.remove();

        // Add new imports
        for (const [dest, names] of Object.entries(dests)) {
          // Calculate relative path
          // We'll just rely on absolute paths or we can let TS compiler resolve? No we need relative paths.
          // Since it's too hard to calculate relative paths correctly for every file,
          // let's do a trick: we will use a naive approach for relative paths.

          // Actually, we can use project.createSourceFile and get relative path
          const sourceFileDir = file.getDirectoryPath();
          let relPath = project
            .getFileSystem()
            .getRelativePathForModuleSpecifier(sourceFileDir, dest);
          if (!relPath.startsWith('.')) relPath = './' + relPath;

          file.addImportDeclaration({
            moduleSpecifier: relPath,
            namedImports: names,
          });
        }
      }
    }
  }

  if (changed) {
    changedFiles++;
    file.saveSync();
  }
}

console.log(`Updated imports in ${changedFiles} files`);
