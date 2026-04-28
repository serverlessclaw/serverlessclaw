import { getResourceName } from '@/lib/sst-utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { revalidatePath } from 'next/cache';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import SettingsForm from './SettingsForm';
import DeploySyncStatus from '@/components/DeploySyncStatus';
import { SYSTEM, CONFIG_KEYS } from '@claw/core/lib/constants';
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
          Key: { key: CONFIG_KEYS.ACTIVE_PROVIDER },
        })
      ),
      docClient.send(
        new GetCommand({ TableName: tableName, Key: { key: CONFIG_KEYS.ACTIVE_MODEL } })
      ),
      docClient.send(
        new GetCommand({ TableName: tableName, Key: { key: CONFIG_KEYS.EVOLUTION_MODE } })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.OPTIMIZATION_POLICY },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.REFLECTION_FREQUENCY },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.STRATEGIC_REVIEW_FREQUENCY },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.MIN_GAPS_FOR_REVIEW },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.MAX_TOOL_ITERATIONS },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.CIRCUIT_BREAKER_THRESHOLD },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.CONSECUTIVE_BUILD_FAILURES },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.PROTECTED_RESOURCES },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.RECURSION_LIMIT },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.DEPLOY_LIMIT },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.ESCALATION_ENABLED },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.PROTOCOL_FALLBACK_ENABLED },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { key: CONFIG_KEYS.ACTIVE_LOCALE },
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
          Item: { key: CONFIG_KEYS.ACTIVE_PROVIDER, value: provider },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { key: CONFIG_KEYS.ACTIVE_MODEL, value: model },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { key: CONFIG_KEYS.EVOLUTION_MODE, value: evolutionMode },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { key: CONFIG_KEYS.OPTIMIZATION_POLICY, value: optimizationPolicy },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { key: CONFIG_KEYS.REFLECTION_FREQUENCY, value: reflectionFrequency },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.STRATEGIC_REVIEW_FREQUENCY,
            value: strategicReviewFrequency,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.MIN_GAPS_FOR_REVIEW,
            value: minGapsForReview,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.MAX_TOOL_ITERATIONS,
            value: maxToolIterations,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.CIRCUIT_BREAKER_THRESHOLD,
            value: circuitBreakerThreshold,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.RECURSION_LIMIT,
            value: recursionLimit,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.DEPLOY_LIMIT,
            value: deployLimit,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.ESCALATION_ENABLED,
            value: escalationEnabled,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.PROTOCOL_FALLBACK_ENABLED,
            value: protocolFallbackEnabled,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.PROTECTED_RESOURCES,
            value: protectedResources,
          },
        })
      ),
      docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: {
            key: CONFIG_KEYS.ACTIVE_LOCALE,
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
