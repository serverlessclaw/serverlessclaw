/**
 * Audit Protocol Definitions
 */

export interface AuditSilo {
  name: string;
  perspective: string;
  angle: string;
  keyConcepts: string[];
}

export interface AuditFinding {
  silo: string;
  expected: string;
  actual: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  recommendation: string;
}

export interface AuditReport {
  auditId: string;
  timestamp: number;
  triggerType: string;
  silosReviewed: string[];
  findings: AuditFinding[];
  summary: string;
}

export const AUDIT_SILOS: AuditSilo[] = [
  {
    name: 'Spine',
    perspective: 'How does the system ensure the signal never dies?',
    angle:
      'Audit the journey of events through the asynchronous backbone. Look for "dead ends," race conditions in the distributed lock, and the effectiveness of Conflict Resolution Timeouts during agent handoffs.',
    keyConcepts: [
      'Event routing',
      'recursion limits',
      'strategic tie-break logic',
      'adapter normalization',
    ],
  },
  {
    name: 'Hand',
    perspective: 'How effectively can the system manipulate its environment?',
    angle:
      'Explore the boundary between agent intent and tool execution. Review the "creative" prompts of personas like Coder and Planner and the reliability of the "Unified MCP Multiplexer" under heavy load.',
    keyConcepts: [
      'Prompt engineering',
      'skill discovery',
      'tool schema consistency',
      'MCP resource efficiency',
    ],
  },
  {
    name: 'Shield',
    perspective: 'What happens when things break or the perimeter is breached?',
    angle:
      'Stress-test the "survival instincts" of the platform. Audit IAM least-privilege policies and the effectiveness of Proactive Trunk Evolution for autonomous infrastructure changes.',
    keyConcepts: [
      'Safety guardrails',
      'recovery logic',
      'Class C blast-radius limits',
      'real-time security signaling',
    ],
  },
  {
    name: 'Brain',
    perspective: 'How does the system maintain its "sense of self" and history?',
    angle:
      'Investigate the continuity of context across multi-turn sessions. Audit the multi-tenant Workspace isolation and the efficiency of the Hybrid Memory Model for high-speed recall and strategic reflection.',
    keyConcepts: [
      'Tiered retention',
      'Vector RAG efficiency',
      'RBAC',
      'strategic gap identification',
    ],
  },
  {
    name: 'Eye',
    perspective: "Is the system's view of itself accurate?",
    angle:
      'Audit the feedback loops. Review the Playwright E2E suite and the LLM-as-a-Judge semantic evaluation layer to ensure "truth" matches backend state.',
    keyConcepts: [
      'Dashboard tracing accuracy',
      'LLM-as-a-Judge consistency',
      'build-monitor signaling',
      'autonomous test suite evolution',
    ],
  },
  {
    name: 'Scales',
    perspective: 'Is the system grading its own homework too leniently?',
    angle:
      'Audit the SafetyEngine and the LLM-as-a-Judge semantic evaluation layer to ensure TrustScore calculations are resistant to artificial inflation. Verify that failures accurately and immediately penalize the trust score.',
    keyConcepts: [
      'Trust decay rates',
      'metric gaming',
      'false-positive evaluations',
      'mode-shift thrashing',
    ],
  },
  {
    name: 'Metabolism',
    perspective:
      'How can we refactor for a leaner, more consistent, and efficient codebase? What is strictly necessary?',
    angle:
      'Audit the workspace for generated sprawl and over-engineered implementations. Act as a critic on necessity to prevent overgrowth. Identify redundant tools, overlapping logic, "dark" code that is never executed, and overly thick abstraction layers. Prioritize consolidating patterns and ensuring that code additions pull their weight.',
    keyConcepts: [
      'Necessity critique',
      'bloat prevention',
      'pattern consolidation',
      'tool pruning',
      'cyclomatic complexity reduction',
      'semantic compression',
    ],
  },
];
