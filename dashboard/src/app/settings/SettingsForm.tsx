'use client';

import React, { useState } from 'react';
import { Settings, Save, RefreshCw, Zap, HelpCircle } from 'lucide-react';
import CyberSelect from '@/components/CyberSelect';
import CyberTooltip from '@/components/CyberTooltip';
import { THEME } from '@/lib/theme';

const PROVIDERS = {
  openai: {
    label: 'OpenAI (Native)',
    models: ['gpt-5.4', 'gpt-5-mini'],
  },
  bedrock: {
    label: 'AWS Bedrock (Native)',
    models: ['global.anthropic.claude-sonnet-4-6'],
  },
  openrouter: {
    label: 'OpenRouter (Aggregator)',
    models: ['zhipu/glm-5', 'minimax/minimax-2.5', 'google/gemini-3-flash-preview'],
  },
};

interface SettingsFormProps {
  config: any;
  updateConfig: (formData: FormData) => Promise<void>;
}

export default function SettingsForm({ config, updateConfig }: SettingsFormProps) {
  const [activeProvider, setActiveProvider] = useState(config.provider || 'openai');
  const [activeModel, setActiveModel] = useState(config.model || 'gpt-5.4');
  const [evolutionMode, setEvolutionMode] = useState(config.evolutionMode || 'hitl');
  const [optimizationPolicy, setOptimizationPolicy] = useState(config.optimizationPolicy || 'balanced');
  const [maxToolIterations, setMaxToolIterations] = useState(config.maxToolIterations || '5');
  const [circuitBreakerThreshold, setCircuitBreakerThreshold] = useState(config.circuitBreakerThreshold || '3');
  const [protectedResources, setProtectedResources] = useState(config.protectedResources || '');
  const [reflectionFrequency, setReflectionFrequency] = useState(config.reflectionFrequency || '3');
  const [strategicReviewFrequency, setStrategicReviewFrequency] = useState(config.strategicReviewFrequency || '12');
  const [minGapsForReview, setMinGapsForReview] = useState(config.minGapsForReview || '3');
  const [recursionLimit, setRecursionLimit] = useState(config.recursionLimit || '50');

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
    String(recursionLimit) !== String(config.recursionLimit);

  return (
    <>
      <form id="settings-form" action={updateConfig} className="glass-card p-6 lg:p-8 space-y-8 cyber-border relative">
        <div className="space-y-4">
          <h3 className={`text-sm font-bold flex items-center gap-2 text-${THEME.COLORS.INTEL} uppercase tracking-wider`}>
            <Settings size={16} /> LLM_PROVIDER_ROUTING
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
                Active Provider
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">PRECEDENCE:</span> Priority 3 (System Default). Overridden by Agent-specific settings.</p>
                    <p><span className="text-cyber-blue font-bold">PROS:</span> Native providers offer lowest latency. OpenRouter enables 2026 exotic models.</p>
                  </div>
                } />
              </label>
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
                Default Model ID
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">PRECEDENCE:</span> System-wide fallback. Used only if no Agent or Profile mapping exists.</p>
                    <p><span className="text-cyber-blue font-bold">PROS:</span> 2026 Flagships (GPT-5.4 / Claude 4.6) are superior for coding. GPT-5-mini is 20x faster.</p>
                  </div>
                } />
              </label>
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
          <h3 className={`text-sm font-bold flex items-center gap-2 text-${THEME.COLORS.PRIMARY} uppercase tracking-wider`}>
            <Zap size={16} /> EVOLUTION_ENGINE_CONTROL
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
                Evolution Mode
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">HITL:</span> Human-in-the-Loop. Safe, requires 'APPROVE' for code changes.</p>
                    <p><span className="text-green-400 font-bold">AUTO:</span> Fully Autonomous. Maximum velocity, system evolves independently.</p>
                  </div>
                } />
              </label>
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
                Optimization Policy
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">PRECEDENCE:</span> Priority 2. Overrides the "intended" profile of a task unless the Agent has a hardcoded Model.</p>
                    <p><span className="text-cyber-blue font-bold">BALANCED:</span> Respects task requirements.</p>
                    <p><span className="text-red-400 font-bold">AGGRESSIVE:</span> Forces DEEP reasoning for all nodes (High Quality/Cost).</p>
                    <p><span className="text-green-400 font-bold">CONSERVATIVE:</span> Forces FAST reasoning (Low Cost/Complexity).</p>
                  </div>
                } />
              </label>
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
                Max Tool Iterations
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">BENEFIT:</span> Allows agents to solve complex problems by looping through multiple tools.</p>
                    <p><span className="text-red-400 font-bold">COST:</span> Each iteration is a separate LLM call. High values ( &gt; 20) can drain credits quickly.</p>
                  </div>
                } />
              </label>
              <input
                name="maxToolIterations"
                type="number"
                value={maxToolIterations}
                onChange={(e) => setMaxToolIterations(e.target.value)}
                className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
              />
              <p className="text-[9px] text-white/50 italic">
                Maximum number of tool-calling loops per request.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex justify-between items-center">
                <span className="flex items-center">
                  Circuit Breaker Threshold
                  <CyberTooltip content={
                    <div className="space-y-2">
                      <p><span className="text-cyber-blue font-bold">BENEFIT:</span> Prevents "Deployment Death Spirals" by stopping autonomous evolution after consecutive failures.</p>
                      <p><span className="text-green-400 font-bold">SAFEGUARD:</span> Automatically flips the system to HITL mode when threshold is hit.</p>
                    </div>
                  } />
                </span>
                <span
                  className={
                    Number(config.consecutiveBuildFailures) > 0 ? `text-${THEME.COLORS.DANGER}` : `text-${THEME.COLORS.PRIMARY}`
                  }
                >
                  Failures: {config.consecutiveBuildFailures}
                </span>
              </label>
              <input
                name="circuitBreakerThreshold"
                type="number"
                value={circuitBreakerThreshold}
                onChange={(e) => setCircuitBreakerThreshold(e.target.value)}
                className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
                Recursion Limit
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">BENEFIT:</span> Allows for deep, multi-level agent-to-agent delegation.</p>
                    <p><span className="text-red-400 font-bold">RISK:</span> Setting this too high can cause infinite delegation loops if agents are confused.</p>
                    <p><span className="text-green-400 font-bold">RECOMMENDED:</span> 20-50 for complex workflows.</p>
                  </div>
                } />
              </label>
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
            <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
              Protected Resource Scopes
              <CyberTooltip content={
                <div className="space-y-2">
                  <p><span className="text-cyber-blue font-bold">BENEFIT:</span> Critical files that Coder Agent is forbidden from modifying.</p>
                  <p><span className="text-red-400 font-bold">SAFEGUARD:</span> Protects infrastructure and core orchestrator logic from accidental deletion.</p>
                </div>
              } />
            </label>
            <input
              name="protectedResources"
              type="text"
              value={protectedResources}
              onChange={(e) => setProtectedResources(e.target.value)}
              className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.PRIMARY} transition-colors font-mono`}
            />
            <p className="text-[9px] text-white/50 italic">
              Comma-separated list of protected files or paths.
            </p>
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 space-y-4">
          <h3 className={`text-sm font-bold flex items-center gap-2 text-${THEME.COLORS.REFLECT} uppercase tracking-wider`}>
            <RefreshCw size={16} /> NEURAL_REFLECTION_CONFIG
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
                Reflection Frequency (msgs)
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">BENEFIT:</span> How often the system "thinks" about the conversation to extract new facts and lessons.</p>
                    <p><span className="text-red-400 font-bold">CONS:</span> Low values ( &lt; 5) increase token cost and can cause "Cognitive Overload" (too many minor facts).</p>
                    <p><span className="text-green-400 font-bold">RECOMMENDED:</span> 10-15.</p>
                  </div>
                } />
              </label>
              <input
                name="reflectionFrequency"
                type="number"
                value={reflectionFrequency}
                onChange={(e) => setReflectionFrequency(e.target.value)}
                className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.REFLECT} transition-colors font-mono`}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
                Strategic Review Interval (hrs)
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">BENEFIT:</span> The cooldown between large-scale architectural reviews.</p>
                    <p><span className="text-red-400 font-bold">CONS:</span> Too frequent reviews can lead to redundant micro-optimizations.</p>
                  </div>
                } />
              </label>
              <input
                name="strategicReviewFrequency"
                type="number"
                value={strategicReviewFrequency}
                onChange={(e) => setStrategicReviewFrequency(e.target.value)}
                className={`w-full bg-black/40 border border-white/10 rounded p-2 text-sm text-white/90 outline-none focus:border-${THEME.COLORS.REFLECT} transition-colors font-mono`}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex items-center">
                Min Gaps for Review
                <CyberTooltip content={
                  <div className="space-y-2">
                    <p><span className="text-cyber-blue font-bold">BENEFIT:</span> Minimum number of identified capability gaps required to trigger a Strategic Review.</p>
                    <p><span className="text-green-400 font-bold">BENEFIT:</span> Ensures reviews only happen when there is enough "evidence" to justify a system change.</p>
                  </div>
                } />
              </label>
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
      </form>

      {/* Floating Save Button - Outside form layout but linked via id */}
      <div className="fixed bottom-10 right-10 z-30">
        <button
          type="submit"
          form="settings-form"
          disabled={!hasChanges}
          className={`${THEME.CLASSES.BUTTON_PRIMARY} px-8 py-4 rounded text-xs font-black flex items-center gap-3 hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:grayscale disabled:scale-100 border border-white/20`}
        >
          <Save size={16} />
          SAVE_SYSTEM_CONFIG
        </button>
      </div>
    </>
  );
}
