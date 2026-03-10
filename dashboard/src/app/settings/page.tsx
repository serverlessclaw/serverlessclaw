import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Settings, Save, RefreshCw, AlertTriangle, Zap } from 'lucide-react';
import { revalidatePath } from 'next/cache';

async function getConfig() {
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);
    
    const [providerRes, modelRes] = await Promise.all([
        docClient.send(new GetCommand({ TableName: (Resource as any).ConfigTable.name, Key: { key: 'active_provider' } })),
        docClient.send(new GetCommand({ TableName: (Resource as any).ConfigTable.name, Key: { key: 'active_model' } }))
    ]);

    return {
        provider: providerRes.Item?.value || 'openai',
        model: modelRes.Item?.value || 'gpt-5.4'
    };
}

async function updateConfig(formData: FormData) {
    'use server';
    const provider = formData.get('provider') as string;
    const model = formData.get('model') as string;

    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    await Promise.all([
        docClient.send(new PutCommand({ 
            TableName: (Resource as any).ConfigTable.name, 
            Item: { key: 'active_provider', value: provider } 
        })),
        docClient.send(new PutCommand({ 
            TableName: (Resource as any).ConfigTable.name, 
            Item: { key: 'active_model', value: model } 
        }))
    ]);

    revalidatePath('/settings');
}

export default async function SettingsPage() {
    const config = await getConfig();

    return (
        <main className="flex-1 overflow-y-auto p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
            <header className="flex justify-between items-end border-b border-white/5 pb-6">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight glow-text">SYSTEM_CONFIG</h2>
                    <p className="text-white/40 text-sm mt-2 font-light">Hot-swappable neural architecture and provider routing.</p>
                </div>
            </header>

            <div className="max-w-2xl">
                <form action={updateConfig} className="glass-card p-8 space-y-8 cyber-border">
                    <div className="space-y-4">
                        <h3 className="text-sm font-bold flex items-center gap-2 text-cyber-blue">
                            <Settings size={16} /> LLM_PROVIDER_ROUTING
                        </h3>
                        
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase text-white/40 tracking-widest font-bold">Active Provider</label>
                                <select 
                                    name="provider" 
                                    defaultValue={config.provider}
                                    className="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-cyber-blue transition-colors"
                                >
                                    <option value="openai">OpenAI (Native)</option>
                                    <option value="bedrock">AWS Bedrock (Native)</option>
                                    <option value="openrouter">OpenRouter (Aggregator)</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase text-white/40 tracking-widest font-bold">Default Model ID</label>
                                <input 
                                    name="model"
                                    type="text"
                                    defaultValue={config.model}
                                    placeholder="e.g. gpt-5.4"
                                    className="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-cyber-blue transition-colors"
                                />
                            </div>
                        </div>
                        <p className="text-[10px] text-white/30 italic">
                            * Changes are applied instantly via ConfigTable. No redeploy required.
                        </p>
                    </div>

                    <div className="pt-4 border-t border-white/5 flex justify-end">
                        <button 
                            type="submit"
                            className="bg-cyber-blue text-black px-4 py-2 rounded text-xs font-bold flex items-center gap-2 hover:scale-105 transition-transform cursor-pointer shadow-[0_0_15px_rgba(0,243,255,0.3)]"
                        >
                            <Save size={14} /> COMMIT_HOT_CONFIG
                        </button>
                    </div>
                </form>

                <div className="mt-10 glass-card p-8 space-y-6 border-red-900/20">
                    <h3 className="text-sm font-bold flex items-center gap-2 text-red-500">
                        <AlertTriangle size={16} /> DANGER_ZONE
                    </h3>
                    <div className="flex justify-between items-center bg-red-950/20 p-4 rounded border border-red-900/30">
                        <div>
                            <div className="text-xs font-bold text-white/90">FORCE_INFRA_REBUILD</div>
                            <div className="text-[10px] text-white/40 mt-1">Triggers a full SST deploy via CodeBuild. Use only if sst.config.ts changed.</div>
                        </div>
                        <button className="bg-red-900/40 hover:bg-red-900/60 text-red-200 px-4 py-2 rounded text-[10px] font-bold transition-colors border border-red-800/50">
                            TRIGGER_REBUILD
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}
