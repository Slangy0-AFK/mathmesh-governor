import { Activity, RotateCcw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AgentStatePanel({ governor, onReset }) {
  const agents = governor.getAllAgents();

  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center">
        <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-400">No agents tracked yet. Run a pipeline call to begin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {agents.map((agentId) => {
        const history = governor.getAgentHistory(agentId);
        const lastThree = history.slice(-3);
        const isLooping = lastThree.length === 3 && new Set(lastThree).size === 1;
        const loopCount = history.length >= 3
          ? history.slice(-3).filter(a => a === history[history.length - 1]).length
          : 0;

        return (
          <div
            key={agentId}
            className={`rounded-xl border p-4 ${isLooping ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {isLooping ? (
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                ) : (
                  <Activity className="w-4 h-4 text-emerald-500" />
                )}
                <span className="text-sm font-semibold text-slate-800">{agentId}</span>
                {isLooping && (
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                    LOOP DETECTED
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReset(agentId)}
                className="h-7 px-2 text-xs text-slate-500 hover:text-slate-800"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Reset
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {history.map((action, i) => {
                const isLast3 = i >= history.length - 3;
                return (
                  <span
                    key={i}
                    className={`text-xs px-2 py-0.5 rounded-full border font-mono ${
                      isLooping && isLast3
                        ? 'bg-red-100 border-red-300 text-red-700'
                        : 'bg-slate-100 border-slate-200 text-slate-600'
                    }`}
                  >
                    {action}
                  </span>
                );
              })}
            </div>
            <p className="text-xs text-slate-400 mt-2">{history.length} action(s) recorded</p>
          </div>
        );
      })}
    </div>
  );
}