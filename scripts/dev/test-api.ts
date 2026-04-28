import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function testChatWithFile() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: pnpm ts-node scripts/test-api.ts <path-to-file>');
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error('File not found: ' + absolutePath);
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(absolutePath);
  const base64 = fileBuffer.toString('base64');
  const fileName = path.basename(absolutePath);
  const mimeType = getMimeType(fileName);

  // Use absolute paths to import backend logic from core
  const { DynamoMemory } = await import('../core/lib/memory.ts');
  const { ProviderManager } = await import('../core/lib/providers/index.ts');
  const { getAgentTools } = await import('../core/tools/index.ts');
  const { Agent } = await import('../core/lib/agent.ts');
  const { SUPERCLAW_SYSTEM_PROMPT } = await import('../core/agents/superclaw/constants.ts');
  const { TraceSource } = await import('../core/lib/types/index.ts');

  const sessionId = 'test-session-' + Date.now();
  const storageId = 'CONV#dashboard-user#' + sessionId;

  const memory = new DynamoMemory();
  const provider = new ProviderManager();
  const agentTools = await getAgentTools('superclaw');
  const agent = new Agent(memory, provider, agentTools, SUPERCLAW_SYSTEM_PROMPT);

  console.log('[Test] Processing: ' + fileName + ' (' + base64.length + ' bytes base64)');

  try {
    const { responseText } = await agent.process(storageId, 'Please analyze this file briefly.', {
      sessionId,
      source: TraceSource.DASHBOARD,
      attachments: [
        {
          type: 'file',
          name: fileName,
          base64: base64,
          mimeType: mimeType,
        },
      ],
    });

    console.log('\n--- AGENT RESPONSE ---');
    console.log(responseText);
    console.log('----------------------\n');
  } catch (error) {
    console.error('[Error] Processing failed:', error);
  }
}

testChatWithFile().catch(console.error);
