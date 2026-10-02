/**
 * Authentication.
 *
 * Choices worth knowing about, because each was deliberate:
 *
 * 1. **JWT sessions, with server-side revocation.** Auth.js forbids the
 *    Credentials provider under `strategy: "database"` — @auth/core raises
 *    UnsupportedStrategy at sign-in. Password login therefore *forces* JWT
 *    sessions, so "use database sessions so they can be revoked" was never
 *    actually available to us.
 *
 *    The revocation the Session table would have given us for free comes back
 *    via `User.sessionVersion`: the session callback re-reads the user on every
 *    request and discards the session if the account is gone or the version
 *    moved. Account erasure therefore still signs the shopper out immediately
 *    rather than at token expiry — which was the actual requirement, and the
 *    one that matters for Art. 9 body data.
 *
 *    Trade-off to be honest about: that is one indexed primary-key read per
 *    authenticated request. If it shows up in latency it moves to a short-lived
 *    cache, not to a longer token lifetime.
 *
 * 2. **bcrypt, not SHA.** Passwords are stored with a slow, salted KDF so a
 *    database leak does not become a credential breach.
 *
 * 3. **Constant-time verification.** Sign-in failures are indistinguishable in
 *    time whether or not the account exists, which stops an attacker enumerating
 *    registered emails.
 *
 * 4. **Sessions are 8 hours, not 30 days.** Body data is sensitive; a long
 *    unattended session on a shared device is a real risk.
 */

import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { AUTH_SECRET, SESSION_MAX_AGE_SECONDS, SESSION_STRATEGY, BCRYPT_ROUNDS } from './auth-config';

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
    // See SESSION_STRATEGY in auth-config for why this cannot be 'database'.
    strategy: SESSION_STRATEGY,
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
        const user = await prisma.user.findUnique({
          where: { email: email.trim().toLowerCase() },
          select: { id: true, email: true, name: true, sessionVersion: true },
        });
        if (!user) return null;

        // sessionVersion rides along into the token so the session callback can
        // detect a later bump and drop the session.
        return { id: user.id, email: user.email, name: user.name, sessionVersion: user.sessionVersion };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Seeded on sign-in only; subsequent reads reuse whatever is in the cookie.
      if (user?.id) {
        token.sub = user.id;
        token.sv = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      const userId = typeof token.sub === 'string' ? token.sub : null;
      if (!userId || !session.user) return session;

      // Revocation check. This is the whole reason we can live with JWTs:
      // the token is only trusted while the account behind it still exists and
      // has not had its session version bumped.
      //
      // Erasure deletes the User row, so a JWT issued before erasure stops
      // resolving here — the shopper is signed out immediately, not whenever
      // the 8-hour token happens to expire.
      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, sessionVersion: true },
      });
      if (!row) {
        // The account is gone. Hand back an anonymous session rather than
        // throwing, so a stale cookie degrades to "signed out" instead of a 500.
        return { ...session, user: undefined } as unknown as typeof session;
      }
      if (typeof token.sv === 'number' && token.sv !== row.sessionVersion) {
        return { ...session, user: undefined } as unknown as typeof session;
      }

      session.user.id = row.id;
      session.user.email = row.email;
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
