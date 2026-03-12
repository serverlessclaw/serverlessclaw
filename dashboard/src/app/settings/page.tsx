import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AlertTriangle } from 'lucide-react';
import { revalidatePath } from 'next/cache';
import SettingsForm from './SettingsForm';

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

    const [
      providerRes,
      modelRes,
      modeRes,
      policyRes,
      reflectRes,
      reviewRes,
      minGapsRes,
      maxIterRes,
      cbThresholdRes,
      cbFailuresRes,
      protectedRes,
      recursionRes,
    ] = await Promise.all([
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
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: 'max_tool_iterations' },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: 'circuit_breaker_threshold' },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: 'consecutive_build_failures' },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: 'protected_resources' },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: 'recursion_limit' },
        })
      ),
    ]);

    return {
      provider: providerRes.Item?.value || 'openai',
      model: modelRes.Item?.value || 'gpt-5.4',
      evolutionMode: modeRes.Item?.value || 'hitl',
      optimizationPolicy: policyRes.Item?.value || 'balanced',
      reflectionFrequency: reflectRes.Item?.value || '10',
      strategicReviewFrequency: reviewRes.Item?.value || '24',
      minGapsForReview: minGapsRes.Item?.value || '10',
      maxToolIterations: maxIterRes.Item?.value || '15',
      circuitBreakerThreshold: cbThresholdRes.Item?.value || '5',
      recursionLimit: recursionRes.Item?.value || '50',
      consecutiveBuildFailures: cbFailuresRes.Item?.value || 0,
      protectedResources: Array.isArray(protectedRes.Item?.value)
        ? protectedRes.Item.value.join(', ')
        : 'sst.config.ts, buildspec.yml, infra/',
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
      maxToolIterations: '15',
      circuitBreakerThreshold: '5',
      recursionLimit: '50',
      consecutiveBuildFailures: 0,
      protectedResources: 'sst.config.ts, buildspec.yml, infra/',
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
  const maxToolIterations = formData.get('maxToolIterations') as string;
  const circuitBreakerThreshold = formData.get('circuitBreakerThreshold') as string;
  const recursionLimit = formData.get('recursionLimit') as string;
  const protectedResources = (formData.get('protectedResources') as string)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

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
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: 'max_tool_iterations',
            value: maxToolIterations,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: 'circuit_breaker_threshold',
            value: circuitBreakerThreshold,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: 'recursion_limit',
            value: recursionLimit,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: 'protected_resources',
            value: protectedResources,
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
            CONFIG
          </h2>
          <p className="text-white/100 text-xs lg:text-sm mt-2 font-light">
            Hot-swappable neural architecture and provider routing.
          </p>
        </div>
      </header>

      <div className="max-w-4xl space-y-10">
        <SettingsForm config={config} updateConfig={updateConfig} />

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
