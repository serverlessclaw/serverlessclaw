export interface ILockManager {
  acquire(lockId: string, ttlSeconds: number): Promise<boolean>;
  release(lockId: string): Promise<void>;
}

export interface SSTResource {
  MemoryTable: { name: string };
  TraceTable: { name: string };
  ConfigTable: { name: string };
  StagingBucket: { name: string };
  AgentBus: { name: string };
  WebhookApi: { url: string };
  Deployer: { name: string };
  TelegramBotToken: { value: string };
  OpenAIApiKey: { value: string };
  OpenRouterApiKey: { value: string };
  AwsRegion: { value: string };
}

export interface TopologyNode {
  id: string;
  type: 'dashboard' | 'infra' | 'agent';
  label: string;
  description?: string;
  icon?: string;
  iconType?: string;
  enabled?: boolean;
  isBackbone?: boolean;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
}

export interface Topology {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}
