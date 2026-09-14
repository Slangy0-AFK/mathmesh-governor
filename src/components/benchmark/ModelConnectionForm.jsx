import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
export default function ModelConnectionForm({ value, onChange, disabled }) {
  const update = (key, next) => onChange({ ...value, [key]: next });
  return <fieldset disabled={disabled} className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Connection<select className="w-full h-9 rounded-md border border-input bg-background px-2" value={value.provider} onChange={e => update('provider', e.target.value)}>
        <option value="openai">OpenAI — Responses API</option><option value="anthropic">Anthropic — Messages API</option><option value="gemini">Google — Gemini API</option><option value="compatible">Any OpenAI-compatible endpoint</option><option value="submitted">External agent — submit answers</option>
      </select></label>
      <label className="space-y-1 text-sm">Model ID / submitted model label<Input value={value.model} maxLength={150} onChange={e => update('model', e.target.value)} placeholder="Exact model ID from your provider" /></label>
    </div>
    {value.provider === 'compatible' && <label className="block space-y-1 text-sm">HTTPS base endpoint<Input value={value.endpoint} onChange={e => update('endpoint', e.target.value)} placeholder="https://provider.example/v1" /><span className="block text-xs text-muted-foreground">Its exact host must have POST enabled in the Egress Allowlist below. Only connect trusted public endpoints.</span></label>}
    {value.provider !== 'submitted' ? <label className="block space-y-1 text-sm">Provider API key<Input type="password" autoComplete="off" value={value.apiKey} maxLength={1000} onChange={e => update('apiKey', e.target.value)} /><span className="block text-xs text-muted-foreground">Sent to the server and selected provider for this run; not saved by this feature. Provider charges apply. Keys are cleared after the run.</span></label> : <div className="space-y-1"><Label>External answers (completed task template)</Label><Textarea className="h-32 font-mono" value={value.answers} onChange={e => update('answers', e.target.value)} placeholder={'{"version":"mathmesh-reference-v2","answers":[{"id":"arithmetic","answer":"{\\"answer\\":391}"}]}'} /><p className="text-xs text-muted-foreground">Use the downloaded task template. Missing answers are errors. Model identity, timing and token usage cannot be verified for submissions.</p></div>}
  </fieldset>;
}