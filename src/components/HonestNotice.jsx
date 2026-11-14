import { Info } from 'lucide-react';

export default function HonestNotice() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start gap-3">
        <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700">What this test environment does</p>
          <p className="text-xs text-slate-600 leading-relaxed">
            MathMesh Governor lets teams examine how AI agent requests are handled. For requests sent
            through this app, the server checks agent access and usage limits before a model request,
            records key decisions, and can withhold answers that are not supported by supplied material.
            Other checks identify repeated requests and can avoid an identical model call.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            The usage limit is based on estimated tokens, not the provider's final bill. Some checks
            also require model requests of their own, so the test results include costs that should
            be considered when evaluating the system.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            The published detector results come from a small, hand-labeled test set. They are useful
            for inspecting this version, but they do not establish performance on other models,
            tasks, or deployments. Independent testing is still needed.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            The dashboard runs in the browser, while admission and spend enforcement run on the
            server. This is not a sandbox and cannot control activity outside requests routed
            through this app. The project has not been independently assessed or certified; these
            tests do not prove that an AI system is safe.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            Drift and grounding judgments, the signed self-test, and external model benchmarks use
            language models. Their results are probabilistic and can vary by run, provider, or model
            version. Treat them as preliminary evidence for the recorded setup, not as release
            certification.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            Most importantly, this detects but does not contain. There is no sandbox, so a halt
            withholds a result rather than stopping an agent from acting. An agent with its own
            network route or runtime is unaffected; isolation would have to live below the app
            layer. The scorecard further down lists requirements that are still missing.
          </p>
        </div>
      </div>
    </div>
  );
}