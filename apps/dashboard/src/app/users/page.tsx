'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  Mail,
  Clock,
  Trash2,
  Edit2,
  ShieldCheck,
  Search,
  Filter,
  X,
} from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import PageHeader from '@/components/PageHeader';
import { logger } from '@claw/core/lib/logger';

interface UserIdentity {
  userId: string;
  displayName: string;
  email?: string;
  role: string;
  createdAt: number;
  lastActiveAt: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<UserIdentity | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    userId: '',
    password: '',
    displayName: '',
    email: '',
    role: 'member',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) {
      logger.error('Failed to fetch users:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setShowCreateModal(false);
        setFormData({ userId: '', password: '', displayName: '', email: '', role: 'member' });
        fetchUsers();
      }
    } catch (e) {
      logger.error('Failed to create user:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditModal) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: showEditModal.userId,
          displayName: formData.displayName,
          email: formData.email,
          role: formData.role,
        }),
      });
      if (res.ok) {
        setShowEditModal(null);
        fetchUsers();
      }
    } catch (e) {
      logger.error('Failed to update user:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.userId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 space-y-10">
      <PageHeader
        titleKey="USER_MANAGEMENT"
        subtitleKey="USER_MANAGEMENT_SUBTITLE"
        stats={
          <div className="flex gap-4">
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                TOTAL_USERS
              </Typography>
              <Badge variant="primary" className="px-4 py-1 font-black text-xs">
                {users.length}
              </Badge>
            </div>
            <div className="flex flex-col items-center text-center">
              <Typography
                variant="mono"
                color="muted"
                className="text-[10px] uppercase tracking-widest opacity-40 mb-1"
              >
                ADMINS
              </Typography>
              <Badge variant="intel" className="px-4 py-1 font-black text-xs">
                {users.filter((u) => u.role === 'admin' || u.role === 'owner').length}
              </Badge>
            </div>
          </div>
        }
      >
        <Button
          variant="primary"
          size="sm"
          icon={<UserPlus size={14} />}
          onClick={() => {
            setFormData({ userId: '', password: '', displayName: '', email: '', role: 'member' });
            setShowCreateModal(true);
          }}
        >
          Provision User
        </Button>
      </PageHeader>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 glass-card p-4 border-border/40 bg-card/20">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-more" size={16} />
          <input
            type="text"
            placeholder="Search by ID, Name or Email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background/40 border border-border/50 rounded-lg pl-10 pr-4 py-2 text-sm focus:border-cyber-blue/50 outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<Filter size={14} />}>
            Filter
          </Button>
        </div>
      </div>

      {/* Users Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 glass-card border-border/20 animate-pulse" />
          ))
        ) : filteredUsers.length > 0 ? (
          filteredUsers.map((user) => (
            <Card
              key={user.userId}
              variant="glass"
              padding="lg"
              className="group border-border/40 bg-card/40 hover:bg-card/60 transition-all hover:border-cyber-blue/30"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                  <div
                    className={`w-12 h-12 rounded-lg flex items-center justify-center border ${user.role === 'admin' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-cyber-blue/10 border-cyber-blue/30 text-cyber-blue'}`}
                  >
                    {user.role === 'admin' ? <ShieldCheck size={24} /> : <Users size={24} />}
                  </div>
                  <div>
                    <Typography variant="h3" className="text-base truncate max-w-[150px]">
                      {user.displayName}
                    </Typography>
                    <Typography
                      variant="mono"
                      color="muted"
                      className="text-[10px] uppercase opacity-50"
                    >
                      ID: {user.userId}
                    </Typography>
                  </div>
                </div>
                <Badge
                  variant={user.role === 'admin' || user.role === 'owner' ? 'intel' : 'outline'}
                  className="uppercase font-black text-[9px] tracking-tighter"
                >
                  {user.role}
                </Badge>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 text-muted-more">
                  <Mail size={14} />
                  <Typography variant="caption" className="text-xs truncate">
                    {user.email || 'No email registered'}
                  </Typography>
                </div>
                <div className="flex items-center gap-3 text-muted-more">
                  <Clock size={14} />
                  <Typography variant="caption" className="text-xs">
                    Active: {new Date(user.lastActiveAt).toLocaleDateString()}
                  </Typography>
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-border/20 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  icon={<Edit2 size={12} />}
                  onClick={() => {
                    setFormData({
                      userId: user.userId,
                      password: '',
                      displayName: user.displayName,
                      email: user.email || '',
                      role: user.role,
                    });
                    setShowEditModal(user);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 size={12} />}
                  className="text-red-400 hover:text-red-500 hover:bg-red-500/10"
                ></Button>
              </div>
            </Card>
          ))
        ) : (
          <div className="col-span-full h-64 flex flex-col items-center justify-center border-2 border-dashed border-border/20 rounded-2xl opacity-40">
            <Users size={48} className="mb-4" />
            <Typography variant="h3">No entities found</Typography>
          </div>
        )}
      </div>

      {/* Provision User Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
          onClick={() => setShowCreateModal(false)}
        >
          <Card
            variant="solid"
            className="w-full max-w-lg shadow-premium animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-cyber-green/10 text-cyber-green flex items-center justify-center border border-cyber-green/30">
                  <UserPlus size={20} />
                </div>
                <div>
                  <Typography variant="h2" uppercase glow>
                    Provision_Identity
                  </Typography>
                  <Typography variant="mono" color="muted" className="text-[10px] uppercase">
                    New access token creation
                  </Typography>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-2 hover:bg-foreground/5 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Unique User ID"
                  placeholder="e.g. jdoe_01"
                  value={formData.userId}
                  onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                  required
                />
                <Input
                  label="Claw Keyphrase (Password)"
                  type="password"
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                />
              </div>

              <Input
                label="Display Name"
                placeholder="John Doe"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />

              <Input
                label="Email Address"
                type="email"
                placeholder="john@acme.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-black text-muted block ml-1">
                  Access_Level
                </label>
                <div className="flex gap-2">
                  {['member', 'admin'].map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setFormData({ ...formData, role })}
                      className={`flex-1 py-3 px-4 rounded border font-mono text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${formData.role === role ? 'bg-cyber-blue/20 border-cyber-blue text-cyber-blue shadow-[0_0_15px_rgba(0,186,255,0.2)]' : 'bg-background/40 border-border hover:bg-background/60 text-muted'}`}
                    >
                      {role === 'admin' ? <Shield size={14} /> : <Users size={14} />}
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-6 flex gap-3">
                <Button variant="ghost" fullWidth onClick={() => setShowCreateModal(false)}>
                  Abort
                </Button>
                <Button variant="primary" fullWidth type="submit" loading={submitting}>
                  Execute Provisioning
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && (
        <div
          className="fixed inset-0 bg-background/60 backdrop-blur-md flex items-center justify-center z-50 p-4"
          onClick={() => setShowEditModal(null)}
        >
          <Card
            variant="solid"
            className="w-full max-w-lg shadow-premium animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-cyber-blue/10 text-cyber-blue flex items-center justify-center border border-cyber-blue/30">
                  <Edit2 size={20} />
                </div>
                <div>
                  <Typography variant="h2" uppercase glow>
                    Modify_Identity
                  </Typography>
                  <Typography variant="mono" color="muted" className="text-[10px] uppercase">
                    Updating {showEditModal.userId}
                  </Typography>
                </div>
              </div>
              <button
                onClick={() => setShowEditModal(null)}
                className="p-2 hover:bg-foreground/5 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-6">
              <Input
                label="Display Name"
                placeholder="John Doe"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />

              <Input
                label="Email Address"
                type="email"
                placeholder="john@acme.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />

              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-black text-muted block ml-1">
                  Access_Level
                </label>
                <div className="flex gap-2">
                  {['member', 'admin'].map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setFormData({ ...formData, role })}
                      className={`flex-1 py-3 px-4 rounded border font-mono text-[11px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${formData.role === role ? 'bg-cyber-blue/20 border-cyber-blue text-cyber-blue shadow-[0_0_15px_rgba(0,186,255,0.2)]' : 'bg-background/40 border-border hover:bg-background/60 text-muted'}`}
                    >
                      {role === 'admin' ? <Shield size={14} /> : <Users size={14} />}
                      {role}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-6 flex gap-3">
                <Button variant="ghost" fullWidth onClick={() => setShowEditModal(null)}>
                  Abort
                </Button>
                <Button variant="primary" fullWidth type="submit" loading={submitting}>
                  Confirm Changes
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
