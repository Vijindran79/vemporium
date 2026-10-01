'use client';

/**
 * Account: saved avatars, data export, and account erasure.
 *
 * The two GDPR controls get equal visual weight to the happy path. Body
 * measurements are special-category data, so being able to see and remove them
 * is a product feature, not a legal footnote buried in a settings page.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAvatarStore } from '@/store/avatar-store';
import type { BodyParams, Gender } from '@/lib/sizing';

export interface SavedAvatar {
  id: string;
  label: string;
  gender: Gender;
  heightCm: number;
  weightKg: number;
  bustCm: number | null;
  chestCm: number | null;
  waistCm: number;
  hipCm: number;
  skinToneHex: string;
  hairStyleId: string | null;
  hairColorHex: string | null;
}

function summarise(a: SavedAvatar): string {
  const mens = a.gender === 'MALE' || a.gender === 'KID_BOY';
  const girth = mens ? a.chestCm : a.bustCm;
  return `${Math.round(a.heightCm)}cm · ${girth ? `${Math.round(girth)}cm ${mens ? 'chest' : 'bust'}` : 'no girth set'} · ${Math.round(a.waistCm)}cm waist`;
}

export function AccountView({ signedInAs }: { signedInAs: string | null }) {
  const [avatars, setAvatars] = useState<SavedAvatar[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/avatars');
      if (res.status === 401) return setAvatars([]);
      const data = await res.json();
      setAvatars(data.avatars ?? []);
    } catch {
      setMessage({ tone: 'error', text: 'Could not load your avatars.' });
    }
  }, []);

  useEffect(() => {
    if (signedInAs) load();
  }, [signedInAs, load]);

  async function saveCurrent() {
    const store = useAvatarStore.getState();
    const body: BodyParams = store.body;
    setBusy('save');
    try {
      const res = await fetch('/api/avatars', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          skinToneHex: store.skinToneHex,
          hairStyleId: store.hairStyleId,
          hairColorHex: store.hairColorHex,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage({ tone: 'ok', text: 'Avatar saved to your account.' });
      load();
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function loadIntoStudio(id: string) {
    const a = avatars?.find((x) => x.id === id);
    if (!a) return;
    const store = useAvatarStore.getState();
    store.setBody({
      gender: a.gender,
      heightCm: a.heightCm,
      weightKg: a.weightKg,
      bustCm: a.bustCm ?? undefined,
      chestCm: a.chestCm ?? undefined,
      waistCm: a.waistCm,
      hipCm: a.hipCm,
    });
    store.setSkinTone(a.skinToneHex);
    if (a.hairStyleId) store.setHairStyle(a.hairStyleId);
    if (a.hairColorHex) store.setHairColor(a.hairColorHex);
    window.location.href = '/fitting-room';
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/avatars?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete that avatar');
      setMessage({ tone: 'ok', text: 'Avatar deleted. This cannot be undone.' });
      load();
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function eraseEverything() {
    if (!confirmErase) {
      setConfirmErase(true);
      return;
    }
    setBusy('erase');
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      if (!res.ok) throw new Error('Erasure failed');
      window.location.href = '/';
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
      setBusy(null);
      setConfirmErase(false);
    }
  }

  if (!signedInAs) {
    return (
      <div className="card mx-auto max-w-md p-10 text-center">
        <h2 className="font-display text-2xl text-maroon">Save your avatar</h2>
        <p className="mt-2 text-sm text-stone-600">
          Sign in and your measurements follow you between visits, so you never re-enter them.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/register" className="btn-primary">Create an account</Link>
          <Link href="/login" className="btn-ghost">Sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <p className={`rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </p>
      )}
      <AccountBody
        avatars={avatars}
        busy={busy}
        confirmErase={confirmErase}
        message={message}
        onSave={saveCurrent}
        onLoad={loadIntoStudio}
        onDelete={remove}
        onErase={eraseEverything}
        setConfirmErase={setConfirmErase}
      />
    </div>
  );
}

function AccountBody({
  avatars,
  busy,
  confirmErase,
  onSave,
  onLoad,
  onDelete,
  onErase,
  setConfirmErase,
}: {
  avatars: SavedAvatar[] | null;
  busy: string | null;
  confirmErase: boolean;
  message: { tone: 'ok' | 'error'; text: string } | null;
  onSave: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onErase: () => void;
  setConfirmErase: (v: boolean) => void;
}) {
  return (
    <>
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg text-maroon">Your avatars</h2>
          <button type="button" onClick={onSave} disabled={busy === 'save'} className="btn-primary !px-3 !py-1.5 !text-xs">
            {busy === 'save' ? 'Saving…' : 'Save current avatar'}
          </button>
        </div>

        {avatars === null ? (
          <p className="mt-3 text-sm text-stone-500">Loading…</p>
        ) : avatars.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            No saved avatars yet. Adjust your measurements in the fitting room, then save them here.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {avatars.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 p-3">
                <div className="flex items-center gap-3">
                  <span className="h-8 w-8 rounded-full border-2 border-white shadow" style={{ backgroundColor: a.skinToneHex }} />
                  <div>
                    <p className="text-sm font-medium text-stone-800">{a.label}</p>
                    <p className="text-[11px] text-stone-500">{summarise(a)}</p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => onLoad(a.id)} className="btn-ghost !px-3 !py-1 !text-[11px]">
                    Try on
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(a.id)}
                    disabled={busy === a.id}
                    className="rounded-full border border-stone-300 px-3 py-1 text-[11px] hover:border-red-300 hover:text-red-600"
                  >
                    {busy === a.id ? '…' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5">
        <h2 className="font-display text-lg text-maroon">Your data</h2>
        <p className="mt-1 text-xs text-stone-500">
          Body measurements are special-category personal data under GDPR. Both of these are immediate and
          permanent.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/account" className="btn-ghost !px-4 !py-2 !text-xs" download>
            Download everything we hold
          </a>
          <button
            type="button"
            onClick={onErase}
            disabled={busy === 'erase'}
            className="rounded-full border border-red-300 px-4 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            {busy === 'erase' ? 'Deleting…' : confirmErase ? 'Click again to confirm' : 'Delete my account'}
          </button>
        </div>
        {confirmErase && !busy && (
          <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-[11px] text-red-700">
            This permanently removes your account and every saved avatar. Sales records are retained with your
            email removed, because tax law requires us to keep them.
          </p>
        )}
      </section>

      <form action="/api/auth/signout" method="post" className="text-center">
        <button type="submit" className="text-xs text-stone-500 underline-offset-2 hover:text-maroon hover:underline">
          Sign out
        </button>
      </form>
    </>
  );
}
