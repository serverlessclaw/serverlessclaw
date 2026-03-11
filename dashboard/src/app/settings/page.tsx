import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Settings, Save, RefreshCw, AlertTriangle, Zap } from 'lucide-react';
import { revalidatePath } from 'next/cache';
import AgentsManager from './AgentsManager';

async function getConfig() {
  try {
    const tableName = (Resource as any).ConfigTable?.name;
    if (!tableName) {
      console.error('ConfigTable name is missing from Resources');
      return {
        provider: 'unknown',
        model: 'unknown',
        evolutionMode: 'unknown',
        optimizationPolicy: 'unknown',
      };
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    const [providerRes, modelRes, modeRes, policyRes, reflectRes, reviewRes, minGapsRes] =
      await Promise.all([
        docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { key: 'active_provider' },
          })
        ),
        docClient.send(new GetCommand({ TableName: tableName, Key: { key: 'active_model' } })),
        docClient.send(new GetCommand({ TableName: tableName, Key: { key: 'evolution_mode' } })),
        docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { key: 'optimization_policy' },
          })
        ),
        docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { key: 'reflection_frequency' },
          })
        ),
        docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { key: 'strategic_review_frequency' },
          })
        ),
        docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { key: 'min_gaps_for_review' },
          })
        ),
      ]);

    return {
      provider: providerRes.Item?.value || 'openai',
      model: modelRes.Item?.value || 'gpt-5.4',
      evolutionMode: modeRes.Item?.value || 'hitl',
      optimizationPolicy: policyRes.Item?.value || 'balanced',
      reflectionFrequency: reflectRes.Item?.value || '3',
      strategicReviewFrequency: reviewRes.Item?.value || '12',
      minGapsForReview: minGapsRes.Item?.value || '3',
    };
  } catch (e) {
    console.error('Error fetching settings config:', e);
    return {
      provider: 'error',
      model: 'error',
      evolutionMode: 'error',
      optimizationPolicy: 'error',
      reflectionFrequency: '3',
      strategicReviewFrequency: '12',
      minGapsForReview: '3',
    };
  }
}

async function updateConfig(formData: FormData) {
  'use server';
  const provider = formData.get('provider') as string;
  const model = formData.get('model') as string;
  const evolutionMode = formData.get('evolutionMode') as string;
  const optimizationPolicy = formData.get('optimizationPolicy') as string;
  const reflectionFrequency = formData.get('reflectionFrequency') as string;
  const strategicReviewFrequency = formData.get('strategicReviewFrequency') as string;
  const minGapsForReview = formData.get('minGapsForReview') as string;

  try {
    const tableName = (Resource as any).ConfigTable?.name;
    if (!tableName) {
      throw new Error('ConfigTable name is missing from Resources');
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    await Promise.all([
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { key: 'active_provider', value: provider },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { key: 'active_model', value: model },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { key: 'evolution_mode', value: evolutionMode },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { key: 'optimization_policy', value: optimizationPolicy },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { key: 'reflection_frequency', value: reflectionFrequency },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: 'strategic_review_frequency',
            value: strategicReviewFrequency,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: 'min_gaps_for_review',
            value: minGapsForReview,
          },
        })
      ),
    ]);

    revalidatePath('/settings');
  } catch (e) {
    console.error('Error updating settings config:', e);
  }
}

export default async function SettingsPage() {
  const config = await getConfig();

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent">
      <header className="flex justify-between items-end border-b border-white/5 pb-6">
        <div>
          <h2 className="text-2xl lg:text-3xl font-bold tracking-tight glow-text uppercase">
            SYSTEM_CONFIG
          </h2>
          <p className="text-white/100 text-xs lg:text-sm mt-2 font-light">
            Hot-swappable neural architecture and provider routing.
          </p>
        </div>
      </header>

      <div className="max-w-4xl space-y-10">
        <form action={updateConfig} className="glass-card p-6 lg:p-8 space-y-8 cyber-border">
          <div className="space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2 text-cyber-blue uppercase tracking-wider">
              <Settings size={16} /> LLM_PROVIDER_ROUTING
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                  Active Provider
                </label>
                <select
                  name="provider"
                  defaultValue={config.provider}
                  className="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-cyber-blue transition-colors cursor-pointer"
                >
                  <option value="openai">OpenAI (Native)</option>
                  <option value="bedrock">AWS Bedrock (Native)</option>
                  <option value="openrouter">OpenRouter (Aggregator)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                  Default Model ID
                </label>
                <input
                  name="model"
                  type="text"
                  defaultValue={config.model}
                  placeholder="e.g. gpt-5.4"
                  className="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-cyber-blue transition-colors font-mono"
                />
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2 text-cyber-green uppercase tracking-wider">
              <Zap size={16} /> EVOLUTION_ENGINE_CONTROL
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                  Evolution Mode
                </label>
                <select
                  name="evolutionMode"
                  defaultValue={config.evolutionMode}
                  className="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-cyber-green transition-colors cursor-pointer"
                >
                  <option value="hitl">Human-in-the-Loop (Safe)</option>
                  <option value="auto">Fully Autonomous (Live)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                  Optimization Policy
                </label>
                <select
                  name="optimizationPolicy"
                  defaultValue={config.optimizationPolicy}
                  className="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-cyber-green transition-colors cursor-pointer"
                >
                  <option value="aggressive">Aggressive (Velocity)</option>
                  <option value="balanced">Balanced (Stability)</option>
                  <option value="conservative">Conservative (Safety)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2 text-purple-400 uppercase tracking-wider">
              <RefreshCw size={16} /> NEURAL_REFLECTION_CONFIG
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                  Reflection Frequency (msgs)
                </label>
                <input
                  name="reflectionFrequency"
                  type="number"
                  defaultValue={config.reflectionFrequency}
                  className="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-purple-400 transition-colors font-mono"
                />
                <p className="text-[9px] text-white/50 italic">
                  How many messages before triggering Reflector agent. 0 to disable.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                  Strategic Review Interval (hrs)
                </label>
                <input
                  name="strategicReviewFrequency"
                  type="number"
                  defaultValue={config.strategicReviewFrequency}
                  className="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-purple-400 transition-colors font-mono"
                />
                <p className="text-[9px] text-white/50 italic">
                  How often to aggregate all gaps and design evolution plans.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                  Min Gaps for Review
                </label>
                <input
                  name="minGapsForReview"
                  type="number"
                  defaultValue={config.minGapsForReview}
                  className="w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-purple-400 transition-colors font-mono"
                />
                <p className="text-[9px] text-white/50 italic">
                  Minimum number of OPEN gaps required to trigger a scheduled review.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/5 flex justify-end">
            <button
              type="submit"
              className="bg-cyber-blue text-black px-6 py-2.5 rounded text-xs font-bold flex items-center gap-2 hover:scale-105 transition-transform cursor-pointer shadow-[0_0_15px_rgba(0,243,255,0.3)] uppercase tracking-widest"
            >
              <Save size={14} /> COMMIT_SYSTEM_CHANGES
            </button>
          </div>
        </form>

        <AgentsManager />

        <div className="glass-card p-6 lg:p-8 space-y-6 border-red-900/20 bg-red-950/5">
          <h3 className="text-sm font-bold flex items-center gap-2 text-red-500 uppercase tracking-wider">
            <AlertTriangle size={16} /> DANGER_ZONE
          </h3>
          <div className="flex flex-col md:flex-row md:justify-between md:items-center bg-red-950/20 p-6 rounded border border-red-900/30 gap-4">
            <div>
              <div className="text-xs font-bold text-white/90 uppercase tracking-tight">
                FORCE_INFRA_REBUILD
              </div>
              <div className="text-[10px] text-white/100 mt-1 font-medium">
                Triggers a full SST deploy via CodeBuild. Use only if sst.config.ts changed.
              </div>
            </div>
            <button className="bg-red-900/40 hover:bg-red-900/60 text-red-200 px-5 py-2 rounded text-[10px] font-bold transition-colors border border-red-800/50 uppercase tracking-widest">
              TRIGGER_REBUILD
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
