import { IAgentConfig, ITool, IMemory, IProvider } from './types';
import { logger } from './logger';
import { PromptDecorator, PromptDecoratorRegistry } from './registry/prompt-decorator';
import { IAgentHooks, AgentHookRegistry } from './registry/agent-hook';
import { IToolMiddleware, ToolMiddlewareRegistry } from './registry/tool-middleware';
import { IAuditSink, AuditSinkRegistry } from './registry/audit-sink';
import { IEventMirror, EventMirrorRegistry } from './registry/event-mirror';
import { ITelemetrySink, TelemetrySinkRegistry } from './registry/telemetry-sink';
import { IMissionObserver, MissionControlRegistry } from './registry/mission-control';

export interface ClawPlugin {
  id: string;
  agents?: Record<string, IAgentConfig>;
  tools?: Record<string, ITool>;
  memoryProviders?: Record<string, IMemory>;
  llmProviders?: Record<string, IProvider>;
  promptDecorators?: PromptDecorator[];
  hooks?: IAgentHooks;
  toolMiddleware?: IToolMiddleware[];
  auditSinks?: IAuditSink[];
  eventMirrors?: IEventMirror[];
  telemetrySinks?: ITelemetrySink[];
  missionObservers?: IMissionObserver[];
  // UI Extensions (Phase 1 & 4 bridge)
  sidebarExtensions?: Array<{
    id: string;
    label: string;
    href: string;
    icon: string; // Icon name as string for serializability
    section?: string;
  }>;
  layoutExtensions?: Array<{
    id: string;
    slot: string;
    componentName: string; // Component name to be looked up in DynamicRegistry
  }>;
  onInit?: () => Promise<void>;
}

/**
 * PluginManager enables monorepo projects to register capabilities
 * without modifying the core codebase.
 */
export class PluginManager {
  private static plugins: Map<string, ClawPlugin> = new Map();
  private static initialized = false;

  static async register(plugin: ClawPlugin) {
    if (this.plugins.has(plugin.id)) {
      logger.warn(`[PluginManager] Plugin "${plugin.id}" already registered. Overwriting.`);
    }
    this.plugins.set(plugin.id, plugin);
    logger.info(`[PluginManager] Registered plugin: ${plugin.id}`);

    // Register prompt decorators if any
    if (plugin.promptDecorators) {
      plugin.promptDecorators.forEach((decorator) => {
        PromptDecoratorRegistry.register(decorator);
      });
    }

    // Register agent hooks if any
    if (plugin.hooks) {
      AgentHookRegistry.register(plugin.hooks);
    }

    // Register tool middleware if any
    if (plugin.toolMiddleware) {
      plugin.toolMiddleware.forEach((mw) => {
        ToolMiddlewareRegistry.register(mw);
      });
    }

    // Register audit sinks if any
    if (plugin.auditSinks) {
      plugin.auditSinks.forEach((sink) => {
        AuditSinkRegistry.register(sink);
      });
    }

    // Register event mirrors if any
    if (plugin.eventMirrors) {
      plugin.eventMirrors.forEach((mirror) => {
        EventMirrorRegistry.register(mirror);
      });
    }

    // Register telemetry sinks if any
    if (plugin.telemetrySinks) {
      plugin.telemetrySinks.forEach((sink) => {
        TelemetrySinkRegistry.register(sink);
      });
    }

    // Register mission observers if any
    if (plugin.missionObservers) {
      plugin.missionObservers.forEach((observer) => {
        MissionControlRegistry.register(observer);
      });
    }

    if (plugin.onInit) {
      await plugin.onInit();
    }
  }

  /**
   * Retrieves all registered plugins.
   */
  static getAllPlugins(): ClawPlugin[] {
    return Array.from(this.plugins.values());
  }

  static getRegisteredAgents(): Record<string, IAgentConfig> {
    const agents: Record<string, IAgentConfig> = {};
    for (const plugin of this.plugins.values()) {
      if (plugin.agents) {
        Object.assign(agents, plugin.agents);
      }
    }
    return agents;
  }

  static getRegisteredTools(): Record<string, ITool> {
    const tools: Record<string, ITool> = {};
    for (const plugin of this.plugins.values()) {
      if (plugin.tools) {
        Object.assign(tools, plugin.tools);
      }
    }
    return tools;
  }

  static async initialize() {
    if (this.initialized) return;
    
    // Auto-discovery of internal plugins could go here if we had a standard path
    // For now, we rely on explicit registration in the entry points.
    
    this.initialized = true;
    logger.info(`[PluginManager] Initialized with ${this.plugins.size} plugins.`);
  }
}
