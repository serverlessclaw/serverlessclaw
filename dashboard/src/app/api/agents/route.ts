/**
 * @module AgentsAPI
 * Express-style dynamic route for managing agent configurations in the dashboard.
 */
import { Resource } from 'sst';
export const dynamic = 'force-dynamic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { NextResponse } from 'next/server';
import { HTTP_STATUS, DYNAMO_KEYS } from '@claw/core/lib/constants';
import { BACKBONE_REGISTRY } from '@claw/core/lib/backbone';
import { SSTResource } from '@claw/core/lib/types/index';
import { logger } from '@claw/core/lib/logger';
import { AgentRegistry } from '@claw/core/lib/registry/AgentRegistry';
import { IAgentConfig } from '@claw/core/lib/types/agent';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const typedResource = Resource as unknown as SSTResource;

/**
 * GET handler for agents configuration.
 * Retrieves all registered agent configurations from the registry.
 *
 * @returns A promise that resolves to a NextResponse containing the agents configurations.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { AgentRegistry } = await import('@claw/core/lib/registry');
    const configs = await AgentRegistry.getAllConfigs();
    return NextResponse.json(configs);
  } catch (error) {
    logger.error('Failed to fetch agents:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch agents',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * POST handler for agents configuration.
 * Updates the global agents configuration in DynamoDB.
 *
 * @param request - The incoming NextRequest containing the new agents configuration.
 * @returns A promise that resolves to a NextResponse indicating success or failure.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    let agentsToSave: Record<string, Partial<IAgentConfig>> = {};

    if (body && body.agents && Array.isArray(body.agents)) {
      if (body.agents.length === 0) {
        // Handle empty array as a skip but ensure we still check resource status
        if (!typedResource.ConfigTable?.name) {
          return NextResponse.json(
            { error: 'ConfigTable name is missing from resources.' },
            { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
          );
        }
        return NextResponse.json({ success: true });
      }
      body.agents.forEach((a: Partial<IAgentConfig>) => {
        if (a.id) agentsToSave[a.id] = a;
      });
    } else {
      agentsToSave = body as Record<string, Partial<IAgentConfig>>;
    }

    if (!typedResource.ConfigTable?.name) {
      return NextResponse.json(
        { error: 'ConfigTable name is missing from resources.' },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      );
    }

    for (const [agentId, config] of Object.entries(agentsToSave)) {
      await AgentRegistry.saveConfig(agentId, config);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error updating agents config:', error);
    return NextResponse.json(
      {
        error: 'Failed to update agents',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * PATCH handler for creating or updating a single agent.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { agentId, config } = body as { agentId: string; config: Partial<IAgentConfig> };

    if (!agentId || !config) {
      return NextResponse.json(
        { error: 'agentId and config are required.' },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    if (!typedResource.ConfigTable?.name) {
      return NextResponse.json(
        { error: 'ConfigTable name is missing from resources.' },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      );
    }

    if (BACKBONE_REGISTRY[agentId as keyof typeof BACKBONE_REGISTRY] && config.isBackbone !== true) {
      return NextResponse.json(
        { error: `Cannot overwrite backbone agent '${agentId}' with non-backbone configuration.` },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    await AgentRegistry.saveConfig(agentId, config);

    return NextResponse.json({ success: true, agentId });
  } catch (error) {
    logger.error('Error updating agent:', error);
    return NextResponse.json(
      {
        error: 'Failed to update agent',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * DELETE handler for removing a single non-backbone agent.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const tableName = typedResource.ConfigTable?.name;
    if (!tableName) {
      return NextResponse.json(
        { error: 'ConfigTable name is missing from resources.' },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      );
    }

    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agentId');

    if (!agentId) {
      return NextResponse.json(
        { error: 'agentId query parameter is required.' },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    if (BACKBONE_REGISTRY[agentId]) {
      return NextResponse.json(
        { error: `Cannot delete backbone agent '${agentId}'.` },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    // Remove agent from agents_config
    await docClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { key: DYNAMO_KEYS.AGENTS_CONFIG ?? 'agents_config' },
        UpdateExpression: 'REMOVE #agents.#id',
        ExpressionAttributeNames: { '#agents': 'value', '#id': agentId },
      })
    );

    // Remove tool overrides
    await docClient.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { key: `${agentId}_tools` },
      })
    );

    return NextResponse.json({ success: true, agentId });
  } catch (error) {
    logger.error('Error deleting agent:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete agent',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
