import { useState } from 'react';
import {
  ChatBubbleLeftRightIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';

import { useTBWOStore } from '@store/tbwoStore';
import { Button } from '@components/ui/Button';
import type { TBWO } from '../../../types/tbwo';

export function PauseAskTab({ tbwo }: { tbwo: TBWO }) {
  const [responseText, setResponseText] = useState<Record<string, string>>({});
  const submitPauseResponse = useTBWOStore((s) => s.submitPauseResponse);
  const resumeExecution = useTBWOStore((s) => s.resumeExecution);

  const pauseRequests = tbwo.pauseRequests || [];
  const pending = pauseRequests.filter(p => p.status === 'pending');
  const resolved = pauseRequests.filter(p => p.status !== 'pending');

  const handleSubmit = (pauseId: string) => {
    const text = responseText[pauseId]?.trim();
    if (!text) return;
    submitPauseResponse(tbwo.id, pauseId, text);
    setResponseText(prev => ({ ...prev, [pauseId]: '' }));
  };

  const handleSkip = (pauseId: string) => {
    submitPauseResponse(tbwo.id, pauseId, '[SKIPPED] Use your best judgment.');
  };

  if (pauseRequests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <ChatBubbleLeftRightIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Questions</h3>
        <p className="text-sm text-text-tertiary">
          Pods will ask questions here when they need your input
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Pending Questions */}
      {pending.length > 0 && (
        <div>
          <h3 className="mb-3 flex items-center gap-2 font-semibold text-text-primary">
            <QuestionMarkCircleIcon className="h-5 w-5 text-semantic-warning" />
            Pending Questions ({pending.length})
          </h3>
          <div className="space-y-4">
            {pending.map((pr) => (
              <div key={pr.id} className="rounded-xl border-2 border-semantic-warning/30 bg-semantic-warning/5 p-5">
                <div className="mb-3 flex items-center gap-2 text-xs text-text-tertiary">
                  <span className="rounded bg-semantic-warning/20 px-1.5 py-0.5 text-semantic-warning font-medium">
                    {pr.reason.replace(/_/g, ' ')}
                  </span>
                  <span>Phase {pr.phase}</span>
                  {pr.contextPath && <span>&middot; {pr.contextPath}</span>}
                </div>
                <p className="mb-3 text-sm font-medium text-text-primary">{pr.question}</p>
                {pr.requiredFields && pr.requiredFields.length > 0 && (
                  <p className="mb-3 text-xs text-text-tertiary">
                    Needs: {pr.requiredFields.join(', ')}
                  </p>
                )}
                <div className="flex gap-2">
                  <textarea
                    value={responseText[pr.id] || ''}
                    onChange={(e) => setResponseText(prev => ({ ...prev, [pr.id]: e.target.value }))}
                    placeholder="Type your answer..."
                    rows={2}
                    className="flex-1 rounded-lg border border-border-primary bg-background-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none"
                  />
                </div>
                <div className="mt-2 flex gap-2">
                  <Button variant="primary" size="sm" onClick={() => handleSubmit(pr.id)} disabled={!responseText[pr.id]?.trim()}>
                    Answer
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleSkip(pr.id)}>
                    Let ALIN Infer
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {tbwo.status === 'paused_waiting_for_user' && pending.length === 0 && (
            <Button variant="primary" size="sm" className="mt-4" onClick={() => resumeExecution(tbwo.id)}>
              Resume Execution
            </Button>
          )}
        </div>
      )}

      {/* Resolved Questions */}
      {resolved.length > 0 && (
        <div>
          <h3 className="mb-3 font-semibold text-text-primary">Answered ({resolved.length})</h3>
          <div className="space-y-3">
            {resolved.map((pr) => (
              <div key={pr.id} className="rounded-xl border border-border-primary bg-background-secondary p-4">
                <div className="mb-2 flex items-center gap-2 text-xs text-text-tertiary">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${
                    pr.status === 'answered' ? 'bg-semantic-success/10 text-semantic-success' :
                    pr.status === 'inferred' ? 'bg-brand-primary/10 text-brand-primary' :
                    'bg-background-tertiary text-text-quaternary'
                  }`}>
                    {pr.status === 'answered' ? 'User Answered' : pr.status === 'inferred' ? 'AI Inferred' : 'Skipped'}
                  </span>
                  {pr.contentTag && <span>Tag: {pr.contentTag}</span>}
                </div>
                <p className="mb-1 text-sm text-text-secondary">{pr.question}</p>
                {pr.userResponse && (
                  <p className="text-sm font-medium text-text-primary">{pr.userResponse}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
