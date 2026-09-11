import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { buildSelfTestPdf } from '@/lib/selfTestPdf';
import { buildPublicBriefPdf } from '@/lib/publicBriefPdf';
import { FileCheck2, Download, Loader2, Check, X, AlertTriangle, EyeOff } from 'lucide-react';

export default function SelfTestReport() {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const res = await base44.functions.invoke('harnessSelfTest', {});
      setReport(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message);
    }
    setBusy(false);
  };

  const stamp = () => report.finishedAt.slice(0, 19).replace(/[:T]/g, '');

  const download = () => buildSelfTestPdf(report).save(`mathmesh-selftest-${stamp()}.pdf`);
  const downloadBrief = () => buildPublicBriefPdf(report).save(`agent-governance-brief-${stamp()}.pdf`);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <FileCheck2 className="w-4 h-4 text-slate-500" />
        <p className="text-sm font-semibold text-slate-700">Signed Self-Test Report</p>
        <Button size="sm" className="ml-auto h-7 text-xs bg-slate-900" onClick={run} disabled={busy}>
          {busy ? <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" />Running…</> : 'Run signed test'}
        </Button>
        {report && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={downloadBrief}>
              <EyeOff className="w-3 h-3 mr-1.5" />Brief PDF
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={download}>
              <Download className="w-3 h-3 mr-1.5" />Technical PDF
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">
        Runs seven live cases against the real gates — grounded pass, fabricated claim, true-but-uncited
        claim, decoy engagement, on-task false-positive check, audit-chain verification, signing probe —
        then signs the whole report server-side and names the model that judged it. A case that cannot run
        is reported as an error, never as a pass. Admin only; it spends model credits.
      </p>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {busy && <p className="text-xs text-slate-400">Seven live model-backed cases take around 25 seconds.</p>}

      {report && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-700">
              <span className="font-semibold">{report.summary.passed}/{report.summary.total} passed</span>
              {report.summary.failed > 0 && <span className="text-red-600"> · {report.summary.failed} failed</span>}
              {report.summary.errored > 0 && <span className="text-amber-600"> · {report.summary.errored} could not run</span>}
              {' · judged by '}<span className="font-mono">{report.testerModelRequested}</span>
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Harness overhead this run: {report.tokens.harnessOverheadPct}% of ~
              {(report.tokens.generationEstimate + report.tokens.judgeEstimate).toLocaleString()} estimated tokens.
              The model id is what this harness requested — not proof of the weights the provider ran.
            </p>
          </div>

          <div className="space-y-1.5">
            {report.cases.map((c) => {
              const Icon = c.passed === true ? Check : c.passed === false ? X : AlertTriangle;
              const cls = c.passed === true ? 'text-emerald-600' : c.passed === false ? 'text-red-500' : 'text-amber-600';
              const bg = c.passed === true ? 'bg-emerald-50' : c.passed === false ? 'bg-red-50' : 'bg-amber-50';
              return (
                <div key={c.id} className={`rounded-lg px-3 py-2 ${bg}`}>
                  <div className="flex items-start gap-2">
                    <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cls}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-700">{c.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{c.observed}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-slate-200 px-3 py-2">
            <p className="text-xs font-medium text-slate-600 mb-1">Signature</p>
            <p className="text-xs text-slate-400 mb-1">{report.signedOver}</p>
            <p className="text-xs font-mono text-slate-500 break-all">sha256: {report.reportHash}</p>
            <p className="text-xs font-mono text-slate-500 break-all">hmac: {report.signature}</p>
          </div>

          <p className="text-xs text-slate-400">
            <span className="font-medium text-slate-500">Brief PDF</span> — outcomes only, for outside readers:
            benefits, what still needs independent confirmation, why it matters in the current AI landscape, the
            rogue-agent question answered both ways, and a plain verdict. Thresholds, detection patterns and gate
            internals are deliberately left out, since publishing them publishes the way around them.
            <br />
            <span className="font-medium text-slate-500">Technical PDF</span> — the full signed record: all{' '}
            {report.benefits.length} benefits, all {report.honestTakeaways.length} limitations, per-case detail and
            the signature block.
          </p>
        </div>
      )}
    </div>
  );
}