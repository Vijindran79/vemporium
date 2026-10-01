'use server';

/**
 * Server actions for sign-in and registration.
 *
 * Using server actions rather than a client fetch means the password is never
 * held in client state, and the session cookie is set by the same response
 * that renders the outcome — so there is no window where the UI says "signed
 * in" before the cookie actually exists.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { signIn as signInAuth, signInCredentials, signUp as createUser } from '@/lib/auth';

export interface FormState {
  error?: string;
  ok?: boolean;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');

  const result = await signInCredentials(email, password);
  if (!result.ok) return { error: result.error };

  try {
    await signInAuth('credentials', { email, password, redirectTo: '/account' });
  } catch {
    // Auth.js throws a NEXT_REDIRECT control-flow exception on success.
    return { error: 'Could not start a session. Please try again.' };
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '') || undefined;

  const result = await createUser({ email, password, name });
  if (!result.ok) return { error: result.error };

  // Sign the new account in immediately: making someone type their password
  // twice in a row is the classic reason sign-up funnels lose people.
  try {
    await signInAuth('credentials', { email, password, redirectTo: '/fitting-room' });
  } catch {
    return { ok: true };
  }

  return { ok: true };
}
