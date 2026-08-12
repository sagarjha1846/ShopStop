'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiAuthed, refresh, getAccessToken } from '@/lib/auth-client';
import { timeAgo } from '@/lib/format';
import { Button } from '@/components/ui';

interface Question {
  id: string;
  body: string;
  answerBody: string | null;
  answeredAt: string | null;
  createdAt: string;
  askedBy: string | null;
  askedByName: string | null;
}

/**
 * Public Q&A on a listing. Reads without auth on purpose — the answers are the
 * reason this exists, and hiding them behind a sign-in would waste them.
 */
export function ListingQuestions({ listingId, sellerId }: { listingId: string; sellerId: string }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [draft, setDraft] = useState('');
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/listings/${listingId}/questions`);
    if (res.ok) setQuestions(await res.json());
  }, [listingId]);

  useEffect(() => {
    (async () => {
      await load();
      const ok = getAccessToken() ? true : await refresh();
      setAuthed(ok);
      if (ok) {
        try {
          const me = await apiAuthed<{ id: string }>('/me/profile');
          setMeId(me.id);
        } catch {
          /* ignore */
        }
      }
    })();
  }, [load]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiAuthed(`/listings/${listingId}/questions`, { method: 'POST', body: { body: draft } });
      setDraft('');
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not post your question');
    } finally {
      setBusy(false);
    }
  }

  async function answer(questionId: string) {
    setBusy(true);
    setErr(null);
    try {
      await apiAuthed(`/questions/${questionId}/answer`, { method: 'POST', body: { body: answerDraft } });
      setAnswering(null);
      setAnswerDraft('');
      await load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not post your answer');
    } finally {
      setBusy(false);
    }
  }

  const isSeller = meId !== null && meId === sellerId;

  return (
    <section>
      <h2 className="mb-2 font-semibold">
        Questions {questions.length > 0 && <span className="text-muted">({questions.length})</span>}
      </h2>

      {!isSeller &&
        (authed ? (
          <form onSubmit={ask} className="mb-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask the seller a question"
              maxLength={500}
              className="w-full rounded-md border bg-bg px-3 py-2 text-sm"
            />
            <Button type="submit" disabled={busy || draft.trim().length < 5}>
              Ask
            </Button>
          </form>
        ) : (
          <p className="mb-4 text-sm text-muted">
            <Link href={`/login?next=/l/${listingId}`} className="text-brand underline">
              Sign in
            </Link>{' '}
            to ask the seller a question.
          </p>
        ))}

      {err && <p className="mb-2 text-sm text-danger">{err}</p>}

      {questions.length === 0 ? (
        <p className="text-sm text-muted">No questions yet — be the first to ask.</p>
      ) : (
        <ul className="space-y-3">
          {questions.map((q) => (
            <li key={q.id} className="rounded-lg border bg-surface p-3">
              <p className="text-sm font-medium">{q.body}</p>
              <p className="mt-0.5 text-xs text-muted">
                {q.askedByName ?? 'A buyer'} · {timeAgo(q.createdAt)}
              </p>

              {q.answerBody ? (
                <div className="mt-2 border-l-2 border-brand pl-3">
                  <p className="text-sm">{q.answerBody}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    Seller · {q.answeredAt ? timeAgo(q.answeredAt) : ''}
                  </p>
                </div>
              ) : isSeller ? (
                answering === q.id ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={answerDraft}
                      onChange={(e) => setAnswerDraft(e.target.value)}
                      placeholder="Your answer"
                      maxLength={500}
                      className="w-full rounded-md border bg-bg px-3 py-2 text-sm"
                    />
                    <Button onClick={() => answer(q.id)} disabled={busy || answerDraft.trim().length === 0}>
                      Post
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" className="mt-2 text-xs" onClick={() => setAnswering(q.id)}>
                    Answer
                  </Button>
                )
              ) : (
                <p className="mt-1 text-xs text-muted">Awaiting the seller&apos;s answer</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
