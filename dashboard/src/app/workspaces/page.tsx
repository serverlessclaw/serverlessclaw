'use client';

import { useEffect, useState } from 'react';
import {
  Loader2,
  FolderKanban,
  Plus,
  ChevronDown,
  ChevronUp,
  Users,
  X,
  UserPlus,
  Trash2,
  Edit2,
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import PageHeader from '@/components/PageHeader';
import { useTranslations } from '@/components/Providers/TranslationsProvider';
import { logger } from '@claw/core/lib/logger';

interface Member {
  id: string;
  role: string;
  channel: string;
}

interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  members: Member[];
  createdAt: number;
}

const ROLES = ['owner', 'admin', 'collaborator', 'observer'] as const;

function roleBadge(role: string) {
  switch (role) {
    case 'owner':
      return 'primary';
    case 'admin':
      return 'intel';
    case 'collaborator':
      return 'audit';
    case 'observer':
      return 'outline';
    default:
      return 'outline';
  }
}

export default function WorkspacesPage() {
  const { t } = useTranslations();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Member management state
  const [showInviteModal, setShowInviteModal] = useState<string | null>(null);
  const [inviteMemberId, setInviteMemberId] = useState('');
  const [inviteRole, setInviteRole] = useState<string>('collaborator');
  const [inviting, setInviting] = useState(false);

  const [editingMember, setEditingMember] = useState<{
    workspaceId: string;
    memberId: string;
    currentRole: string;
  } | null>(null);
  const [removingMember, setRemovingMember] = useState<{
    workspaceId: string;
    memberId: string;
  } | null>(null);

  const fetchWorkspaces = () => {
    fetch('/api/workspaces')
      .then((res) => res.json())
      .then((data) => setWorkspaces(data.workspaces ?? []))
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const createWorkspace = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const sessionRes = await fetch('/api/auth/session');
      const sessionData = await sessionRes.json();
      const userId = sessionData?.user?.id ?? 'anonymous';

      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, ownerId: userId }),
      });
      if (res.ok) {
        setShowModal(false);
        setNewName('');
        fetchWorkspaces();
      }
    } catch (e) {
      logger.error('Failed to create workspace:', e);
    } finally {
      setCreating(false);
    }
  };

  const inviteMember = async (workspaceId: string) => {
    if (!inviteMemberId.trim()) return;
    setInviting(true);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'invite',
          workspaceId,
          memberId: inviteMemberId,
          role: inviteRole,
          channel: 'dashboard',
        }),
      });
      if (res.ok) {
        setShowInviteModal(null);
        setInviteMemberId('');
        setInviteRole('collaborator');
        fetchWorkspaces();
      }
    } catch (e) {
      logger.error('Failed to invite member:', e);
    } finally {
      setInviting(false);
    }
  };

  const updateMemberRole = async (workspaceId: string, memberId: string, newRole: string) => {
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateRole', workspaceId, memberId, role: newRole }),
      });
      if (res.ok) {
        setEditingMember(null);
        fetchWorkspaces();
      }
    } catch (e) {
      logger.error('Failed to update member role:', e);
    }
  };

  const removeMember = async (workspaceId: string, memberId: string) => {
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', workspaceId, memberId }),
      });
      if (res.ok) {
        setRemovingMember(null);
        fetchWorkspaces();
      }
    } catch (e) {
      logger.error('Failed to remove member:', e);
    }
  };

  return (
    <div className="flex-1 space-y-10">
      <PageHeader
        titleKey="WORKSPACES_TITLE"
        subtitleKey="WORKSPACES_SUBTITLE"
        stats={
          <div className="flex gap-4">
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                TOTAL
              </Typography>
              <Badge variant="primary" className="px-4 py-1 font-black text-xs">
                {workspaces.length}
              </Badge>
            </div>
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                MEMBERS
              </Typography>
              <Badge variant="intel" className="px-4 py-1 font-black text-xs">
                {workspaces.reduce((acc, ws) => acc + ws.members.length, 0)}
              </Badge>
            </div>
          </div>
        }
      >
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setShowModal(true)}
        >
          {t('WORKSPACES_CREATE_WORKSPACE')}
        </Button>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 size={32} className="animate-spin text-violet-400" />
        </div>
      ) : workspaces.length > 0 ? (
        <div className="space-y-4">
          {workspaces.map((ws) => (
            <Card key={ws.id} variant="glass" padding="lg" className="border-border bg-card">
              <button
                onClick={() => toggle(ws.id)}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded bg-violet-500/10 text-violet-400 flex items-center justify-center">
                    <FolderKanban size={20} />
                  </div>
                  <div>
                    <Typography variant="caption" weight="bold" className="tracking-tight">
                      {ws.name}
                    </Typography>
                    <div className="flex items-center gap-3 mt-1">
                      <Typography
                        variant="mono"
                        color="muted"
                        className="flex items-center gap-1 text-[10px]"
                      >
                        <Users size={10} /> {ws.members.length} member
                        {ws.members.length !== 1 ? 's' : ''}
                      </Typography>
                    </div>
                  </div>
                </div>
                {expanded[ws.id] ? (
                  <ChevronUp size={16} className="text-muted-more" />
                ) : (
                  <ChevronDown size={16} className="text-muted-more" />
                )}
              </button>

              {expanded[ws.id] && (
                <div className="mt-4 pt-4 border-t border-border space-y-3">
                  {/* Invite Member Button */}
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<UserPlus size={12} />}
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowInviteModal(ws.id);
                      }}
                      className="text-[10px] uppercase tracking-widest"
                    >
                      Invite Member
                    </Button>
                  </div>

                  {/* Members List */}
                  {ws.members.map((m, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2 px-3 rounded bg-background/40 group"
                    >
                      <div className="flex items-center gap-3">
                        <Typography variant="mono" className="text-[11px]">
                          {m.id}
                        </Typography>
                        <Typography variant="mono" color="muted" className="text-[9px]">
                          {m.channel}
                        </Typography>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={roleBadge(m.role) as 'primary' | 'intel' | 'audit' | 'outline'}
                        >
                          {m.role}
                        </Badge>

                        {/* Action buttons - visible on hover, not for owner */}
                        {m.role !== 'owner' && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() =>
                                setEditingMember({
                                  workspaceId: ws.id,
                                  memberId: m.id,
                                  currentRole: m.role,
                                })
                              }
                              className="p-1 rounded hover:bg-background/80 text-muted hover:text-cyber-blue transition-colors"
                              title="Change role"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              onClick={() =>
                                setRemovingMember({ workspaceId: ws.id, memberId: m.id })
                              }
                              className="p-1 rounded hover:bg-red-500/10 text-muted hover:text-red-400 transition-colors"
                              title="Remove member"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card
          variant="solid"
          padding="lg"
          className="h-48 flex flex-col items-center justify-center opacity-20 border-dashed"
        >
          <FolderKanban size={32} className="mb-4" />
          <Typography variant="body" weight="normal">
            No workspaces found
          </Typography>
          <Typography variant="caption" color="muted" className="mt-2 block">
            Create a workspace to start collaborating.
          </Typography>
        </Card>
      )}

      {/* Create Workspace Modal */}
      {showModal && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-background border border-border p-6 rounded-lg w-full max-w-md shadow-premium"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h3">Create Workspace</Typography>
              <button onClick={() => setShowModal(false)}>
                <X size={18} className="text-muted-more" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <Input
                  label="Workspace Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="My Workspace"
                  className="w-full"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" size="sm" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={createWorkspace}
                  disabled={creating || !newName.trim()}
                >
                  {creating ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowInviteModal(null)}
        >
          <div
            className="bg-background border border-border p-6 rounded-lg w-full max-w-md shadow-premium"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h3">Invite Member</Typography>
              <button onClick={() => setShowInviteModal(null)}>
                <X size={18} className="text-muted-more" />
              </button>
            </div>
            <div className="space-y-4">
              <Input
                label="Member ID"
                value={inviteMemberId}
                onChange={(e) => setInviteMemberId(e.target.value)}
                placeholder="user-123 or agent-id"
                className="w-full"
              />
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-muted mb-2">
                  Role
                </label>
                <div className="flex gap-2 flex-wrap">
                  {ROLES.filter((r) => r !== 'owner').map((role) => (
                    <button
                      key={role}
                      onClick={() => setInviteRole(role)}
                      className={`
                        px-3 py-1.5 rounded text-[10px] uppercase tracking-widest font-bold transition-all
                        ${
                          inviteRole === role
                            ? 'bg-cyber-blue/10 text-cyber-blue border border-cyber-blue/30'
                            : 'bg-background/40 text-muted border border-border hover:bg-background/80'
                        }
                      `}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" size="sm" onClick={() => setShowInviteModal(null)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => inviteMember(showInviteModal)}
                  disabled={inviting || !inviteMemberId.trim()}
                >
                  {inviting ? 'Inviting...' : 'Invite'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      {editingMember && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setEditingMember(null)}
        >
          <div
            className="bg-background border border-border p-6 rounded-lg w-full max-w-md shadow-premium"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h3">Change Role</Typography>
              <button onClick={() => setEditingMember(null)}>
                <X size={18} className="text-muted-more" />
              </button>
            </div>
            <div className="space-y-4">
              <Typography variant="body" color="muted">
                Change role for <span className="font-bold">{editingMember.memberId}</span>
              </Typography>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-muted mb-2">
                  New Role
                </label>
                <div className="flex gap-2 flex-wrap">
                  {ROLES.filter((r) => r !== 'owner').map((role) => (
                    <button
                      key={role}
                      onClick={() =>
                        updateMemberRole(editingMember.workspaceId, editingMember.memberId, role)
                      }
                      className={`
                        px-3 py-1.5 rounded text-[10px] uppercase tracking-widest font-bold transition-all
                        ${
                          editingMember.currentRole === role
                            ? 'bg-cyber-blue/10 text-cyber-blue border border-cyber-blue/30'
                            : 'bg-background/40 text-muted border border-border hover:bg-background/80'
                        }
                      `}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" size="sm" onClick={() => setEditingMember(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Remove Member Confirmation */}
      {removingMember && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setRemovingMember(null)}
        >
          <div
            className="bg-background border border-red-500/30 p-6 rounded-lg w-full max-w-md shadow-premium"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h3" color="danger">
                Remove Member
              </Typography>
              <button onClick={() => setRemovingMember(null)}>
                <X size={18} className="text-muted-more" />
              </button>
            </div>
            <div className="space-y-4">
              <Typography variant="body" color="muted">
                Are you sure you want to remove{' '}
                <span className="font-bold">{removingMember.memberId}</span> from this workspace?
              </Typography>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" size="sm" onClick={() => setRemovingMember(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => removeMember(removingMember.workspaceId, removingMember.memberId)}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
