'use client';

import React, { useState } from 'react';
import { Settings, Zap, RefreshCw, Save } from 'lucide-react';
import { SYSTEM_CONFIG_METADATA } from '@claw/core/lib/metadata';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import CyberSelect from '@/components/CyberSelect';
import CyberTooltip from '@/components/CyberTooltip';
import { THEME } from '@/lib/theme';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import { EvolutionMode } from '@claw/core/lib/types/agent';
import { SYSTEM } from '@claw/core/lib/constants';
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

interface SystemConfig {
  provider?: string;
  model?: string;
  evolutionMode?: string;
  optimizationPolicy?: string;
  activeLocale?: string;
  maxToolIterations?: string | number;
  circuitBreakerThreshold?: string | number;
  protectedResources?: string;
  reflectionFrequency?: string | number;
  strategicReviewFrequency?: string | number;
  minGapsForReview?: string | number;
  recursionLimit?: string | number;
  deployLimit?: string | number;
  escalationEnabled?: string;
  protocolFallbackEnabled?: string;
  consecutiveBuildFailures?: number;
}

interface SettingsFormProps {
  config: SystemConfig;
  updateConfig: (formData: FormData) => Promise<void>;
}

function ConfigTooltip({ id, t }: { id: string; t: ReturnType<typeof useTranslations>['t'] }) {
  const meta = SYSTEM_CONFIG_METADATA[id];
  if (!meta) return null;

  return (
    <CyberTooltip
      content={
        <div className="space-y-2">
          <p className="text-cyber-blue font-bold uppercase text-[9px] mb-1">
            {t('SETTINGS_TOOLTIP_INTEGRATION').replace('{label}', meta.label)}
          </p>
          <p>{meta.implication}</p>
          {meta.risk && (
            <p>
              <span className="text-red-400 font-bold">{t('SETTINGS_TOOLTIP_RISK')}</span> {meta.risk}
            </p>
          )}
          {meta.safeguard && (
            <p>
              <span className="text-green-400 font-bold">{t('SETTINGS_TOOLTIP_SAFEGUARD')}</span> {meta.safeguard}
            </p>
          )}
        </div>
      }
    />
  );
}

export default function SettingsForm({ config, updateConfig }: SettingsFormProps) {
  const [activeProvider, setActiveProvider] = useState(config.provider ?? LLMProvider.OPENAI);
  const [activeModel, setActiveModel] = useState(config.model ?? OpenAIModel.GPT_5_4);
  const [evolutionMode, setEvolutionMode] = useState(config.evolutionMode ?? EvolutionMode.HITL);
  const [optimizationPolicy, setOptimizationPolicy] = useState(
    config.optimizationPolicy ?? 'balanced'
  );
  const [activeLocale, setActiveLocale] = useState(config.activeLocale ?? 'en');
  const [maxToolIterations, setMaxToolIterations] = useState(config.maxToolIterations ?? '15');
  const [circuitBreakerThreshold, setCircuitBreakerThreshold] = useState(
    config.circuitBreakerThreshold ?? '5'
  );
  const [protectedResources, setProtectedResources] = useState(
    config.protectedResources ?? 'sst.config.ts, buildspec.yml, infra/'
  );
  const [reflectionFrequency, setReflectionFrequency] = useState(
    config.reflectionFrequency ?? '10'
  );
  const [strategicReviewFrequency, setStrategicReviewFrequency] = useState(
    config.strategicReviewFrequency ?? '24'
  );
  const [minGapsForReview, setMinGapsForReview] = useState(config.minGapsForReview ?? '10');
  const [recursionLimit, setRecursionLimit] = useState(config.recursionLimit ?? '50');
  const [deployLimit, setDeployLimit] = useState(config.deployLimit ?? '5');
  const [escalationEnabled, setEscalationEnabled] = useState(config.escalationEnabled ?? 'true');
  const [protocolFallbackEnabled, setProtocolFallbackEnabled] = useState(
    config.protocolFallbackEnabled ?? 'true'
  );

  const { t, setLocale } = useTranslations();

  const resetRouting = () => {
    setActiveProvider(SYSTEM.DEFAULT_PROVIDER);
    setActiveModel(SYSTEM.DEFAULT_MODEL);
  };

  const resetLanguage = () => {
    setActiveLocale('en');
    setLocale('en');
  };

  const resetEvolution = () => {
    setEvolutionMode(EvolutionMode.HITL);
    setOptimizationPolicy('balanced');
    setMaxToolIterations('15');
    setCircuitBreakerThreshold('5');
    setRecursionLimit('50');
    setDeployLimit('5');
    setEscalationEnabled('true');
    setProtocolFallbackEnabled('true');
    setProtectedResources('sst.config.ts, buildspec.yml, infra/');
  };

  const resetReflection = () => {
    setReflectionFrequency('10');
    setStrategicReviewFrequency('24');
    setMinGapsForReview('10');
  };

  const hasChanges =
    activeProvider !== config.provider ||
    activeModel !== config.model ||
    evolutionMode !== config.evolutionMode ||
    optimizationPolicy !== config.optimizationPolicy ||
    activeLocale !== config.activeLocale ||
    String(maxToolIterations) !== String(config.maxToolIterations) ||
    String(circuitBreakerThreshold) !== String(config.circuitBreakerThreshold) ||
    protectedResources !== config.protectedResources ||
    String(reflectionFrequency) !== String(config.reflectionFrequency) ||
    String(strategicReviewFrequency) !== String(config.strategicReviewFrequency) ||
    String(minGapsForReview) !== String(config.minGapsForReview) ||
    String(recursionLimit) !== String(config.recursionLimit) ||
    String(deployLimit) !== String(config.deployLimit) ||
    escalationEnabled !== config.escalationEnabled ||
    protocolFallbackEnabled !== config.protocolFallbackEnabled;

  return (
    <>
      <form id="settings-form" action={updateConfig}>
        <Card variant="glass" padding="lg" className="space-y-8 cyber-border relative">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Typography
                variant="caption"
                weight="bold"
                color="intel"
                uppercase
                className="flex items-center gap-2"
              >
                <Settings size={16} /> {t('SETTINGS_LLM_PROVIDER_ROUTING')}
              </Typography>
              <button
                type="button"
                onClick={resetRouting}
                className="text-[9px] font-bold text-intel/40 hover:text-intel uppercase tracking-widest transition-colors flex items-center gap-1"
              >
                <RefreshCw size={10} /> {t('SETTINGS_RESET_DEFAULTS')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_ACTIVE_PROVIDER')}
                  <ConfigTooltip id="active_provider" t={t} />
                </Typography>
                <CyberSelect
                  name="provider"
                  value={activeProvider}
                  onChange={(val) => {
                    setActiveProvider(val);
                    const firstModel = PROVIDERS[val as keyof typeof PROVIDERS]?.models[0];
                    if (firstModel) setActiveModel(firstModel);
                  }}
                  options={Object.entries(PROVIDERS).map(([id, p]) => ({
                    value: id,
                    label: p.label,
                  }))}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_DEFAULT_MODEL_ID')}
                  <ConfigTooltip id="active_model" t={t} />
                </Typography>
                <CyberSelect
                  name="model"
                  value={activeModel}
                  onChange={setActiveModel}
                  options={PROVIDERS[activeProvider as keyof typeof PROVIDERS]?.models.map((m) => ({
                    value: m,
                    label: m,
                  }))}
                  className="w-full"
                />
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-border space-y-4">
            <div className="flex justify-between items-center">
              <Typography
                variant="caption"
                weight="bold"
                color="intel"
                uppercase
                className="flex items-center gap-2"
              >
                <RefreshCw size={16} /> {t('LANGUAGE')}
              </Typography>
              <button
                type="button"
                onClick={resetLanguage}
                className="text-[9px] font-bold text-intel/40 hover:text-intel uppercase tracking-widest transition-colors flex items-center gap-1"
              >
                <RefreshCw size={10} /> {t('SETTINGS_RESET_DEFAULTS')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('LANGUAGE')}
                </Typography>
                <CyberSelect
                  name="activeLocale"
                  value={activeLocale}
                  onChange={(val) => {
                    setActiveLocale(val);
                    setLocale(val as 'en' | 'cn');
                  }}
                  options={[
                    { value: 'en', label: t('ENGLISH') },
                    { value: 'cn', label: t('CHINESE') },
                  ]}
                  className="w-full"
                />
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 space-y-4">
            <div className="flex justify-between items-center">
              <Typography
                variant="caption"
                weight="bold"
                color="primary"
                uppercase
                className="flex items-center gap-2"
              >
                <Zap size={16} /> {t('SETTINGS_EVOLUTION_ENGINE_CONTROL')}
              </Typography>
              <button
                type="button"
                onClick={resetEvolution}
                className="text-[9px] font-bold text-primary/40 hover:text-primary uppercase tracking-widest transition-colors flex items-center gap-1"
              >
                <RefreshCw size={10} /> {t('SETTINGS_RESET_DEFAULTS')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_EVOLUTION_MODE')}
                  <ConfigTooltip id="evolution_mode" t={t} />
                </Typography>
                <CyberSelect
                  name="evolutionMode"
                  value={evolutionMode}
                  onChange={setEvolutionMode}
                  options={[
                    { value: EvolutionMode.HITL, label: t('SETTINGS_HUMAN_IN_THE_LOOP') },
                    { value: EvolutionMode.AUTO, label: t('SETTINGS_FULLY_AUTONOMOUS') },
                  ]}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_DAILY_DEPLOY_LIMIT')}
                  <ConfigTooltip id="deploy_limit" t={t} />
                </Typography>
                <input
                  name="deployLimit"
                  type="number"
                  value={deployLimit}
                  onChange={(e) => setDeployLimit(e.target.value)}
                  className={`w-full bg-input border border-input rounded p-2 text-sm text-foreground outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
                />
              </div>
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_OPTIMIZATION_POLICY')}
                  <CyberTooltip
                    content={
                      <div className="space-y-2">
                        <p>
                          {t('SETTINGS_TOOLTIP_PRECEDENCE')}
                        </p>
                        <p>
                          {t('SETTINGS_TOOLTIP_BALANCED')}
                        </p>
                        <p>
                          {t('SETTINGS_TOOLTIP_AGGRESSIVE')}
                        </p>
                        <p>
                          {t('SETTINGS_TOOLTIP_CONSERVATIVE')}
                        </p>
                      </div>
                    }
                  />
                </Typography>
                <CyberSelect
                  name="optimizationPolicy"
                  value={optimizationPolicy}
                  onChange={setOptimizationPolicy}
                  options={[
                    { value: 'aggressive', label: t('SETTINGS_AGGRESSIVE') },
                    { value: 'balanced', label: t('SETTINGS_BALANCED') },
                    { value: 'conservative', label: t('SETTINGS_CONSERVATIVE') },
                  ]}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_MAX_TOOL_ITERATIONS')}
                  <CyberTooltip
                    content={
                      <div className="space-y-2">
                        <p>
                          <span className="text-cyber-blue font-bold">{t('SETTINGS_TOOLTIP_BENEFIT')}</span> {t('SETTINGS_TOOLTIP_ITERATIONS_DESC')}
                        </p>
                        <p>
                          <span className="text-red-400 font-bold">{t('SETTINGS_TOOLTIP_COST')}</span> {t('SETTINGS_TOOLTIP_ITERATIONS_COST')}
                        </p>
                      </div>
                    }
                  />
                </Typography>
                <input
                  name="maxToolIterations"
                  type="number"
                  value={maxToolIterations}
                  onChange={(e) => setMaxToolIterations(e.target.value)}
                  className={`w-full bg-input border border-input rounded p-2 text-sm text-foreground outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
                />
                <Typography variant="caption" color="muted" className="italic block mt-1">
                  {t('SETTINGS_MAX_TOOL_ITERATIONS_DESC')}
                </Typography>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Typography
                    variant="caption"
                    weight="bold"
                    color="white"
                    uppercase
                    className="flex items-center"
                  >
                    {t('SETTINGS_CIRCUIT_BREAKER_THRESHOLD')}
                    <ConfigTooltip id="circuit_breaker_threshold" t={t} />
                  </Typography>
                  <Typography
                    variant="mono"
                    weight="bold"
                    color={Number(config.consecutiveBuildFailures) > 0 ? 'danger' : 'primary'}
                    className="text-[10px]"
                  >
                    {t('SETTINGS_FAILURES').replace('{count}', String(config.consecutiveBuildFailures))}
                  </Typography>
                </div>
                <input
                  name="circuitBreakerThreshold"
                  type="number"
                  value={circuitBreakerThreshold}
                  onChange={(e) => setCircuitBreakerThreshold(e.target.value)}
                  className={`w-full bg-input border border-input rounded p-2 text-sm text-foreground outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
                />
              </div>
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_RECURSION_LIMIT')}
                  <CyberTooltip
                    content={
                      <div className="space-y-2">
                        <p>
                          {t('SETTINGS_TOOLTIP_RECURSION_IMPLICATION')}
                        </p>
                        <p>
                          <span className="text-red-400 font-bold">{t('SETTINGS_TOOLTIP_RISK')}</span> {t('SETTINGS_TOOLTIP_RECURSION_RISK')}
                        </p>
                      </div>
                    }
                  />
                </Typography>
                <input
                  name="recursionLimit"
                  type="number"
                  value={recursionLimit}
                  onChange={(e) => setRecursionLimit(e.target.value)}
                  className={`w-full bg-input border border-input rounded p-2 text-sm text-foreground outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
                />
              </div>
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_ESCALATION_ENGINE')}
                  <ConfigTooltip id="escalation_enabled" t={t} />
                </Typography>
                <CyberSelect
                  name="escalationEnabled"
                  value={escalationEnabled}
                  onChange={setEscalationEnabled}
                  options={[
                    { value: 'true', label: t('SETTINGS_ENABLED_MULTI_CHANNEL') },
                    { value: 'false', label: t('SETTINGS_DISABLED_LEGACY') },
                  ]}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_PROTOCOL_FALLBACK')}
                  <ConfigTooltip id="protocol_fallback_enabled" t={t} />
                </Typography>
                <CyberSelect
                  name="protocolFallbackEnabled"
                  value={protocolFallbackEnabled}
                  onChange={setProtocolFallbackEnabled}
                  options={[
                    { value: 'true', label: t('SETTINGS_ENABLED_JSON_TEXT') },
                    { value: 'false', label: t('SETTINGS_DISABLED_FAIL_JSON') },
                  ]}
                  className="w-full"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Typography
                variant="caption"
                weight="bold"
                color="white"
                uppercase
                className="flex items-center"
              >
                {t('SETTINGS_PROTECTED_RESOURCE_SCOPES')}
                <CyberTooltip
                  content={
                    <div className="space-y-2">
                      <p>
                        <span className="text-cyber-blue font-bold">{t('SETTINGS_TOOLTIP_BENEFIT')}</span> {t('SETTINGS_TOOLTIP_PROTECTED_BENEFIT')}
                      </p>
                      <p>
                        <span className="text-red-400 font-bold">{t('SETTINGS_TOOLTIP_SAFEGUARD')}</span> {t('SETTINGS_TOOLTIP_PROTECTED_SAFEGUARD')}
                      </p>
                    </div>
                  }
                />
              </Typography>
              <input
                name="protectedResources"
                type="text"
                value={protectedResources}
                onChange={(e) => setProtectedResources(e.target.value)}
                className={`w-full bg-input border border-input rounded p-2 text-sm text-foreground outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
              />
              <Typography variant="caption" color="muted" className="italic block mt-1">
                {t('SETTINGS_PROTECTED_RESOURCE_SCOPES_DESC')}
              </Typography>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 space-y-4">
            <div className="flex justify-between items-center">
              <Typography
                variant="caption"
                weight="bold"
                color="intel"
                uppercase
                className="flex items-center gap-2"
              >
                <RefreshCw size={16} /> {t('SETTINGS_NEURAL_REFLECTION_CONFIG')}
              </Typography>
              <button
                type="button"
                onClick={resetReflection}
                className="text-[9px] font-bold text-intel/40 hover:text-intel uppercase tracking-widest transition-colors flex items-center gap-1"
              >
                <RefreshCw size={10} /> {t('SETTINGS_RESET_DEFAULTS')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_REFLECTION_FREQUENCY')}
                  <CyberTooltip
                    content={
                      <div className="space-y-2">
                        <p>
                          <span className="text-cyber-blue font-bold">{t('SETTINGS_TOOLTIP_BENEFIT')}</span> {t('SETTINGS_TOOLTIP_REFLECTION_BENEFIT')}
                        </p>
                        <p>
                          <span className="text-red-400 font-bold">{t('SETTINGS_TOOLTIP_RISK')}</span> {t('SETTINGS_TOOLTIP_REFLECTION_CONS')}
                        </p>
                        <p>
                          <span className="text-green-400 font-bold">{t('SETTINGS_TOOLTIP_SAFEGUARD')}</span> {t('SETTINGS_TOOLTIP_REFLECTION_RECOMMENDED')}
                        </p>
                      </div>
                    }
                  />
                </Typography>
                <input
                  name="reflectionFrequency"
                  type="number"
                  value={reflectionFrequency}
                  onChange={(e) => setReflectionFrequency(e.target.value)}
                  className={`w-full bg-input border border-input rounded p-2 text-sm text-foreground outline-none focus:border-${THEME.COLORS.REFLECT} transition-colors font-mono`}
                />
              </div>
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_STRATEGIC_REVIEW_INTERVAL')}
                  <CyberTooltip
                    content={
                      <div className="space-y-2">
                        <p>
                          <span className="text-cyber-blue font-bold">{t('SETTINGS_TOOLTIP_BENEFIT')}</span> {t('SETTINGS_TOOLTIP_REVIEW_BENEFIT')}
                        </p>
                        <p>
                          <span className="text-red-400 font-bold">{t('SETTINGS_TOOLTIP_RISK')}</span> {t('SETTINGS_TOOLTIP_REVIEW_CONS')}
                        </p>
                      </div>
                    }
                  />
                </Typography>
                <input
                  name="strategicReviewFrequency"
                  type="number"
                  value={strategicReviewFrequency}
                  onChange={(e) => setStrategicReviewFrequency(e.target.value)}
                  className={`w-full bg-input border border-input rounded p-2 text-sm text-foreground outline-none focus:border-${THEME.COLORS.REFLECT} transition-colors font-mono`}
                />
              </div>
              <div className="space-y-2">
                <Typography
                  variant="caption"
                  weight="bold"
                  color="white"
                  uppercase
                  className="flex items-center"
                >
                  {t('SETTINGS_MIN_GAPS_FOR_REVIEW')}
                  <CyberTooltip
                    content={
                      <div className="space-y-2">
                        <p>
                          <span className="text-cyber-blue font-bold">{t('SETTINGS_TOOLTIP_BENEFIT')}</span> {t('SETTINGS_TOOLTIP_GAPS_BENEFIT')}
                        </p>
                        <p>
                          <span className="text-green-400 font-bold">{t('SETTINGS_TOOLTIP_SAFEGUARD')}</span> {t('SETTINGS_TOOLTIP_GAPS_EVIDENCE')}
                        </p>
                      </div>
                    }
                  />
                </Typography>
                <input
                  name="minGapsForReview"
                  type="number"
                  value={minGapsForReview}
                  onChange={(e) => setMinGapsForReview(e.target.value)}
                  className={`w-full bg-input border border-input rounded p-2 text-sm text-foreground outline-none focus:border-${THEME.COLORS.REFLECT} transition-colors font-mono`}
                />
              </div>
            </div>
          </div>
        </Card>
      </form>

      {/* Floating Save Button - Outside form layout but linked via id */}
      <div className="fixed bottom-10 right-10 z-30">
        <Button
          type="submit"
          form="settings-form"
          disabled={!hasChanges}
          size="lg"
          icon={<Save size={16} />}
          uppercase
          className="shadow-[0_0_20px_rgba(0,0,0,0.5)] scale-105 active:scale-95"
        >
          {t('SAVE')}
        </Button>
      </div>
    </>
  );
}
