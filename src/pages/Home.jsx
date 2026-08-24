import { useState, useRef, useCallback } from 'react';
import { MathMeshGovernor } from '@/lib/mathMeshGovernor';
import PipelineStepCard from '@/components/PipelineStepCard';
import AgentStatePanel from '@/components/AgentStatePanel';
import RunLogEntry from '@/components/RunLogEntry';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Play, RotateCcw, Zap, Shield, Activity, ListOrdered, FlaskConical } from 'lucide-react';

const PRESETS = [
  {
    label: 'Test 1: Clean Pass',
    agentId: 'FactChecker_1',
    payload: 'Clean input text data here.',
    action: 'Fetch_Database_Record',
    votes: '10, 12, 14',
  },
  {
    label: 'Test 2: Mismatch Breakdown',
    agentId: 'Router_2',
    payload: 'Valid payload text.',
    action: 'Route_To_Web',
    votes: '8, 16, 21',
  },
  {
    label: 'Test 3: Loop Breaker ×1',
    agentId: 'Synthesizer_1',
    payload: 'Data payload',
    action: 'Call_API_Tool',
    votes: '2, 4, 6',
  },
  {
    label: 'Test 3: Loop Breaker ×2',
    agentId: 'Synthesizer_1',
    payload: 'Data payload',
    action: 'Call_API_Tool',
    votes: '2, 4, 6',
  },
  {
    label: 'Test 3: Loop Breaker ×3 (KILLS)',
    agentId: 'Synthesizer_1',
    payload: 'Data payload',
    action: 'Call_API_Tool',
    votes: '2, 4, 6',
  },
  {
    label: 'Test 4: Noise Input',
    agentId: 'Agent_X',
    payload: '   ',
    action: 'Process',
    votes: '4, 8, 12',
  },
];

export default function Home() {
  const governorRef = useRef(new MathMeshGovernor());
  const [, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate(n => n + 1), []);

  const [agentId, setAgentId] = useState('FactChecker_1');
  const [payload, setPayload] = useState('Clean input text data here.');
  const [action, setAction] = useState('Fetch_Database_Record');
  const [votesRaw, setVotesRaw] = useState('10, 12, 14');
  const [lastResult, setLastResult] = useState(null);
  const [runLog, setRunLog] = useState([]);

  const parseVotes = (raw) => {
    return raw.split(',').map(v => parseInt(v.trim(), 10)).filter(n => !isNaN(n));
  };

  const handleRun = () => {
    const votes = parseVotes(votesRaw);
    const result = governorRef.current.runMeshPipeline(agentId, payload, action, votes);
    setLastResult(result);
    setRunLog(prev => [{
      ...result,
      agentId,
      action,
      rawPayload: payload,
      votes,
      timestamp: new Date().toISOString(),
    }, ...prev]);
    refresh();
  };

  const handlePreset = (preset) => {
    setAgentId(preset.agentId);
    setPayload(preset.payload);
    setAction(preset.action);
    setVotesRaw(preset.votes);
  };

  const handleResetAgent = (id) => {
    governorRef.current.resetAgent(id);
    refresh();
  };

  const handleResetAll = () => {
    governorRef.current.resetAll();
    setLastResult(null);
    setRunLog([]);
    refresh();
  };

  const totalRuns = runLog.length;
  const haltedRuns = runLog.filter(r => r.status === 'HALTED').length;
  const passedRuns = runLog.filter(r => r.status === 'PASSED').length;
  const totalSaved = runLog.reduce((acc, r) => acc + (r.estimatedTokensSaved || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-none">MathMesh Governor</h1>
              <p className="text-xs text-slate-400 mt-0.5">Agentic Harness · Multi-Base Token Filter</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleResetAll} className="text-slate-500 border-slate-200">
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Reset All
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Runs', value: totalRuns, icon: Activity, color: 'text-slate-700' },
            { label: 'Passed', value: passedRuns, icon: Zap, color: 'text-emerald-600' },
            { label: 'Halted', value: haltedRuns, icon: Shield, color: 'text-red-500' },
            { label: 'Chars Saved', value: totalSaved.toLocaleString(), icon: FlaskConical, color: 'text-blue-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-100 px-4 py-3 flex items-center gap-3">
              <Icon className={`w-5 h-5 ${color} shrink-0`} />
              <div>
                <p className="text-xs text-slate-400">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Left column: Input + Pipeline */}
          <div className="lg:col-span-3 space-y-5">

            {/* Preset tests */}
            <div className="bg-white rounded-xl border border-slate-100 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Quick Presets</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handlePreset(p)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors font-medium"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input form */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 space-y-4">
              <p className="text-sm font-semibold text-slate-700">Pipeline Input</p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Agent ID</Label>
                  <Input
                    value={agentId}
                    onChange={e => setAgentId(e.target.value)}
                    placeholder="e.g. FactChecker_1"
                    className="text-sm h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-slate-600">Current Action</Label>
                  <Input
                    value={action}
                    onChange={e => setAction(e.target.value)}
                    placeholder="e.g. Fetch_Database_Record"
                    className="text-sm h-9"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">Raw Payload</Label>
                <Textarea
                  value={payload}
                  onChange={e => setPayload(e.target.value)}
                  placeholder="Paste your raw input payload here..."
                  className="text-sm resize-none h-24"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-600">
                  Vote Array <span className="text-slate-400 font-normal">(comma-separated integers)</span>
                </Label>
                <Input
                  value={votesRaw}
                  onChange={e => setVotesRaw(e.target.value)}
                  placeholder="e.g. 10, 12, 14"
                  className="text-sm h-9 font-mono"
                />
              </div>

              <Button
                onClick={handleRun}
                className="w-full bg-slate-900 hover:bg-slate-700 text-white h-10"
              >
                <Play className="w-4 h-4 mr-2" />
                Run Mesh Pipeline
              </Button>
            </div>

            {/* Pipeline gate results */}
            <div className="bg-white rounded-xl border border-slate-100 p-5">
              <p className="text-sm font-semibold text-slate-700 mb-4">Pipeline Gate Results</p>
              <div className="space-y-3">
                {[
                  { step: 1, gate: 'Base 2 — Noise Stripper' },
                  { step: 2, gate: 'Base 60 — Circuit Breaker' },
                  { step: 3, gate: 'Base 8/10 — Matrix Voting' },
                ].map(({ step, gate }) => {
                  const stepData = lastResult?.steps?.find(s => s.step === step);
                  return (
                    <PipelineStepCard
                      key={step}
                      step={step}
                      gate={gate}
                      passed={stepData?.passed ?? false}
                      detail={stepData?.detail ?? ''}
                      active={!!stepData}
                    />
                  );
                })}
              </div>

              {lastResult && (
                <div className={`mt-4 rounded-xl px-4 py-3 border ${
                  lastResult.status === 'PASSED'
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      lastResult.status === 'PASSED'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-red-500 text-white'
                    }`}>
                      {lastResult.status}
                    </span>
                    {lastResult.haltedAt && (
                      <span className="text-xs text-red-600 font-medium">Halted at {lastResult.haltedAt}</span>
                    )}
                  </div>
                  <p className={`text-sm font-medium ${
                    lastResult.status === 'PASSED' ? 'text-emerald-800' : 'text-red-800'
                  }`}>
                    {lastResult.message}
                  </p>
                  {lastResult.estimatedTokensSaved > 0 && (
                    <p className="text-xs text-emerald-600 mt-1">
                      ~{lastResult.estimatedTokensSaved} characters of bloat stripped before tokenization.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right column: Agent state + log */}
          <div className="lg:col-span-2 space-y-5">

            {/* Agent state tracker */}
            <div className="bg-white rounded-xl border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-slate-500" />
                <p className="text-sm font-semibold text-slate-700">Agent State Tracker</p>
              </div>
              <AgentStatePanel
                governor={governorRef.current}
                onReset={handleResetAgent}
              />
            </div>

            {/* How it works */}
            <div className="bg-slate-900 rounded-xl p-5 text-white">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">How It Works</p>
              <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
                <div>
                  <span className="font-semibold text-white">Base 2 — Noise Stripper</span>
                  <p>Binary Go/No-Go. Collapses whitespace, rejects empty or error-loop inputs before a single token is counted.</p>
                </div>
                <Separator className="bg-slate-700" />
                <div>
                  <span className="font-semibold text-white">Base 60 — Circuit Breaker</span>
                  <p>Rotational loop governor. If any agent repeats the same action 3× in a row, the thread is killed cold. 0 tokens wasted.</p>
                </div>
                <Separator className="bg-slate-700" />
                <div>
                  <span className="font-semibold text-white">Base 8/10 — Matrix Voting</span>
                  <p>Coordinate alignment check. All agent votes must share the same modulus-2 parity. Any mismatch signals agents are out of sync.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Run log */}
        {runLog.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <ListOrdered className="w-4 h-4 text-slate-500" />
              <p className="text-sm font-semibold text-slate-700">Run Log</p>
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full ml-auto">
                {runLog.length} run{runLog.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="space-y-2">
              {runLog.map((entry, i) => (
                <RunLogEntry key={i} entry={entry} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}