'use client';

import React, { useState } from 'react';
import { Settings, Save, RefreshCw, Zap } from 'lucide-react';
import CyberSelect from '@/components/CyberSelect';
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
    String(minGapsForReview) !== String(config.minGapsForReview);

  return (
    <>
      <form id="settings-form" action={updateConfig} className="glass-card p-6 lg:p-8 space-y-8 cyber-border relative">
        <div className="space-y-4">
          <h3 className={`text-sm font-bold flex items-center gap-2 text-${THEME.COLORS.INTEL} uppercase tracking-wider`}>
            <Settings size={16} /> LLM_PROVIDER_ROUTING
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                Active Provider
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                Default Model ID
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                Evolution Mode
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                Optimization Policy
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                Max Tool Iterations
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold flex justify-between">
                <span>Circuit Breaker Threshold</span>
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
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
              Protected Resource Scopes
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                Reflection Frequency (msgs)
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                Strategic Review Interval (hrs)
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
              <label className="text-[10px] uppercase text-white/100 tracking-widest font-bold">
                Min Gaps for Review
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
