'use client';

import React, { useState } from 'react';
import { Gavel, MessageSquare, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import Typography from '@/components/ui/Typography';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

interface CouncilJudgePanelProps {
  requestId: string;
  onJudgement: (decision: 'APPROVE' | 'REJECT' | 'OVERRULE', directive: string) => void;
}

export default function CouncilJudgePanel({ requestId, onJudgement }: CouncilJudgePanelProps) {
  const [directive, setDirective] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAction = async (decision: 'APPROVE' | 'REJECT' | 'OVERRULE') => {
    setIsSubmitting(true);
    // In a real app index, this would call an API
    onJudgement(decision, directive);
    setIsSubmitting(false);
  };

  return (
    <Card variant="solid" className="bg-cyber-blue/5 border-cyber-blue/30 mt-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="flex-1 space-y-4">
          <div className="flex items-center gap-2 text-cyber-blue">
            <Gavel size={20} />
            <Typography variant="h3" uppercase glow>Human_Judge_Intervention</Typography>
          </div>
          
          <Typography variant="body" color="muted" className="text-sm">
            As the Human-in-the-Middle, you can overrule the swarm's current stalemate or consensus. Your directive will be injected into the high-priority memory segment of the mission facilitator.
          </Typography>

          <div className="space-y-2">
            <Typography variant="mono" className="text-[10px] uppercase font-black opacity-40 flex items-center gap-2">
              <MessageSquare size={12} /> Strategic_Directive
            </Typography>
            <Input 
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              placeholder="Enter specific instructions or rationale for your judgement..."
              className="bg-background/50 border-white/10 text-sm italic"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 w-full lg:w-[200px]">
           <Button 
             variant="primary" 
             className="bg-cyber-green/20 text-cyber-green border-cyber-green/30 hover:bg-cyber-green/30 group"
             disabled={isSubmitting}
             onClick={() => handleAction('APPROVE')}
             icon={<CheckCircle2 size={16} className="group-hover:scale-110 transition-transform" />}
           >
              FORCE_APPROVE
           </Button>
           <Button 
             variant="danger" 
             className="bg-red-500/20 text-red-500 border-red-500/30 hover:bg-red-500/30 group"
             disabled={isSubmitting}
             onClick={() => handleAction('REJECT')}
             icon={<XCircle size={16} className="group-hover:scale-110 transition-transform" />}
           >
              FORCE_REJECT
           </Button>
           <Button 
             variant="outline" 
             className="border-cyber-blue/50 text-cyber-blue hover:bg-cyber-blue/10 group"
             disabled={isSubmitting}
             onClick={() => handleAction('OVERRULE')}
             icon={<ShieldAlert size={16} className="group-hover:scale-110 transition-transform" />}
           >
              OVERRULE_LIMITS
           </Button>
        </div>
      </div>
      
      <div className="mt-6 pt-4 border-t border-cyber-blue/10 flex items-center justify-between">
        <Typography variant="mono" className="text-[9px] uppercase font-black opacity-30">
           JUDGEMENT_GATE: PENDING_USER_SIG_ID_{requestId.substring(0,8)}
        </Typography>
        <div className="flex gap-2">
           <div className="w-1.5 h-1.5 rounded-full bg-cyber-blue animate-ping" />
           <Typography variant="mono" className="text-[9px] uppercase font-black text-cyber-blue">H-SIG Required</Typography>
        </div>
      </div>
    </Card>
  );
}
