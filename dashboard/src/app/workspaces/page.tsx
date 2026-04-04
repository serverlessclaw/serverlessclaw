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
      console.error('Failed to create workspace:', e);
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
      console.error('Failed to invite member:', e);
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
      console.error('Failed to update member role:', e);
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
      console.error('Failed to remove member:', e);
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-10 space-y-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-violet-500/5 via-transparent to-transparent">
      <header className="flex flex-col lg:flex-row lg:justify-between lg:items-end border-b border-white/5 pb-6 gap-6">
        <div>
          <Typography variant="h2" color="white" glow uppercase>
            Workspaces
          </Typography>
          <Typography variant="body" color="muted" className="mt-2 block">
            Team collaboration environments and access control.
          </Typography>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setShowModal(true)}
        >
          Create Workspace
        </Button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 size={32} className="animate-spin text-violet-400" />
        </div>
      ) : workspaces.length > 0 ? (
        <div className="space-y-4">
          {workspaces.map((ws) => (
            <Card key={ws.id} variant="glass" padding="lg" className="border-white/10 bg-black/40">
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
                  <ChevronUp size={16} className="text-white/40" />
                ) : (
                  <ChevronDown size={16} className="text-white/40" />
                )}
              </button>

              {expanded[ws.id] && (
                <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
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
                      className="flex items-center justify-between py-2 px-3 rounded bg-white/[0.02] group"
                    >
                      <div className="flex items-center gap-3">
                        <Typography variant="mono" color="white" className="text-[11px]">
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
                              className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-cyber-blue transition-colors"
                              title="Change role"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              onClick={() =>
                                setRemovingMember({ workspaceId: ws.id, memberId: m.id })
                              }
                              className="p-1 rounded hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors"
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
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-[#1a1a2e] border border-white/10 p-6 rounded-lg w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h3" color="white">
                Create Workspace
              </Typography>
              <button onClick={() => setShowModal(false)}>
                <X size={18} className="text-white/40" />
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
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowInviteModal(null)}
        >
          <div
            className="bg-[#1a1a2e] border border-white/10 p-6 rounded-lg w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h3" color="white">
                Invite Member
              </Typography>
              <button onClick={() => setShowInviteModal(null)}>
                <X size={18} className="text-white/40" />
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
                <label className="block text-[10px] uppercase tracking-widest font-bold text-white/40 mb-2">
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
                            ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                            : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
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
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setEditingMember(null)}
        >
          <div
            className="bg-[#1a1a2e] border border-white/10 p-6 rounded-lg w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h3" color="white">
                Change Role
              </Typography>
              <button onClick={() => setEditingMember(null)}>
                <X size={18} className="text-white/40" />
              </button>
            </div>
            <div className="space-y-4">
              <Typography variant="body" color="muted">
                Change role for{' '}
                <span className="text-white font-bold">{editingMember.memberId}</span>
              </Typography>
              <div>
                <label className="block text-[10px] uppercase tracking-widest font-bold text-white/40 mb-2">
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
                            ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                            : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
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
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setRemovingMember(null)}
        >
          <div
            className="bg-[#1a1a2e] border border-red-500/30 p-6 rounded-lg w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <Typography variant="h3" color="danger">
                Remove Member
              </Typography>
              <button onClick={() => setRemovingMember(null)}>
                <X size={18} className="text-white/40" />
              </button>
            </div>
            <div className="space-y-4">
              <Typography variant="body" color="muted">
                Are you sure you want to remove{' '}
                <span className="text-white font-bold">{removingMember.memberId}</span> from this
                workspace?
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
    </main>
  );
}
