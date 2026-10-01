'use client';

/**
 * Sign-in and registration.
 *
 * Both submit to server actions rather than a client-side fetch, so the
 * password never passes through client state, and the session cookie is set by
 * the same response that renders the result.
 */

import { useActionState } from 'react';
import { signIn, signUp } from '@/app/login/actions';

export interface FormState {
  error?: string;
  ok?: boolean;
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    mode === 'login' ? signIn : signUp,
    {},
  );

  const isRegister = mode === 'register';

  return (
    <div className="card mx-auto w-full max-w-sm p-6">
      <h1 className="font-display text-2xl text-maroon">{isRegister ? 'Create an account' : 'Sign in'}</h1>
      <p className="mt-1 text-xs text-stone-500">
        {isRegister
          ? 'Save your avatar so your measurements follow you between visits.'
          : 'Welcome back — your saved avatar is waiting.'}
      </p>

      <form action={formAction} className="mt-5 space-y-3">
        {isRegister && (
          <label className="block">
            <span className="label-xs">Name</span>
            <input
              name="name"
              autoComplete="name"
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-maroon"
            />
          </label>
        )}

        <label className="block">
          <span className="label-xs">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-maroon"
          />
        </label>

        <label className="block">
          <span className="label-xs">Password</span>
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-maroon"
          />
          {isRegister && <span className="mt-1 block text-[10px] text-stone-400">At least 8 characters.</span>}
        </label>

        {state.error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
        {state.ok && !isRegister && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">Signed in.</p>}

        <button type="submit" disabled={pending} className="btn-primary w-full">
          {pending ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-center text-xs text-stone-500">
        {isRegister ? (
          <>
            Already have an account?{' '}
            <a href="/login" className="font-medium text-maroon hover:underline">
              Sign in
            </a>
          </>
        ) : (
          <>
            New here?{' '}
            <a href="/register" className="font-medium text-maroon hover:underline">
              Create an account
            </a>
          </>
        )}
      </p>

      <p className="mt-4 text-center text-[10px] leading-relaxed text-stone-400">
        We store your measurements to size garments for you. They are special-category personal data under
        GDPR — you can export or delete them at any time from your account.
      </p>
    </div>
  );
}
