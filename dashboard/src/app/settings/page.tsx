import { getResourceName } from '@/lib/sst-utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { revalidatePath } from 'next/cache';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import SettingsForm from './SettingsForm';
import DeploySyncStatus from '@/components/DeploySyncStatus';
import { SYSTEM } from '@claw/core/lib/constants';
import { EvolutionMode } from '@claw/core/lib/types/agent';
import SettingsClient from './SettingsClient';
import PageHeader from '@/components/PageHeader';
import { logger } from '@claw/core/lib/logger';

async function getConfig() {
  try {
    const tableName = getResourceName('ConfigTable');
    if (!tableName) {
      logger.error('ConfigTable name is missing from Resources');
      return {
        provider: SYSTEM.DEFAULT_PROVIDER,
        model: SYSTEM.DEFAULT_MODEL,
        evolutionMode: EvolutionMode.HITL,
        optimizationPolicy: 'balanced',
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
      deployRes,
      escalationRes,
      fallbackRes,
      localeRes,
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
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: 'deploy_limit' },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: 'escalation_enabled' },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: 'protocol_fallback_enabled' },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: 'active_locale' },
        })
      ),
    ]);

    return {
      provider: providerRes.Item?.value ?? SYSTEM.DEFAULT_PROVIDER,
      model: modelRes.Item?.value ?? SYSTEM.DEFAULT_MODEL,
      evolutionMode: modeRes.Item?.value ?? EvolutionMode.HITL,
      optimizationPolicy: policyRes.Item?.value ?? 'balanced',
      reflectionFrequency: reflectRes.Item?.value ?? '10',
      strategicReviewFrequency: reviewRes.Item?.value ?? '24',
      minGapsForReview: minGapsRes.Item?.value ?? '10',
      maxToolIterations: maxIterRes.Item?.value ?? '15',
      circuitBreakerThreshold: cbThresholdRes.Item?.value ?? '5',
      recursionLimit: recursionRes.Item?.value ?? '50',
      deployLimit: deployRes.Item?.value ?? '5',
      escalationEnabled: escalationRes.Item?.value ?? 'true',
      protocolFallbackEnabled: fallbackRes.Item?.value ?? 'true',
      consecutiveBuildFailures: cbFailuresRes.Item?.value ?? 0,
      activeLocale: localeRes.Item?.value ?? 'en',
      protectedResources: Array.isArray(protectedRes.Item?.value)
        ? protectedRes.Item.value.join(', ')
        : 'sst.config.ts, buildspec.yml, infra/',
    };
  } catch (e) {
    logger.error('Error fetching settings config:', e);
    return {
      provider: SYSTEM.DEFAULT_PROVIDER,
      model: SYSTEM.DEFAULT_MODEL,
      evolutionMode: EvolutionMode.HITL,
      optimizationPolicy: 'balanced',
      reflectionFrequency: '3',
      strategicReviewFrequency: '12',
      minGapsForReview: '3',
      maxToolIterations: '15',
      circuitBreakerThreshold: '5',
      recursionLimit: '50',
      escalationEnabled: 'true',
      protocolFallbackEnabled: 'true',
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
  const deployLimit = formData.get('deployLimit') as string;
  const escalationEnabled = formData.get('escalationEnabled') as string;
  const protocolFallbackEnabled = formData.get('protocolFallbackEnabled') as string;
  const activeLocale = formData.get('activeLocale') as string;
  const protectedResources = (formData.get('protectedResources') as string)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const tableName = getResourceName('ConfigTable');
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
            key: 'deploy_limit',
            value: deployLimit,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: 'escalation_enabled',
            value: escalationEnabled,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: 'protocol_fallback_enabled',
            value: protocolFallbackEnabled,
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
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: 'active_locale',
            value: activeLocale,
          },
        })
      ),
    ]);

    revalidatePath('/settings');
  } catch (e) {
    logger.error('Error updating settings config:', e);
  }
}

async function triggerRebuild() {
  'use server';
  try {
    const projectName = getResourceName('Deployer');
    if (!projectName) {
      throw new Error('Deployer project not found in resources');
    }

    const client = new CodeBuildClient({});
    await client.send(
      new StartBuildCommand({
        projectName,
        environmentVariablesOverride: [{ name: 'INFRA_REBUILD', value: 'true' }],
      })
    );

    revalidatePath('/settings');
  } catch (e) {
    logger.error('Error triggering rebuild:', e);
  }
}

export default async function SettingsPage() {
  const config = await getConfig();

  return (
    <div className="flex-1 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-green/5 via-transparent to-transparent">
      <PageHeader titleKey="SETTINGS_TITLE" subtitleKey="SETTINGS_SUBTITLE" />

      <div className="max-w-4xl space-y-10">
        <SettingsForm config={config} updateConfig={updateConfig} />

        <SettingsClient triggerRebuild={triggerRebuild} />

        <DeploySyncStatus />
      </div>
    </div>
  );
}
