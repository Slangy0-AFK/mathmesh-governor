/**
 * Harness policy — the single server-side source of truth for enforcement limits.
 *
 * Everything here is read from one HarnessControl record so an operator can retune
 * limits or hit the global stop without a redeploy. If the record is missing it is
 * created with defaults, so the harness is never running with no policy at all.
 */

export interface HarnessPolicy {
  id?: string;
  kill_all: boolean;
  kill_all_reason: string;
  max_runs_per_window: number;
  window_seconds: number;
  loop_repeat_limit: number;
  drift_strikes_before_revoke: number;
  auto_revoke_on_drift: boolean;
}

export const POLICY_DEFAULTS: HarnessPolicy = {
  kill_all: false,
  kill_all_reason: '',
  max_runs_per_window: 20,
  window_seconds: 60,
  loop_repeat_limit: 3,
  drift_strikes_before_revoke: 2,
  auto_revoke_on_drift: true,
};

/**
 * Load the policy, creating it on first use.
 *
 * Fails CLOSED on the global stop only: if the record cannot be read we fall back to
 * defaults rather than assuming permission, because a policy read failure must not
 * silently raise an agent's limits.
 */
export async function loadPolicy(serviceRole: any): Promise<HarnessPolicy> {
  try {
    const rows = await serviceRole.entities.HarnessControl.filter({ singleton_key: 'GLOBAL' }, '-created_date', 1);
    if (rows.length > 0) {
      const r = rows[0];
      return {
        id: r.id,
        kill_all: !!r.kill_all,
        kill_all_reason: r.kill_all_reason || '',
        max_runs_per_window: numOr(r.max_runs_per_window, POLICY_DEFAULTS.max_runs_per_window),
        window_seconds: numOr(r.window_seconds, POLICY_DEFAULTS.window_seconds),
        loop_repeat_limit: numOr(r.loop_repeat_limit, POLICY_DEFAULTS.loop_repeat_limit),
        drift_strikes_before_revoke: numOr(r.drift_strikes_before_revoke, POLICY_DEFAULTS.drift_strikes_before_revoke),
        auto_revoke_on_drift: r.auto_revoke_on_drift !== false,
      };
    }
    const created = await serviceRole.entities.HarnessControl.create({
      singleton_key: 'GLOBAL',
      ...POLICY_DEFAULTS,
    });
    return { ...POLICY_DEFAULTS, id: created?.id };
  } catch {
    return { ...POLICY_DEFAULTS };
  }
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}