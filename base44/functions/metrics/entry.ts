import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';
import { reportFunctionError } from '../../shared/observability.ts';

const SAMPLE_LIMIT = 1000;

export default async function (req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method not allowed\n', { status: 405 });
  }

  const scrapeToken = secrets.get('PROMETHEUS_SCRAPE_TOKEN');
  if (!scrapeToken) return new Response('Metrics exporter is not configured\n', { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${scrapeToken}`) {
    return new Response('Unauthorized\n', { status: 401 });
  }

  try {
    const base44 = createClientFromRequest(req);
    const runs = await base44.asServiceRole.entities.PipelineRun.list(
      '-created_date', SAMPLE_LIMIT, 0, ['status', 'tokens_spent', 'drift_detected'],
    );
    const passed = runs.filter((run) => run.status === 'PASSED').length;
    const halted = runs.filter((run) => run.status === 'HALTED').length;
    const estimatedTokens = runs.reduce((sum, run) => sum + (Number(run.tokens_spent) || 0), 0);
    const drifted = runs.filter((run) => run.drift_detected === true).length;
    const metrics = [
      '# HELP mathmesh_pipeline_runs_retained Number of retained recent pipeline runs by status.',
      '# TYPE mathmesh_pipeline_runs_retained gauge',
      `mathmesh_pipeline_runs_retained{status="PASSED"} ${passed}`,
      `mathmesh_pipeline_runs_retained{status="HALTED"} ${halted}`,
      '# HELP mathmesh_estimated_tokens_retained Estimated tokens across sampled retained runs.',
      '# TYPE mathmesh_estimated_tokens_retained gauge',
      `mathmesh_estimated_tokens_retained ${estimatedTokens}`,
      '# HELP mathmesh_drifted_runs_retained Drifted runs in the sampled retained records.',
      '# TYPE mathmesh_drifted_runs_retained gauge',
      `mathmesh_drifted_runs_retained ${drifted}`,
      '# HELP mathmesh_metrics_sample_limit Maximum number of recent runs included in these gauges.',
      '# TYPE mathmesh_metrics_sample_limit gauge',
      `mathmesh_metrics_sample_limit ${SAMPLE_LIMIT}`,
      '',
    ].join('\n');

    return new Response(metrics, {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    await reportFunctionError('metrics', error);
    return new Response('Metrics collection failed\n', { status: 500 });
  }
}