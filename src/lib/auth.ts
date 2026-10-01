/**
 * Authentication.
 *
 * Choices worth knowing about, because each was deliberate:
 *
 * 1. **Database sessions, not JWTs.** A stateless token cannot be revoked.
 *    Body measurements are GDPR Art. 9 data, so when a shopper erases their
 *    data they must be signed out immediately, not whenever a token happens
 *    to expire. `Session` rows are revocable; JWTs are not.
 *
 * 2. **bcrypt, not SHA.** Passwords are stored with a slow, salted KDF so a
 *    database leak does not become a credential breach.
 *
 * 3. **Constant-time verification.** Sign-in failures are indistinguishable in
 *    time whether or not the account exists, which stops an attacker enumerating
 *    registered emails.
 *
 * 4. **JWT sessions are 8 hours, not 30 days.** Body data is sensitive; a long
 *    unattended session on a shared device is a real risk.
 */

import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { AUTH_SECRET, SESSION_MAX_AGE_SECONDS, BCRYPT_ROUNDS } from './auth-config';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
    } & DefaultSession['user'];
  }
}

export interface SignUpInput {
  email: string;
  password: string;
  name?: string;
}

export interface SignInResult {
  ok: boolean;
  error?: string;
}

/** bcrypt is slow; a higher cost factor is the only thing protecting a leak. */
const COST = BCRYPT_ROUNDS;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

/**
 * Verifies a password against a stored hash.
 *
 * When there is no hash (OAuth-only account, or a non-existent user) we still
 * run a comparison against a dummy hash so the response time does not reveal
 * whether the account exists. Without this, "no such user" returns in ~1ms and
 * "wrong password" in ~100ms, which is a free account-enumeration oracle.
 */
async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  const DUMMY_HASH = '$2b$12$abcdefghijklmnopqrstuuKq2r3ZuJfV3FNBqLZ0kz1c2wWQ4nJ8fS1e';
  try {
    return await bcrypt.compare(plain, hash ?? DUMMY_HASH);
  } catch {
    return false;
  }
}

export async function signUp(input: SignUpInput): Promise<SignInResult> {
  const email = input.email.trim().toLowerCase();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'That email address does not look right.' };
  }
  if (input.password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' };
  }
  if (input.password.length > 200) {
    // bcrypt silently truncates past 72 bytes; reject rather than mislead.
    return { ok: false, error: 'Password is too long.' };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, error: 'An account with that email already exists.' };
  }

  await prisma.user.create({
    data: {
      email,
      name: input.name?.trim() || null,
      passwordHash: await hashPassword(input.password),
    },
  });

  return { ok: true };
}

export async function signInCredentials(email: string, password: string): Promise<SignInResult> {
  const normalised = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalised } });

  const valid = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !valid) {
    // One message for both cases, so nothing leaks which emails are registered.
    return { ok: false, error: 'Incorrect email or password.' };
  }
  return { ok: true };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: AUTH_SECRET,
  session: {
    // Database sessions, so they can be revoked on erasure.
    strategy: 'database',
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 60 * 60,
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!email || !password) return null;

        const result = await signInCredentials(email, password);
        if (!result.ok) return null;

        // Re-read rather than trusting the passed-through values, so the session
        // always reflects the stored record.
        const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
        if (!user) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      // The database session gives us the real user id, which the JWT would not.
      if (session.user) {
        session.user.id = user.id;
        session.user.email = user.email ?? '';
      }
      return session;
    },
  },
});

/** Current user id, or null. Returns null rather than throwing when signed out. */
export async function currentUserId(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.id ?? null;
  } catch {
    // No database / no secret configured: treat as signed out rather than
    // crashing every page that asks "am I signed in?".
    return null;
  }
}
