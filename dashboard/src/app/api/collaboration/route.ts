import { NextResponse } from 'next/server';
import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '@claw/core/lib/logger';

export async function GET() {
  try {
    const typedResource = Resource as unknown as { MemoryTable?: { name: string } };
    const tableName = typedResource.MemoryTable?.name;

    if (!tableName) {
      return NextResponse.json({ activeDispatches: [] });
    }

    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client);

    // Scan for active parallel dispatches
    const res = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'begins_with(userId, :prefix) AND #status = :pending',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':prefix': 'PARALLEL#',
          ':pending': 'pending',
        },
      })
    );

    const activeDispatches = (res.Items ?? []).map((item) => {
      // Extract task information from metadata
      const metadata = (item.metadata as Record<string, unknown>) ?? {};
      const tasks =
        (metadata.tasks as Array<{
          taskId: string;
          agentId: string;
          task: string;
          dependsOn?: string[];
        }>) ?? [];

      // Reconstruct DAG state if available
      const dagState = metadata.dagState as
        | {
            nodes: Record<
              string,
              {
                status: string;
                task: { taskId: string; agentId: string; task: string; dependsOn?: string[] };
              }
            >;
            completedTasks: string[];
            failedTasks: string[];
          }
        | undefined;

      // Map tasks with their current status
      const tasksWithStatus = tasks.map((task) => {
        const dagNode = dagState?.nodes[task.taskId];
        return {
          taskId: task.taskId,
          agentId: task.agentId,
          task: task.task,
          dependsOn: task.dependsOn,
          status: dagNode?.status ?? 'pending',
        };
      });

      // Trace ID extraction
      const userIdParts = item.userId?.split('#') ?? [];
      const traceId =
        userIdParts.length > 2
          ? userIdParts[2] // PARALLEL#user#trace
          : userIdParts.length > 1
            ? userIdParts[1] // user#trace or PARALLEL#trace
            : 'unknown';

      return {
        traceId,
        taskCount: item.taskCount as number,
        completedCount: item.completedCount as number,
        initiatorId: item.initiatorId as string,
        initialQuery: item.initialQuery as string | undefined,
        sessionId: item.sessionId as string | undefined,
        aggregationType: item.aggregationType as string | undefined,
        tasks: tasksWithStatus,
        dagState: dagState
          ? {
              nodes: dagState.nodes,
              completedTasks: dagState.completedTasks,
              failedTasks: dagState.failedTasks,
            }
          : undefined,
      };
    });

    return NextResponse.json({ activeDispatches });
  } catch (error) {
    logger.error('Error fetching collaboration data:', error);
    return NextResponse.json({ activeDispatches: [] });
  }
}
