import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Wrench, Shield, Zap, Cpu, Settings, Save, AlertCircle } from 'lucide-react';
import { tools } from '@/lib/tool-definitions';
import { revalidatePath } from 'next/cache';

const AGENT_TYPES = ['main', 'coder', 'planner', 'events'];

async function getAgentConfigs() {
  try {
    const tableName = (Resource as any).ConfigTable?.name;
    if (!tableName) {
      console.error('ConfigTable name is missing from Resources');
      return {};
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const { Items } = await docClient.send(
      new ScanCommand({
        TableName: tableName,
      })
    );
    
    const configs: Record<string, string[]> = {};
    AGENT_TYPES.forEach(agent => {
      const item = Items?.find(i => i.key === `${agent}_tools`);
      configs[agent] = item?.value || [];
    });
    
    return configs;
  } catch (e) {
    console.error('Error fetching agent configs:', e);
    return {};
  }
}

async function updateAgentTools(formData: FormData) {
  'use server';
  const agentId = formData.get('agentId') as string;
  const toolNames = formData.getAll('tools') as string[];

  try {
    const tableName = (Resource as any).ConfigTable?.name;
    if (!tableName) {
      throw new Error('ConfigTable name is missing from Resources');
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        key: `${agentId}_tools`,
        value: toolNames
      }
    }));

    revalidatePath('/capabilities');
  } catch (e) {
    console.error('Error updating agent tools:', e);
  }
}

export default async function CapabilitiesPage() {
  const agentConfigs = await getAgentConfigs();
  const allTools = Object.values(tools);

  return (
    <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-yellow-500/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight glow-text-yellow">CAPABILITIES_ROSTER</h2>
          <p className="text-white/100 text-sm mt-2 font-light">Real-time management of agent toolsets and autonomous permissions.</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {AGENT_TYPES.map(agent => (
          <form key={agent} action={updateAgentTools} className="glass-card p-6 space-y-6 cyber-border border-yellow-500/10">
            <input type="hidden" name="agentId" value={agent} />
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold flex items-center gap-2 text-yellow-500 uppercase tracking-widest">
                {agent === 'main' ? <Zap size={16} /> : agent === 'coder' ? <Cpu size={16} /> : <Settings size={16} />}
                {agent}_AGENT
              </h3>
              <button 
                type="submit"
                className="text-[10px] font-bold px-2 py-1 rounded bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30 transition-colors flex items-center gap-1.5 border border-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.2)]"
              >
                <Save size={12} /> SYNC_ROSTER
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {allTools.map(tool => {
                const isEnabled = agentConfigs[agent].includes(tool.name);
                return (
                  <label 
                    key={tool.name} 
                    className={`flex items-start gap-3 p-3 rounded border transition-all cursor-pointer group ${
                      isEnabled 
                        ? 'bg-yellow-500/5 border-yellow-500/20 text-white' 
                        : 'bg-white/[0.02] border-white/5 text-white/100 opacity-60 grayscale hover:grayscale-0 hover:opacity-100'
                    }`}
                  >
                    <input 
                      type="checkbox" 
                      name="tools" 
                      value={tool.name} 
                      defaultChecked={isEnabled}
                      className="mt-1 accent-yellow-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={`text-[11px] font-bold uppercase tracking-tight ${isEnabled ? 'text-yellow-500' : ''}`}>
                          {tool.name}
                        </span>
                        {tool.name === 'fileWrite' && <Shield size={10} className="text-red-500/60" />}
                      </div>
                      <p className="text-[10px] leading-tight truncate">
                        {tool.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </form>
        ))}
      </div>

      <div className="glass-card p-6 border-white/5 text-white/100 flex items-center gap-4">
        <AlertCircle size={20} className="text-yellow-500/60 shrink-0" />
        <p className="text-xs italic leading-relaxed">
          [SYSTEM_ADVISORY]: Toggling tools takes effect immediately on the next agent turn. Removing core tools like 
          <span className="text-white/100 mx-1 font-mono">dispatchTask</span> from the Main agent or 
          <span className="text-white/100 mx-1 font-mono">fileWrite</span> from the Coder may cause severe system degradation.
        </p>
      </div>
    </main>
  );
}
