'use client';

import { useEffect, useState } from 'react';
import { Loader2, FolderKanban, Plus, ChevronDown, ChevronUp, Users } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

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

function roleBadge(role: string) {
  switch (role) {
    case 'owner': return 'primary';
    case 'admin': return 'intel';
    case 'collaborator': return 'audit';
    case 'observer': return 'outline';
    default: return 'outline';
  }
}

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/workspaces')
      .then((res) => res.json())
      .then((data) => setWorkspaces(data.workspaces ?? []))
      .catch(() => setWorkspaces([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

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
        <Button variant="primary" size="sm" icon={<Plus size={14} />}>
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
                    <Typography variant="caption" weight="bold" className="tracking-tight">{ws.name}</Typography>
                    <div className="flex items-center gap-3 mt-1">
                      <Typography variant="mono" color="muted" className="flex items-center gap-1 text-[10px]">
                        <Users size={10} /> {ws.members.length} member{ws.members.length !== 1 ? 's' : ''}
                      </Typography>
                    </div>
                  </div>
                </div>
                {expanded[ws.id] ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
              </button>

              {expanded[ws.id] && (
                <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
                  {ws.members.map((m, i) => (
                    <div key={i} className="flex items-center justify-between py-2 px-3 rounded bg-white/[0.02]">
                      <Typography variant="mono" color="white" className="text-[11px]">{m.id}</Typography>
                      <div className="flex items-center gap-2">
                        <Badge variant={roleBadge(m.role) as 'primary' | 'intel' | 'audit' | 'outline'}>{m.role}</Badge>
                        <Typography variant="mono" color="muted" className="text-[9px]">{m.channel}</Typography>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card variant="solid" padding="lg" className="h-48 flex flex-col items-center justify-center opacity-20 border-dashed">
          <FolderKanban size={32} className="mb-4" />
          <Typography variant="body" weight="normal">No workspaces found</Typography>
          <Typography variant="caption" color="muted" className="mt-2 block">Create a workspace to start collaborating.</Typography>
        </Card>
      )}
    </main>
  );
}
