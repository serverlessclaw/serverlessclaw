import React from 'react';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  ArrowLeft,
  Activity,
  MessageSquare,
  Wrench,
  CheckCircle,
  ShieldAlert,
  ChevronDown,
  LayoutGrid,
  Bot,
  Zap,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import PathVisualizer from '@/components/PathVisualizer';
import TraceContextRegistrar from '@/components/Trace/TraceContextRegistrar';
import Image from 'next/image';
import { UI_STRINGS } from '@/lib/constants';
import { TRACE_TYPES, TRACE_STATUS } from '@claw/core/lib/constants';
import { logger } from '@claw/core/lib/logger';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { THEME } from '@/lib/theme';
import { getTraceTableName } from '@claw/core/lib/utils/ddb-client';
import { Trace, TraceStep, ToolCallContent, ToolResultContent } from '@/lib/types/ui';
import PageHeader from '@/components/PageHeader';

export const dynamic = 'force-dynamic';

/**
 * Fetches all nodes for a specific trace record from DynamoDB
 */
async function getTraceNodes(traceId: string): Promise<Trace[]> {
  try {
    const tableName = getTraceTableName();
    if (!tableName) {
      logger.error('TraceTable name is missing from Resources');
      return [];
    }
    const client = new DynamoDBClient({});
    const docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });

    const { Items } = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'traceId = :tid',
        ExpressionAttributeValues: { ':tid': traceId },
      })
    );

    return (Items as Trace[]) ?? [];
  } catch (e) {
    logger.error('Error fetching trace nodes:', e);
    return [];
  }
}

/**
 * Returns the appropriate icon for a trace step type
 */
function StepIcon({ type }: { type: string }): React.ReactElement {
  switch (type) {
    case TRACE_TYPES.LLM_CALL:
      return <MessageSquare size={16} className="text-purple-400" />;
    case TRACE_TYPES.LLM_RESPONSE:
      return <Zap size={16} className="text-cyber-green" />;
    case TRACE_TYPES.TOOL_CALL:
      return <Wrench size={16} className="text-yellow-400" />;
    case TRACE_TYPES.TOOL_RESULT:
      return <CheckCircle size={16} className="text-cyber-green" />;
    case TRACE_TYPES.ERROR:
      return <ShieldAlert size={16} className="text-red-500" />;
    default:
      return <Activity size={16} className="text-white/100" />;
  }
}

/**
 * Detailed view of a single execution trace
 */
export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const nodes = await getTraceNodes(id);

  if (!nodes || nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0a]">
        <ShieldAlert size={48} className="mb-4 opacity-20 text-red-500" />
        <Typography variant="h2" weight="bold" color="white">
          {UI_STRINGS.TRACE_NOT_FOUND}
        </Typography>
        <Link href="/trace" className="mt-4 flex items-center gap-2">
          <Typography variant="caption" color="primary" weight="bold" className="hover:underline">
            <ArrowLeft size={16} className="inline mr-1" /> {UI_STRINGS.RETURN_TO_BASE}
          </Typography>
        </Link>
      </div>
    );
  }

  // Use the root node (usually the first one or one with nodeId='root') for header info
  const rootNode = nodes.find((n) => n.nodeId === 'root') ?? nodes[0];

  return (
    <div
      data-testid="trace-detail-container"
      className="flex-1 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent"
    >
      <TraceContextRegistrar
        traceId={id}
        url={`/trace/${id}`}
        data={{
          status: rootNode.status,
          userText: rootNode.initialContext?.userText,
          timestamp: rootNode.timestamp,
        }}
      />
      <PageHeader
        titleKey={`Trace::${rootNode.traceId.slice(0, 8)}`}
        subtitleKey={rootNode.initialContext?.userText ?? 'System orchestrated task execution.'}
        stats={
          <div className="flex gap-4">
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                STATUS
              </Typography>
              <Badge
                variant={rootNode.status === TRACE_STATUS.COMPLETED ? 'primary' : 'outline'}
                className={`px-4 py-1 font-black text-xs uppercase ${
                  rootNode.status !== TRACE_STATUS.COMPLETED
                    ? 'text-yellow-500 border-yellow-500/20'
                    : ''
                }`}
              >
                {rootNode.status}
              </Badge>
            </div>
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                STEPS
              </Typography>
              <Badge variant="intel" className="px-4 py-1 font-black text-xs">
                {nodes.reduce((acc, n) => acc + (n.steps?.length ?? 0), 0)}
              </Badge>
            </div>
          </div>
        }
      >
        <Link href="/trace">
          <Button variant="outline" size="sm" icon={<ArrowLeft size={14} />}>
            {UI_STRINGS.BACK_TO_INTELLIGENCE}
          </Button>
        </Link>
      </PageHeader>

      <div className="space-y-12">
        {/* Visualizer Section */}
        <section>
          {/* PathVisualizer will now receive all nodes to render the graph */}
          <PathVisualizer trace={{ ...rootNode, nodes } as Trace} />
        </section>

        {[...nodes]
          .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
          .map((node) => (
            <section key={node.nodeId} className="space-y-6">
              <Typography
                variant="caption"
                weight="black"
                className="tracking-[0.2em] flex items-center justify-between mb-4"
              >
                <span className="flex items-center gap-2">
                  <Activity size={14} className="text-cyber-green" /> Step::{node.nodeId}{' '}
                  {node.parentId ? `(Parent: ${node.parentId.slice(0, 8)})` : '(Root)'}
                </span>

                {(node.status === 'error' || node.status === 'failed') && (
                  <div className="flex gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      data-testid="retry-button"
                      className="h-6 text-[8px] font-black uppercase"
                    >
                      <RefreshCw size={10} className="mr-1" /> RETRY
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="fix-button"
                      className="h-6 text-[8px] font-black uppercase border-red-500/30 text-red-400"
                    >
                      <Wrench size={10} className="mr-1" /> FIX
                    </Button>
                  </div>
                )}
              </Typography>

              <div className="space-y-4">
                {node.steps?.map((step: TraceStep) => (
                  <div key={step.stepId} className="glass-card border-white/5 overflow-hidden">
                    <div className="p-4 flex items-center justify-between bg-white/[0.02]">
                      <div className="flex items-center gap-4">
                        <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                          <StepIcon type={step.type} />
                        </div>
                        <div>
                          <Typography
                            variant="caption"
                            weight="bold"
                            color="white"
                            className="tracking-wider block"
                          >
                            {step.type}
                          </Typography>
                          <Typography
                            variant="caption"
                            weight="medium"
                            color="white"
                            className="flex items-center gap-2"
                          >
                            {step.type === TRACE_TYPES.TOOL_CALL
                              ? `Executing ${(step.content as ToolCallContent)?.toolName || (step.content as ToolCallContent)?.tool || ''}`
                              : step.type === TRACE_TYPES.TOOL_RESULT
                                ? `Observation from ${(step.content as ToolResultContent)?.toolName || (step.content as ToolResultContent)?.tool || 'tool'}`
                                : step.type === TRACE_TYPES.LLM_CALL
                                  ? 'Agent Request (Input)'
                                  : step.type === TRACE_TYPES.LLM_RESPONSE
                                    ? 'Agent Response (Output)'
                                    : 'Error detected'}

                            {step.type === TRACE_TYPES.TOOL_CALL && (
                              <Badge
                                variant={
                                  (step.content as ToolCallContent)?.connectorId
                                    ? 'primary'
                                    : 'outline'
                                }
                                data-testid={
                                  (step.content as ToolCallContent)?.connectorId
                                    ? 'mcp-badge'
                                    : 'local-badge'
                                }
                                className="text-[8px] px-1.5 py-0"
                              >
                                {(step.content as ToolCallContent)?.connectorId ? 'MCP' : 'LOCAL'}
                              </Badge>
                            )}
                          </Typography>
                        </div>
                      </div>
                      <Typography variant="mono" color="muted" className="text-[9px]">
                        {new Date(step.timestamp as number).toLocaleTimeString()}
                      </Typography>
                    </div>

                    <div className="p-4 bg-black/40 border-t border-white/5">
                      {step.type === TRACE_TYPES.TOOL_RESULT &&
                      step.content?.result &&
                      typeof step.content.result === 'object' &&
                      (step.content.result as { images?: string[] }).images ? (
                        <div className="mb-4 space-y-4">
                          <div className="text-[10px] text-cyber-blue/60 uppercase font-bold tracking-widest flex items-center gap-2">
                            <LayoutGrid size={12} /> Generated_Visuals
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {(step.content.result as { images: string[] }).images.map(
                              (img: string, imgIdx: number) => (
                                <div
                                  key={imgIdx}
                                  className="border border-white/10 rounded overflow-hidden bg-black/20 group/img relative"
                                >
                                  <Image
                                    src={
                                      img.startsWith('data:') ? img : `data:image/png;base64,${img}`
                                    }
                                    alt={`Output ${imgIdx}`}
                                    width={800}
                                    height={600}
                                    className="w-full h-auto object-contain max-h-[400px]"
                                  />
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      ) : null}

                      {step.type === TRACE_TYPES.LLM_RESPONSE ? (
                        <div className="mb-4 p-4 bg-cyber-green/[0.03] border border-cyber-green/10 rounded">
                          <div className="text-[10px] text-cyber-green/60 uppercase font-bold mb-2 tracking-widest flex items-center gap-2">
                            <Bot size={12} /> Generated_Response
                          </div>
                          <span className="text-white/40">
                            {step.timestamp ? new Date(step.timestamp).toLocaleTimeString() : ''}
                          </span>
                          <div className="text-xs text-white/90 leading-relaxed whitespace-pre-wrap font-mono">
                            {(() => {
                              const content = step.content.content;
                              if (!content) return '';
                              try {
                                const parsed = JSON.parse(content);
                                return JSON.stringify(parsed, null, 2);
                              } catch {
                                return content;
                              }
                            })()}
                          </div>
                          {step.content.tool_calls && step.content.tool_calls.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-cyber-green/10">
                              <div className="text-[10px] text-yellow-500/60 uppercase font-bold mb-2 tracking-widest">
                                Requested_Tools
                              </div>
                              <div className="space-y-2">
                                {step.content.tool_calls.map(
                                  (
                                    tc: { function: { name: string; arguments: string } },
                                    tci: number
                                  ) => (
                                    <div
                                      key={tci}
                                      className="text-[10px] bg-yellow-500/5 border border-yellow-500/10 p-2 rounded font-mono text-yellow-500/80"
                                    >
                                      {tc.function.name}({tc.function.arguments})
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}

                      <details className="group">
                        <summary className="list-none cursor-pointer flex items-center justify-between">
                          <Typography
                            variant="mono"
                            weight="bold"
                            color="primary"
                            className="tracking-widest flex items-center gap-1 hover:text-cyber-green transition-colors"
                          >
                            {UI_STRINGS.RAW_PAYLOAD}
                          </Typography>
                          <ChevronDown
                            size={14}
                            className="text-cyber-green/60 group-open:rotate-180 transition-transform"
                          />
                        </summary>
                        <div className="mt-4 p-4 bg-black/60 rounded border border-white/5 overflow-x-auto">
                          <pre className="text-[11px] leading-relaxed text-cyber-blue/80">
                            {JSON.stringify(step.content, null, 2)}
                          </pre>
                        </div>
                      </details>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

        {rootNode.finalResponse && (
          <section className="mt-12">
            <Typography
              variant="caption"
              weight="black"
              className="tracking-[0.2em] flex items-center gap-2 mb-4"
            >
              <CheckCircle size={14} className={`text-${THEME.COLORS.PRIMARY}`} />{' '}
              {UI_STRINGS.FINAL_OUTPUT}
            </Typography>
            <Card
              variant="glass"
              padding="lg"
              className="border-cyber-green/20 bg-cyber-green/[0.02]"
            >
              <Typography
                variant="body"
                color="white"
                className="leading-relaxed whitespace-pre-wrap"
              >
                {rootNode.finalResponse}
              </Typography>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
