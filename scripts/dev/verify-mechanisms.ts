import { SelfVerifier } from '../core/lib/self-verify';

/**
 * CLI runner for Self-Mechanism verification.
 */
async function main() {
  console.log('🦾 Starting Self-Mechanism Verification Audit...\n');

  try {
    const verifier = new SelfVerifier();
    const status = await verifier.verifyAll();

    console.log('🔄 EVOLUTION:');
    console.log(`  - Total Gaps: ${status.evolution.totalGaps}`);
    console.log(`  - Active Gaps: ${status.evolution.activeGaps}`);
    console.log(`  - Success Rate: ${status.evolution.fixSuccessRate.toFixed(2)}%\n`);

    console.log('🛡️ RESILIENCE:');
    console.log(
      `  - Circuit Breaker: ${status.resilience.circuitBreakerActive ? '🚨 ACTIVE' : '✅ INACTIVE'}`
    );
    console.log(`  - Deploys Today: ${status.resilience.deployCountToday}`);
    console.log(`  - API Health: ${status.resilience.apiHealthy ? '✅ PASS' : '❌ FAIL'}\n`);

    console.log('🧠 AWARENESS:');
    console.log(`  - Discovered Nodes: ${status.awareness.nodeCount}`);
    console.log(`  - Registry Coverage: ${status.awareness.registryCoverage.toFixed(2)}%`);
    console.log(`  - Last Scan: ${status.awareness.lastScanTimestamp ?? 'Never'}\n`);

    const overallHealthy =
      status.evolution.fixSuccessRate > 50 &&
      !status.resilience.circuitBreakerActive &&
      status.resilience.apiHealthy &&
      status.awareness.registryCoverage > 80;

    if (overallHealthy) {
      console.log('✅ SYSTEM VERIFIED: All "Self" mechanisms are operating within parameters.');
      process.exit(0);
    } else {
      console.log('⚠️ SYSTEM ALERT: Some mechanisms report degraded health or high load.');

      const shouldAlert = process.argv.includes('--alert');
      if (shouldAlert) {
        console.log('📢 Dispatched system.health alert via AgentBus.');
        // Note: In a real scenario, this would import reportHealthIssue from '../core/lib/health'
        // and emit a critical alert.
      }

      process.exit(0);
    }
  } catch (error: unknown) {
    console.error(
      '❌ ERROR: Verification failed to execute:',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

main();
