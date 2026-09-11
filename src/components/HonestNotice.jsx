import { Info } from 'lucide-react';

export default function HonestNotice() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start gap-3">
        <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700">What this is, plainly</p>
          <p className="text-xs text-slate-600 leading-relaxed">
            This is a working simulator of a request pipeline placed in front of an LLM. Three parts
            save real money: the response cache (skips the call entirely on exact repeats), the
            filler-stripping compressor (small but free), and the cheap checks that halt obviously
            bad requests before any call is made.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            Three parts cost money to run: semantic dedup and knowledge retrieval are each an LLM
            call of their own, and drift detection adds a decoy block to every prompt. They earn
            their keep only when the request they stop or improve is worth more than they cost.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            The <span className="font-medium">89% figure</span> from the earlier benchmark came
            largely from repeating identical payloads, which the cache trivially absorbs. Treat it
            as a best case for repetitive traffic, not a general result. On varied, novel requests
            the pipeline costs more per request than calling the model directly.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            The pipeline also runs in the browser, so it governs cooperating agents. It is not a
            security boundary against a hostile caller — that would need to live server-side.
          </p>
        </div>
      </div>
    </div>
  );
}