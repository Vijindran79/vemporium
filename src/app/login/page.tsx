import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUserId } from '@/lib/auth';
import { AuthForm } from '@/components/account/AuthForm';

export const metadata: Metadata = { title: 'Sign in — Vemporium', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await currentUserId()) redirect('/account');
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <AuthForm mode="login" />
    </main>
  );
}