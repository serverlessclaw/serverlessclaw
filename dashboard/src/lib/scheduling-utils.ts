export interface Schedule {
  Name: string;
  State: string;
  Description?: string;
  CreationDate?: string;
  ScheduleExpression: string;
  Target?: {
    Input?: string;
  };
}

export type ScheduleCategory = 'system-infra' | 'agent-goal' | 'user-created';

export interface ScheduleInfo {
  purpose: string;
  category: ScheduleCategory;
}

/**
 * Derives purpose and category from a schedule object.
 */
export const getScheduleInfo = (schedule: Schedule): ScheduleInfo => {
  const name = schedule.Name;
  const input = schedule.Target?.Input;

  let payload: Record<string, unknown> = {};
  try {
    payload = input ? JSON.parse(input) : {};
  } catch {
    // ignore parse errors
  }

  if (name.startsWith('MCPWarmup')) {
    const servers = Array.isArray(payload.servers) ? (payload.servers as string[]) : [];
    const serverList = servers.length > 0 ? servers.join(', ') : 'MCP servers';
    const priority = name.includes('Critical')
      ? 'critical'
      : name.includes('LowPriority')
        ? 'low priority'
        : 'standard';
    return {
      purpose: `Keeps ${serverList} warm to prevent cold starts (${priority})`,
      category: 'system-infra',
    };
  }

  if (name.startsWith('ConcurrencySchedule') || name.startsWith('Concurrency')) {
    return {
      purpose: 'Monitors Lambda concurrent execution usage — alerts at 80% utilization',
      category: 'system-infra',
    };
  }

  if (name.startsWith('RecoverySchedule') || name.startsWith('Recovery')) {
    return {
      purpose: "Dead man's switch — deep health checks and emergency rollback",
      category: 'system-infra',
    };
  }

  if (name.startsWith('StrategicReviewSchedule') || name.includes('STRATEGIC_REVIEW')) {
    return {
      purpose: 'Strategic planner autonomous review and evolution cycle',
      category: 'agent-goal',
    };
  }

  if (payload.agentId && payload.agentId !== 'SYSTEM') {
    return {
      purpose: schedule.Description || `Proactive goal for ${payload.agentId}`,
      category: 'agent-goal',
    };
  }

  return {
    purpose: schedule.Description || 'User or agent-created schedule',
    category: 'user-created',
  };
};

export const CATEGORY_BADGE: Record<ScheduleCategory, { label: string; className: string }> = {
  'system-infra': {
    label: 'SYSTEM INFRA',
    className: 'bg-white/5 text-white/50 border-white/10',
  },
  'agent-goal': {
    label: 'AGENT GOAL',
    className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
  'user-created': {
    label: 'USER',
    className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  },
};

/**
 * Formats AWS Schedule expressions for human readability.
 */
export const formatFrequency = (expression?: string) => {
  if (!expression) return 'Unknown';
  if (expression.startsWith('rate(')) {
    const match = expression.match(/rate\((\d+)\s+(\w+)\)/);
    if (match) {
      const [, value, unit] = match;
      const unitShort = unit.endsWith('s') ? unit.slice(0, -1) : unit;
      return `Every ${value} ${unitShort}${parseInt(value) > 1 ? 's' : ''}`;
    }
  }
  if (expression.startsWith('cron(')) return 'Recurring (Cron)';
  if (expression.startsWith('at(')) return 'One-time (At)';
  return expression;
};

/**
 * Estimates the next run time for rate expressions.
 */
export const getNextRun = (schedule: Schedule) => {
  if (schedule.State !== 'ENABLED') return 'Paused';
  if (!schedule.CreationDate || !schedule.ScheduleExpression) return 'Unknown';

  const expression = schedule.ScheduleExpression;
  const created = schedule.CreationDate ? new Date(schedule.CreationDate).getTime() : 0;
  const now = Date.now();

  if (expression.startsWith('rate(')) {
    const match = expression.match(/rate\((\d+)\s+(\w+)\)/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      let msPerUnit = 60 * 1000;
      if (unit.startsWith('hour')) msPerUnit = 60 * 60 * 1000;
      if (unit.startsWith('day')) msPerUnit = 24 * 60 * 60 * 1000;
      const interval = value * msPerUnit;
      const elapsed = now - created;
      const nextRunTime = created + (Math.floor(elapsed / interval) + 1) * interval;
      return new Date(nextRunTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  if (expression.startsWith('at(')) {
    const match = expression.match(/at\((.+)\)/);
    if (match) {
      const atDate = new Date(match[1]);
      if (atDate.getTime() < now) return 'Executed';
      return atDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  return 'Calculated on trigger';
};
