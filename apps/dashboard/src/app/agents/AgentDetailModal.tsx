'use client';

import React from 'react';
import {
  X,
  Bot,
  Shield,
  ShieldAlert,
  Settings2,
  Cpu,
  ChevronRight,
  Wrench,
  Trash2,
  Save,
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import CyberSelect from '@/components/CyberSelect';
import { Agent } from '@/lib/types/ui';
import { useTranslations } from '@/components/Providers/TranslationsProvider';

import {
  LLMProvider,
  OpenAIModel,
  BedrockModel,
  MiniMaxModel,
  OpenRouterModel,
} from '@claw/core/lib/types/llm';

const PROVIDERS = {
  [LLMProvider.OPENAI]: {
    label: 'OpenAI (Native)',
    models: [
      OpenAIModel.GPT_5_4,
      OpenAIModel.GPT_5_4_MINI,
      OpenAIModel.GPT_5_4_NANO,
      OpenAIModel.GPT_5_MINI,
    ],
  },
  [LLMProvider.BEDROCK]: {
    label: 'AWS Bedrock (Native)',
    models: [BedrockModel.CLAUDE_4_6],
  },
  [LLMProvider.MINIMAX]: {
    label: 'MiniMax (Native)',
    models: [MiniMaxModel.M2_7, MiniMaxModel.M2_7_HIGHSPEED],
  },
  [LLMProvider.OPENROUTER]: {
    label: 'OpenRouter (Aggregator)',
    models: [OpenRouterModel.GLM_5, OpenRouterModel.GEMINI_3_FLASH],
  },
};

const REASONING_PROFILES = [
  { value: '', label: 'INHERIT_SYSTEM_DEFAULT' },
  { value: 'fast', label: 'Fast' },
  { value: 'standard', label: 'Standard' },
  { value: 'thinking', label: 'Thinking' },
  { value: 'deep', label: 'Deep' },
];

interface AgentDetailModalProps {
  agent: Agent | null;
  reputation?: Record<
    string,
    { successRate: number; avgLatencyMs: number; tasksCompleted: number; tasksFailed: number }
  >;
  onClose: () => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  onDelete: (id: string) => void;
  onOpenTools: (id: string) => void;
  onSave: () => void;
  saving: boolean;
  hasChanges: boolean;
}

export default function AgentDetailModal({
  agent,
  reputation,
  onClose,
  updateAgent,
  onDelete,
  onOpenTools,
  onSave,
  saving,
  hasChanges,
}: AgentDetailModalProps) {
  const { t } = useTranslations();
  if (!agent) return null;

  const isLogicOnly = agent.agentType === 'logic';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-4xl max-h-[85vh] overflow-y-auto bg-background border border-border rounded-lg shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className={`p-2 rounded ${
                agent.isBackbone
                  ? 'bg-cyber-blue/10 text-cyber-blue'
                  : 'bg-background/40 text-foreground'
              }`}
            >
              {isLogicOnly ? (
                <ShieldAlert size={18} />
              ) : agent.isBackbone ? (
                <Shield size={18} />
              ) : (
                <Bot size={18} />
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                value={agent.name}
                onChange={(e) => updateAgent(agent.id, { name: e.target.value })}
                className="bg-transparent border-none text-foreground font-bold outline-none focus:ring-1 focus:ring-border rounded px-1 text-base uppercase tracking-tight"
              />
              <Typography variant="mono" color="muted" className="text-[10px] opacity-50">
                {agent.id}
              </Typography>
              {agent.isBackbone && (
                <Badge variant="primary" className="py-0">
                  {t('AGENTS_BACKBONE')}
                </Badge>
              )}
              {isLogicOnly && (
                <Badge variant="audit" className="py-0">
                  {t('AGENTS_SYSTEM_LOGIC')}
                </Badge>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-more hover:text-foreground transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Prompt Section */}
            <div className="lg:col-span-7 space-y-3">
              <Typography
                variant="caption"
                weight="bold"
                color="white"
                uppercase
                className="flex items-center gap-2"
              >
                <Settings2 size={12} className="text-cyan-400" />
                {isLogicOnly ? t('AGENTS_EXECUTION_PARAMETERS') : t('AGENTS_SYSTEM_INSTRUCTIONS')}
              </Typography>
              {isLogicOnly ? (
                <Card
                  variant="solid"
                  padding="md"
                  className="w-full text-[10px] text-muted font-mono italic leading-relaxed min-h-[200px]"
                >
                  {t('AGENTS_LOGIC_ONLY_DESC')}
                  <br />
                  <br />
                  <Typography
                    variant="mono"
                    weight="bold"
                    uppercase
                    className="flex items-center gap-2 mt-4 opacity-60"
                  >
                    <ChevronRight size={10} /> source_path: core/handlers/{agent.id}.ts
                  </Typography>
                </Card>
              ) : (
                <textarea
                  value={agent.systemPrompt}
                  onChange={(e) => updateAgent(agent.id, { systemPrompt: e.target.value })}
                  className="w-full bg-background/40 border border-border rounded p-4 text-xs text-foreground/90 font-mono min-h-[280px] outline-none focus:border-cyber-blue transition-all leading-relaxed custom-scrollbar"
                  placeholder={t('AGENTS_SYSTEM_INSTRUCTIONS_PLACEHOLDER')}
                />
              )}
            </div>

            {/* Config Section */}
            <div className="lg:col-span-5 space-y-4">
              {!isLogicOnly && (
                <Card variant="solid" padding="sm" className="space-y-4">
                  <Typography
                    variant="caption"
                    weight="bold"
                    color="white"
                    uppercase
                    className="flex items-center gap-2"
                  >
                    <Cpu size={12} className="text-green-400" /> {t('AGENTS_HARDWARE_ALIGNMENT')}
                  </Typography>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Typography
                        variant="mono"
                        weight="bold"
                        uppercase
                        className="text-[9px] opacity-60"
                      >
                        {t('AGENTS_LLM_PROVIDER')}
                      </Typography>
                      <CyberSelect
                        value={agent.provider || ''}
                        onChange={(val) => updateAgent(agent.id, { provider: val, model: '' })}
                        options={[
                          { value: '', label: 'INHERIT_SYSTEM_DEFAULT' },
                          ...Object.entries(PROVIDERS).map(([id, p]) => ({
                            value: id,
                            label: p.label,
                          })),
                        ]}
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <Typography
                        variant="mono"
                        weight="bold"
                        uppercase
                        className="text-[9px] opacity-60"
                      >
                        {t('AGENTS_MODEL_ID')}
                      </Typography>
                      <CyberSelect
                        value={agent.model || ''}
                        onChange={(val) => updateAgent(agent.id, { model: val })}
                        options={
                          agent.provider
                            ? (PROVIDERS[agent.provider as keyof typeof PROVIDERS]?.models.map(
                                (m) => ({ value: m, label: m })
                              ) ?? [])
                            : []
                        }
                        disabled={!agent.provider}
                        placeholder={
                          agent.provider
                            ? t('AGENTS_SELECT_MODEL')
                            : t('AGENTS_SELECT_PROVIDER_FIRST')
                        }
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-2">
                      <Typography
                        variant="mono"
                        weight="bold"
                        uppercase
                        className="text-[9px] opacity-60"
                      >
                        {t('AGENTS_REASONING_PROFILE')}
                      </Typography>
                      <CyberSelect
                        value={agent.reasoningProfile || ''}
                        onChange={(val) => updateAgent(agent.id, { reasoningProfile: val })}
                        options={REASONING_PROFILES}
                        className="w-full"
                      />
                    </div>
                  </div>
                </Card>
              )}

              <Card
                variant="solid"
                padding="sm"
                className="border-cyber-blue/10 bg-cyber-blue/[0.02]"
              >
                <Typography
                  variant="caption"
                  weight="bold"
                  color="intel"
                  uppercase
                  className="flex items-center gap-2 mb-2"
                >
                  <ChevronRight size={12} /> {t('AGENTS_EXECUTION_CONTEXT')}
                </Typography>
                <Typography variant="caption" className="italic block opacity-70">
                  Agent Type:{' '}
                  {agent.isBackbone ? t('AGENTS_PERSISTENT_BACKBONE') : t('AGENTS_DYNAMIC_SPOKE')}.
                  {isLogicOnly
                    ? t('AGENTS_CORE_RESILIENCE_LOGIC')
                    : t('AGENTS_AUTHORIZED_INTERACT')}
                </Typography>
              </Card>

              {reputation && reputation[agent.id] && (
                <Card variant="solid" padding="sm" className="border-border">
                  <Typography
                    variant="caption"
                    weight="bold"
                    uppercase
                    className="flex items-center gap-2 mb-3"
                  >
                    <ChevronRight size={12} className="text-green-400" /> {t('AGENTS_REPUTATION')}
                  </Typography>
                  <div className="space-y-2 font-mono text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-muted uppercase">{t('AGENTS_TASKS_COMPLETED')}</span>
                      <span className="text-foreground/80">
                        {reputation[agent.id].tasksCompleted}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted uppercase">{t('AGENTS_TASKS_FAILED')}</span>
                      <span className="text-foreground/80">{reputation[agent.id].tasksFailed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/40 uppercase">{t('AGENTS_SUCCESS_RATE')}</span>
                      <span
                        className={`font-bold ${
                          reputation[agent.id].successRate >= 0.8
                            ? 'text-green-400'
                            : reputation[agent.id].successRate >= 0.5
                              ? 'text-amber-400'
                              : 'text-red-400'
                        }`}
                      >
                        {(reputation[agent.id].successRate * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted uppercase">{t('AGENTS_AVG_LATENCY')}</span>
                      <span className="text-foreground/80">
                        {reputation[agent.id].avgLatencyMs.toFixed(0)}ms
                      </span>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 bg-background border-t border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              onClick={onSave}
              disabled={saving || !hasChanges}
              loading={saving}
              size="sm"
              icon={<Save size={14} />}
              uppercase
              className="font-black tracking-widest"
            >
              {t('AGENTS_SAVE_CONFIG')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenTools(agent.id)}
              className="text-muted hover:text-cyber-green p-2 flex items-center gap-2"
            >
              <Wrench size={14} />
              <span className="text-[10px] font-bold uppercase tracking-widest">
                {t('AGENTS_TOOLS')} ({agent.tools?.length ?? 0})
              </span>
            </Button>
            <label
              className={`flex items-center gap-2 ${agent.isBackbone ? 'cursor-not-allowed' : 'cursor-pointer'} group`}
            >
              <Typography
                variant="caption"
                weight="bold"
                uppercase
                className="text-xs group-hover:text-cyber-green transition-colors"
              >
                {t('AGENTS_STATUS_ACTIVE')}
              </Typography>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={agent.enabled}
                  disabled={agent.isBackbone}
                  onChange={(e) => updateAgent(agent.id, { enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-background/40 rounded-full peer peer-checked:bg-cyber-green/30 relative transition-all border border-border overflow-hidden after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-muted-more after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:toggle-move peer-checked:after:bg-cyber-green peer-checked:after:shadow-[0_0_8px_rgba(0,255,163,0.8)] shadow-inner" />
              </div>
            </label>
          </div>
          {!agent.isBackbone && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(agent.id)}
              className="text-muted-more hover:text-red-500"
              icon={<Trash2 size={14} />}
            >
              {t('COMMON_DELETE')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
