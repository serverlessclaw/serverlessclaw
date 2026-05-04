import { UserRole, Permission } from './types';

/**
 * Role-to-permission mapping.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.OWNER]: Object.values(Permission),
  [UserRole.ADMIN]: [
    Permission.AGENT_CREATE,
    Permission.AGENT_DELETE,
    Permission.AGENT_UPDATE,
    Permission.AGENT_VIEW,
    Permission.TASK_CREATE,
    Permission.TASK_CANCEL,
    Permission.TASK_VIEW,
    Permission.EVOLUTION_VIEW,
    Permission.EVOLUTION_APPROVE,
    Permission.EVOLUTION_TRIGGER,
    Permission.CONFIG_VIEW,
    Permission.CONFIG_UPDATE,
    Permission.WORKSPACE_MEMBERS,
    Permission.TRACE_VIEW,
    Permission.TRACE_DELETE,
    Permission.DASHBOARD_VIEW,
    Permission.DASHBOARD_ADMIN,
  ],
  [UserRole.MEMBER]: [
    Permission.AGENT_VIEW,
    Permission.TASK_CREATE,
    Permission.TASK_CANCEL,
    Permission.TASK_VIEW,
    Permission.EVOLUTION_VIEW,
    Permission.CONFIG_VIEW,
    Permission.TRACE_VIEW,
    Permission.DASHBOARD_VIEW,
  ],
  [UserRole.VIEWER]: [
    Permission.AGENT_VIEW,
    Permission.TASK_VIEW,
    Permission.EVOLUTION_VIEW,
    Permission.CONFIG_VIEW,
    Permission.TRACE_VIEW,
    Permission.DASHBOARD_VIEW,
  ],
};

/**
 * Permissions that are strictly scoped to workspace membership.
 */
export const WORKSPACE_SCOPED_PERMISSIONS = new Set([
  Permission.WORKSPACE_CREATE,
  Permission.WORKSPACE_DELETE,
  Permission.WORKSPACE_MEMBERS,
  Permission.AGENT_CREATE,
  Permission.AGENT_DELETE,
  Permission.AGENT_UPDATE,
  Permission.AGENT_VIEW,
  Permission.TASK_CREATE,
  Permission.TASK_CANCEL,
  Permission.TASK_VIEW,
  Permission.EVOLUTION_VIEW,
  Permission.EVOLUTION_APPROVE,
  Permission.EVOLUTION_TRIGGER,
  Permission.CONFIG_VIEW,
  Permission.CONFIG_UPDATE,
  Permission.TRACE_VIEW,
  Permission.TRACE_DELETE,
  Permission.DASHBOARD_VIEW,
]);
