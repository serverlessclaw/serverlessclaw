'use client';

import React, { useState } from 'react';
import { Settings, Save, RefreshCw, Zap, Settings2, ShieldAlert, Shield, Bot, Trash2, ChevronRight, AlertTriangle } from 'lucide-react';
import { SYSTEM_CONFIG_METADATA } from '@claw/core/lib/metadata';
import CyberSelect from '@/components/CyberSelect';
import CyberTooltip from '@/components/CyberTooltip';
import { THEME } from '@/lib/theme';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';

const PROVIDERS = {
  openai: {
    label: 'OpenAI (Native)',
    models: ['gpt-5.4', 'gpt-5.4-mini'],
  },
  bedrock: {
    label: 'AWS Bedrock (Native)',
    models: ['global.anthropic.claude-sonnet-4-6'],
  },
  openrouter: {
    label: 'OpenRouter (Aggregator)',
    models: ['zhipu/glm-5', 'minimax/minimax-m2.7', 'google/gemini-3-flash-preview'],
  },
};

interface SettingsFormProps {
  config: any;
  updateConfig: (formData: FormData) => Promise<void>;
}

function ConfigTooltip({ id }: { id: string }) {
  const meta = SYSTEM_CONFIG_METADATA[id];
  if (!meta) return null;

  return (
    <CyberTooltip content={
      <div className="space-y-2">
        <p className="text-cyber-blue font-bold uppercase text-[9px] mb-1">Neural Integration: {meta.label}</p>
        <p>{meta.implication}</p>
        {meta.risk && <p><span className="text-red-400 font-bold">RISK:</span> {meta.risk}</p>}
        {meta.safeguard && <p><span className="text-green-400 font-bold">SAFEGUARD:</span> {meta.safeguard}</p>}
      </div>
    } />
  );
}

export default function SettingsForm({ config, updateConfig }: SettingsFormProps) {
  const [activeProvider, setActiveProvider] = useState(config.provider ?? 'openai');
  const [activeModel, setActiveModel] = useState(config.model ?? 'gpt-5.4');
  const [evolutionMode, setEvolutionMode] = useState(config.evolutionMode ?? 'hitl');
  const [optimizationPolicy, setOptimizationPolicy] = useState(config.optimizationPolicy ?? 'balanced');
  const [maxToolIterations, setMaxToolIterations] = useState(config.maxToolIterations ?? '5');
  const [circuitBreakerThreshold, setCircuitBreakerThreshold] = useState(config.circuitBreakerThreshold ?? '3');
  const [protectedResources, setProtectedResources] = useState(config.protectedResources ?? '');
  const [reflectionFrequency, setReflectionFrequency] = useState(config.reflectionFrequency ?? '3');
  const [strategicReviewFrequency, setStrategicReviewFrequency] = useState(config.strategicReviewFrequency ?? '12');
  const [minGapsForReview, setMinGapsForReview] = useState(config.minGapsForReview ?? '3');
  const [recursionLimit, setRecursionLimit] = useState(config.recursionLimit ?? '50');
  const [deployLimit, setDeployLimit] = useState(config.deployLimit ?? '5');

  const hasChanges = 
    activeProvider !== config.provider ||
    activeModel !== config.model ||
    evolutionMode !== config.evolutionMode ||
    optimizationPolicy !== config.optimizationPolicy ||
    String(maxToolIterations) !== String(config.maxToolIterations) ||
    String(circuitBreakerThreshold) !== String(config.circuitBreakerThreshold) ||
    protectedResources !== config.protectedResources ||
    String(reflectionFrequency) !== String(config.reflectionFrequency) ||
    String(strategicReviewFrequency) !== String(config.strategicReviewFrequency) ||
    String(minGapsForReview) !== String(config.minGapsForReview) ||
    String(recursionLimit) !== String(config.recursionLimit) ||
    String(deployLimit) !== String(config.deployLimit);

  return (
    <>
      <form id="settings-form" action={updateConfig}>
        <Card variant="glass" padding="lg" className="space-y-8 cyber-border relative">
          <div className="space-y-4">
            <Typography variant="caption" weight="bold" color="intel" uppercase className="flex items-center gap-2">
              <Settings size={16} /> LLM Provider Routing
            </Typography>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Active Provider
                  <ConfigTooltip id="active_provider" />
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
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Default Model ID
                  <ConfigTooltip id="active_model" />
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

          <div className="pt-8 border-t border-white/5 space-y-4">
            <Typography variant="caption" weight="bold" color="primary" uppercase className="flex items-center gap-2">
              <Zap size={16} /> Evolution Engine Control
            </Typography>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Evolution Mode
                  <ConfigTooltip id="evolution_mode" />
                </Typography>
                <CyberSelect
                  name="evolutionMode"
                  value={evolutionMode}
                  onChange={setEvolutionMode}
                  options={[
                    { value: 'hitl', label: 'Human-in-the-Loop (Safe)' },
                    { value: 'auto', label: 'Fully Autonomous (Live)' },
                  ]}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Daily Deploy Limit
                  <ConfigTooltip id="deploy_limit" />
                </Typography>
                <input
                  name="deployLimit"
                  type="number"
                  value={deployLimit}
                  onChange={(e) => setDeployLimit(e.target.value)}
                  className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
                />
              </div>
              <div className="space-y-2">
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Optimization Policy
                  <CyberTooltip content={
                    <div className="space-y-2">
                      <p><span className="text-cyber-blue font-bold">PRECEDENCE:</span> Priority 2. Overrides the "intended" profile of a task unless the Agent has a hardcoded Model.</p>
                      <p><span className="text-cyber-blue font-bold">BALANCED:</span> Respects task requirements.</p>
                      <p><span className="text-red-400 font-bold">AGGRESSIVE:</span> Forces DEEP reasoning for all nodes (High Quality/Cost).</p>
                      <p><span className="text-green-400 font-bold">CONSERVATIVE:</span> Forces FAST reasoning (Low Cost/Complexity).</p>
                    </div>
                  } />
                </Typography>
                <CyberSelect
                  name="optimizationPolicy"
                  value={optimizationPolicy}
                  onChange={setOptimizationPolicy}
                  options={[
                    { value: 'aggressive', label: 'Aggressive (Velocity)' },
                    { value: 'balanced', label: 'Balanced (Stability)' },
                    { value: 'conservative', label: 'Conservative (Safety)' },
                  ]}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Max Tool Iterations
                  <CyberTooltip content={
                    <div className="space-y-2">
                      <p><span className="text-cyber-blue font-bold">BENEFIT:</span> Allows agents to solve complex problems by looping through multiple tools.</p>
                      <p><span className="text-red-400 font-bold">COST:</span> Each iteration is a separate LLM call. High values ( &gt; 20) can drain credits quickly.</p>
                    </div>
                  } />
                </Typography>
                <input
                  name="maxToolIterations"
                  type="number"
                  value={maxToolIterations}
                  onChange={(e) => setMaxToolIterations(e.target.value)}
                  className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
                />
                <Typography variant="caption" color="muted" className="italic block mt-1">
                  Maximum number of tool-calling loops per request.
                </Typography>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                     Circuit Breaker Threshold
                     <ConfigTooltip id="circuit_breaker_threshold" />
                  </Typography>
                  <Typography variant="mono" weight="bold" color={Number(config.consecutiveBuildFailures) > 0 ? 'danger' : 'primary'} className="text-[10px]">
                    Failures: {config.consecutiveBuildFailures}
                  </Typography>
                </div>
                <input
                  name="circuitBreakerThreshold"
                  type="number"
                  value={circuitBreakerThreshold}
                  onChange={(e) => setCircuitBreakerThreshold(e.target.value)}
                  className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
                />
              </div>
              <div className="space-y-2">
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Recursion Limit
                  <CyberTooltip content={
                    <div className="space-y-2">
                      <p><span className="text-cyber-blue font-bold">IMPLICATION:</span> Controls agent delegation depth. Higher values enable more complex orchestrations.</p>
                      <p><span className="text-red-400 font-bold">RISK:</span> High values can obfuscate infinite logical loops between agents.</p>
                    </div>
                  } />
                </Typography>
                <input
                  name="recursionLimit"
                  type="number"
                  value={recursionLimit}
                  onChange={(e) => setRecursionLimit(e.target.value)}
                  className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                Protected Resource Scopes
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">BENEFIT:</span> Critical files that Coder Agent is forbidden from modifying.</p>
                    <p><span className="text-red-400 font-bold">SAFEGUARD:</span> Protects infrastructure and core orchestrator logic from accidental deletion.</p>
                  </div>
                } />
              </Typography>
              <input
                name="protectedResources"
                type="text"
                value={protectedResources}
                onChange={(e) => setProtectedResources(e.target.value)}
                className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
              />
              <Typography variant="caption" color="muted" className="italic block mt-1">
                Comma-separated list of protected files or paths.
              </Typography>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 space-y-4">
            <Typography variant="caption" weight="bold" color="intel" uppercase className="flex items-center gap-2">
              <RefreshCw size={16} /> Neural Reflection Config
            </Typography>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Reflection Frequency (msgs)
                  <CyberTooltip content={
                    <div className="space-y-2">
                      <p><span className="text-cyber-blue font-bold">BENEFIT:</span> How often the system "thinks" about the conversation to extract new facts and lessons.</p>
                      <p><span className="text-red-400 font-bold">CONS:</span> Low values ( &lt; 5) increase token cost and can cause "Cognitive Overload" (too many minor facts).</p>
                      <p><span className="text-green-400 font-bold">RECOMMENDED:</span> 10-15.</p>
                    </div>
                  } />
                </Typography>
                <input
                  name="reflectionFrequency"
                  type="number"
                  value={reflectionFrequency}
                  onChange={(e) => setReflectionFrequency(e.target.value)}
                  className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.REFLECT} transition-colors font-mono`}
                />
              </div>
              <div className="space-y-2">
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Strategic Review Interval (hrs)
                  <CyberTooltip content={
                    <div className="space-y-2">
                      <p><span className="text-cyber-blue font-bold">BENEFIT:</span> The cooldown between large-scale architectural reviews.</p>
                      <p><span className="text-red-400 font-bold">CONS:</span> Too frequent reviews can lead to redundant micro-optimizations.</p>
                    </div>
                  } />
                </Typography>
                <input
                  name="strategicReviewFrequency"
                  type="number"
                  value={strategicReviewFrequency}
                  onChange={(e) => setStrategicReviewFrequency(e.target.value)}
                  className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.REFLECT} transition-colors font-mono`}
                />
              </div>
              <div className="space-y-2">
                <Typography variant="caption" weight="bold" color="white" uppercase className="flex items-center">
                  Min Gaps for Review
                  <CyberTooltip content={
                    <div className="space-y-2">
                      <p><span className="text-cyber-blue font-bold">BENEFIT:</span> Minimum number of identified capability gaps required to trigger a Strategic Review.</p>
                      <p><span className="text-green-400 font-bold">BENEFIT:</span> Ensures reviews only happen when there is enough "evidence" to justify a system change.</p>
                    </div>
                  } />
                </Typography>
                <input
                  name="minGapsForReview"
                  type="number"
                  value={minGapsForReview}
                  onChange={(e) => setMinGapsForReview(e.target.value)}
                  className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.REFLECT} transition-colors font-mono`}
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
          Save System Config
        </Button>
      </div>
    </>
  );
}
