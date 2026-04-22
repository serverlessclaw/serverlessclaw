'use client';

import React, { useState, useTransition } from 'react';
import { Plus, Loader2, Zap, Trash2 } from 'lucide-react';
import { deleteMCPServer, registerMCPServer } from '../../app/capabilities/actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Button from '../ui/Button';
import Typography from '../ui/Typography';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import CyberConfirm from '../CyberConfirm';

interface MCPTabProps {
  mcpServers: Record<string, string | { command: string; env?: Record<string, string> }>;
  searchQuery: string;
}

export default function MCPTab({ mcpServers, searchQuery }: MCPTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newBridge, setNewBridge] = useState({ name: '', command: '', env: '{}' });
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant: 'danger' | 'warning';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    variant: 'warning',
  });

  const handleRemoveMCPServer = (name: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Bridge Deactivation',
      message: `You are about to unregister the skill bridge '${name}'. All associated tools will be removed from the system. Proceed?`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        startTransition(async () => {
          const result = await deleteMCPServer(name);
          if (result?.error) {
            toast.error(`Failed to deactivate bridge: ${result.error}`);
          } else {
            toast.success(`Skill bridge '${name}' deactivated`);
            router.refresh();
          }
        });
      },
    });
  };

  const handleAddBridge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBridge.name || !newBridge.command) {
      toast.error('Bridge name and command are mandatory');
      return;
    }

    startTransition(async () => {
      const result = await registerMCPServer(newBridge.name, newBridge.command, newBridge.env);
      if (result?.error) {
        toast.error(`Registration failed: ${result.error}`);
      } else {
        toast.success(`Neural bridge '${newBridge.name}' established`);
        setNewBridge({ name: '', command: '', env: '{}' });
        router.refresh();
      }
    });
  };

  const filteredServers = Object.entries(mcpServers).filter(([name, config]) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const cmd = typeof config === 'string' ? config : config.command;
    return name.toLowerCase().includes(query) || cmd.toLowerCase().includes(query);
  });

  return (
    <section className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <CyberConfirm
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* New Bridge Form */}
      <Card
        variant="solid"
        padding="lg"
        className="border-border bg-input/50 bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-cyber-blue/5 via-transparent to-transparent shadow-premium"
      >
        <h4 className="text-[12px] font-black tracking-[0.4em] text-cyber-blue/80 mb-6 flex items-center gap-2">
          <Plus size={16} /> Establish new bridge
        </h4>
        <form onSubmit={handleAddBridge} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <Typography
              variant="mono"
              weight="black"
              color="muted"
              className="text-[9px] tracking-widest ml-1 opacity-60 uppercase"
            >
              Bridge identifier
            </Typography>
            <input
              type="text"
              placeholder="e.g. brave-search"
              value={newBridge.name}
              onChange={(e) => setNewBridge({ ...newBridge, name: e.target.value })}
              className="w-full bg-background border border-border focus:border-cyber-blue/40 rounded-sm p-3 text-[10px] font-mono outline-none text-foreground transition-all placeholder:text-muted-more"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Typography
              variant="mono"
              weight="black"
              color="muted"
              className="text-[9px] tracking-widest ml-1 opacity-60 uppercase"
            >
              Activation command
            </Typography>
            <input
              type="text"
              placeholder="npx -y @modelcontextprotocol/server-brave-search"
              value={newBridge.command}
              onChange={(e) => setNewBridge({ ...newBridge, command: e.target.value })}
              className="w-full bg-background border border-border focus:border-cyber-blue/40 rounded-sm p-3 text-[10px] font-mono outline-none text-foreground transition-all placeholder:text-muted-more"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Typography
              variant="mono"
              weight="black"
              color="muted"
              className="text-[9px] tracking-widest ml-1 opacity-60 uppercase"
            >
              Environment variables (JSON)
            </Typography>
            <textarea
              placeholder='{ "BRAVE_API_KEY": "..." }'
              value={newBridge.env}
              onChange={(e) => setNewBridge({ ...newBridge, env: e.target.value })}
              rows={1}
              className="w-full bg-background border border-border focus:border-cyber-blue/40 rounded-sm p-3 text-[10px] font-mono outline-none text-foreground transition-all placeholder:text-muted-more resize-none"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={isPending}
              variant="primary"
              className="w-full h-[46px] shadow-premium"
              icon={isPending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
            >
              Initiate bridge
            </Button>
          </div>
        </form>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredServers.map(([name, config]) => (
          <Card
            variant="solid"
            padding="md"
            key={name}
            className="group hover:border-red-500/20 transition-all relative overflow-hidden bg-input/50"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyber-blue/5 blur-3xl -mr-16 -mt-16 pointer-events-none" />
            <div className="flex justify-between items-start mb-6 relative">
              <div>
                <Typography
                  variant="body"
                  weight="black"
                  color="white"
                  className="tracking-[0.2em] mb-1"
                >
                  {name}
                </Typography>
                <Badge variant="primary" className="bg-cyber-blue/10 text-cyber-blue/60 font-bold">
                  Bridge active
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveMCPServer(name)}
                className="opacity-0 group-hover:opacity-100 border border-border bg-background hover:bg-red-500 hover:text-white p-2"
                icon={<Trash2 size={14} />}
              />
            </div>
            <div className="space-y-4 relative">
              <p className="text-[10px] font-mono text-muted-foreground opacity-60 font-black break-all bg-background p-3 rounded-sm border border-border leading-relaxed">
                {typeof config === 'string' ? config : config.command}
              </p>
              {typeof config !== 'string' && config.env && (
                <div className="flex flex-wrap gap-2">
                  {Object.keys(config.env).map((key) => (
                    <Badge
                      key={key}
                      variant="primary"
                      className="border-cyber-blue/20 text-cyber-blue/60 font-bold py-0 text-[8px]"
                    >
                      {key}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Card>
        ))}
        {filteredServers.length === 0 && (
          <Card
            variant="solid"
            padding="lg"
            className="col-span-full py-20 text-center border-dashed border-border bg-input/20"
          >
            <Typography variant="caption" color="muted" uppercase className="tracking-[0.5em]">
              No active skill bridges detected.
            </Typography>
          </Card>
        )}
      </div>
    </section>
  );
}
