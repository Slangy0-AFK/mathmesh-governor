import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, BookOpen, Loader2, X } from 'lucide-react';

export default function KnowledgeBaseManager() {
  const [entries, setEntries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', content: '', source: '', action_scope: '*', tags: '' });

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    try {
      const items = await base44.entities.KnowledgeBase.list('-created_date', 100);
      setEntries(items);
    } catch (err) {
      // Entity might not be ready yet
    }
    setIsLoading(false);
  };

  const handleAdd = async () => {
    if (!form.title.trim() || !form.content.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
      await base44.entities.KnowledgeBase.create({
        title: form.title.trim(),
        content: form.content.trim(),
        source: form.source.trim(),
        action_scope: form.action_scope.trim() || '*',
        tags,
      });
      setForm({ title: '', content: '', source: '', action_scope: '*', tags: '' });
      setIsAdding(false);
      await loadEntries();
    } catch (err) {
      setError(err.message);
    }
    setIsSaving(false);
  };

  const handleDelete = async (id) => {
    try {
      await base44.entities.KnowledgeBase.delete(id);
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-cyan-600" />
          <p className="text-sm font-semibold text-slate-700">Knowledge Base</p>
          <span className="text-xs bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>
        {!isAdding && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAdding(true)}
            className="text-cyan-700 border-cyan-200 hover:bg-cyan-50"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add Entry
          </Button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}

      {isAdding && (
        <div className="bg-cyan-50/50 border border-cyan-100 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-cyan-800">New Knowledge Entry</p>
            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Title</Label>
              <Input
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Q3 Revenue Data"
                className="text-sm h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Source</Label>
              <Input
                value={form.source}
                onChange={e => setForm({ ...form, source: e.target.value })}
                placeholder="e.g. Internal Report, URL"
                className="text-sm h-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-600">Content (facts the LLM should ground in)</Label>
            <Textarea
              value={form.content}
              onChange={e => setForm({ ...form, content: e.target.value })}
              placeholder="Paste the factual knowledge here..."
              className="text-sm resize-none h-24"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Action Scope</Label>
              <Input
                value={form.action_scope}
                onChange={e => setForm({ ...form, action_scope: e.target.value })}
                placeholder="* for all actions, or specific action name"
                className="text-sm h-9 font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-600">Tags (comma-separated)</Label>
              <Input
                value={form.tags}
                onChange={e => setForm({ ...form, tags: e.target.value })}
                placeholder="e.g. revenue, q3, europe"
                className="text-sm h-9"
              />
            </div>
          </div>
          <Button
            onClick={handleAdd}
            disabled={isSaving || !form.title.trim() || !form.content.trim()}
            className="w-full bg-cyan-700 hover:bg-cyan-800 text-white h-9"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                Save to Knowledge Base
              </>
            )}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading knowledge base...
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-slate-200 rounded-xl">
          <BookOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-400">No knowledge entries yet.</p>
          <p className="text-xs text-slate-400 mt-1">Add facts to ground LLM responses and prevent hallucinations.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {entries.map((e) => (
            <div key={e.id} className="bg-white border border-slate-100 rounded-lg p-3 group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800 truncate">{e.title}</p>
                    {e.action_scope && e.action_scope !== '*' && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">
                        {e.action_scope}
                      </span>
                    )}
                  </div>
                  {e.source && (
                    <p className="text-xs text-slate-400 mt-0.5">Source: {e.source}</p>
                  )}
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2 leading-relaxed">
                    {e.content}
                  </p>
                  {e.tags && e.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {e.tags.map((tag, i) => (
                        <span key={i} className="text-xs bg-cyan-50 text-cyan-600 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}