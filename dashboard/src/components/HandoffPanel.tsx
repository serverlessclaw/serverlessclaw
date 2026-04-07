import React from 'react';
import { User, Send, ThumbsUp, ThumbsDown, Loader } from 'lucide-react';
import Button from '@/components/ui/Button';
import Typography from '@/components/ui/Typography';
import { HandoffData } from '@/lib/collaboration-utils';

interface HandoffPanelProps {
  handoffData: HandoffData | null;
  handoffResponse: string;
  setHandoffResponse: (val: string) => void;
  submittingResponse: boolean;
  onSubmit: (approved: boolean) => Promise<void>;
}

export const HandoffPanel: React.FC<HandoffPanelProps> = ({
  handoffData,
  handoffResponse,
  setHandoffResponse,
  submittingResponse,
  onSubmit,
}) => {
  return (
    <div className="absolute bottom-6 right-6 z-30 w-[360px] bg-background border border-orange-500/50 rounded-xl shadow-[0_0_30px_color-mix(in_srgb,theme(colors.orange.500)_20%,transparent)] overflow-hidden">
      <div className="px-4 py-3 bg-orange-500/10 border-b border-orange-500/20 flex items-center gap-3">
        <div className="p-1.5 bg-orange-500/20 rounded">
          <User size={14} className="text-orange-400" />
        </div>
        <div>
          <Typography
            variant="caption"
            weight="bold"
            className="text-orange-400 uppercase tracking-wider"
          >
            Human Input Required
          </Typography>
          <Typography variant="mono" className="text-[9px] text-muted-foreground mt-0.5">
            Agent escalated task for review
          </Typography>
        </div>
      </div>

      {handoffData && (
        <div className="p-4 space-y-3">
          <div className="bg-foreground/5 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Typography variant="mono" className="text-[9px] text-muted-foreground uppercase">
                Task ID:
              </Typography>
              <Typography variant="mono" className="text-[10px] text-foreground/80">
                {handoffData.taskId}
              </Typography>
            </div>
            <div className="flex items-center gap-2">
              <Typography variant="mono" className="text-[9px] text-muted-foreground uppercase">
                Agent:
              </Typography>
              <Typography variant="mono" className="text-[10px] text-foreground/80">
                {handoffData.agentId}
              </Typography>
            </div>
            <div>
              <Typography variant="mono" className="text-[9px] text-muted-foreground uppercase mb-1">
                Reason:
              </Typography>
              <Typography variant="body" className="text-[11px] text-foreground/70 italic">
                &quot;{handoffData.reason}&quot;
              </Typography>
            </div>
          </div>

          <div>
            <Typography variant="mono" className="text-[9px] text-muted-foreground uppercase mb-2">
              Your Response:
            </Typography>
            <textarea
              value={handoffResponse}
              onChange={(e) => setHandoffResponse(e.target.value)}
              placeholder="Provide guidance or approve/reject the agent's request..."
              className="w-full bg-foreground/5 border border-border rounded-lg px-3 py-2 text-foreground text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-500/50 resize-none h-20"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              fullWidth
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={() => onSubmit(false)}
              disabled={submittingResponse}
              icon={<ThumbsDown size={14} />}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              size="sm"
              fullWidth
              className="bg-orange-600 hover:bg-orange-500"
              onClick={() => onSubmit(true)}
              disabled={submittingResponse}
              icon={
                submittingResponse ? (
                  <Loader size={12} className="animate-spin" />
                ) : (
                  <ThumbsUp size={14} />
                )
              }
            >
              Approve
            </Button>
          </div>
          <div className="flex justify-center mt-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground h-auto py-1"
              icon={<Send size={10} />}
              onClick={() => onSubmit(true)}
              disabled={submittingResponse}
            >
              Send Instructions Only
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
