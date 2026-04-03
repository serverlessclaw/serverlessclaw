import { ApiError, requireEnum, requireFields, withApiHandler } from '@/lib/api-handler';
import type { InviteMemberInput, MemberType, WorkspaceRole } from '@claw/core/lib/types/workspace';

export const dynamic = 'force-dynamic';

interface WorkspaceData {
  workspaceId: string;
  name?: string;
  ownerId?: string;
  members?: Array<{ id: string; role: string; channel: string }>;
  createdAt?: number;
}

const WORKSPACE_ROLES: WorkspaceRole[] = ['owner', 'admin', 'collaborator', 'observer'];
const MEMBER_TYPES: MemberType[] = ['human', 'agent'];

function asNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(`${fieldName} must be a non-empty string`, 400);
  }
  return value;
}

async function fetchWorkspacesFromConfig(): Promise<WorkspaceData[]> {
  const { ConfigManager } = await import('@claw/core/lib/registry/config');
  const WORKSPACE_INDEX = 'workspace_index';
  const index = ((await ConfigManager.getRawConfig(WORKSPACE_INDEX)) as string[]) ?? [];
  const workspaces: WorkspaceData[] = [];
  for (const workspaceId of index) {
    const data = (await ConfigManager.getRawConfig(`workspace:${workspaceId}`)) as WorkspaceData | null;
    if (data) {
      workspaces.push({
        workspaceId: data.workspaceId,
        name: data.name ?? 'Unnamed',
        ownerId: data.ownerId ?? '',
        members: data.members ?? [],
        createdAt: data.createdAt ?? 0,
      });
    }
  }
  return workspaces;
}

export async function GET() {
  try {
    const workspaces = await fetchWorkspacesFromConfig();
    // Map to the format expected by the frontend
    const formatted = workspaces.map((w) => ({
      id: w.workspaceId,
      name: w.name,
      ownerId: w.ownerId,
      members: w.members,
      createdAt: w.createdAt,
    }));
    return Response.json({ workspaces: formatted });
  } catch (e) {
    console.error('Error fetching workspaces:', e);
    return Response.json({ workspaces: [] });
  }
}

export const POST = withApiHandler(async (body: Record<string, unknown>) => {
  // Handle member management actions
  if (body.action === 'invite') {
    requireFields(body, 'workspaceId', 'memberId', 'role');
    const workspaceId = asNonEmptyString(body.workspaceId, 'workspaceId');
    const memberId = asNonEmptyString(body.memberId, 'memberId');
    const role = body.role;
    requireEnum(role, WORKSPACE_ROLES, 'role');
    const memberType = body.type ?? 'human';
    requireEnum(memberType, MEMBER_TYPES, 'type');
    const input: InviteMemberInput = {
      workspaceId,
      memberId,
      type: memberType,
      displayName:
        typeof body.displayName === 'string' && body.displayName.trim().length > 0
          ? body.displayName
          : memberId,
      role,
    };

    const { inviteMember } = await import('@claw/core/lib/memory/workspace-operations');
    await inviteMember(workspaceId, 'dashboard', input);
    return { success: true };
  }
  
  if (body.action === 'updateRole') {
    requireFields(body, 'workspaceId', 'memberId', 'role');
    const workspaceId = asNonEmptyString(body.workspaceId, 'workspaceId');
    const memberId = asNonEmptyString(body.memberId, 'memberId');
    const role = body.role;
    requireEnum(role, WORKSPACE_ROLES, 'role');

    const { updateMemberRole } = await import('@claw/core/lib/memory/workspace-operations');
    await updateMemberRole(workspaceId, 'dashboard', memberId, role);
    return { success: true };
  }
  
  if (body.action === 'remove') {
    requireFields(body, 'workspaceId', 'memberId');
    const workspaceId = asNonEmptyString(body.workspaceId, 'workspaceId');
    const memberId = asNonEmptyString(body.memberId, 'memberId');

    const { removeMember } = await import('@claw/core/lib/memory/workspace-operations');
    await removeMember(workspaceId, 'dashboard', memberId);
    return { success: true };
  }
  
  // Default: create workspace
  requireFields(body, 'name', 'ownerId');
  const name = asNonEmptyString(body.name, 'name');
  const ownerId = asNonEmptyString(body.ownerId, 'ownerId');

  const { createWorkspace } = await import('@claw/core/lib/memory/workspace-operations');
  const workspace = await createWorkspace({
    name,
    ownerId,
    ownerDisplayName: (body.ownerDisplayName as string) ?? 'Unknown',
  });
  return { success: true, id: workspace.workspaceId };
});
