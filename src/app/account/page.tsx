import type { Metadata } from 'next';
import { currentUserId } from '@/lib/auth';
import { AccountView } from '@/components/account/AccountView';

export const metadata: Metadata = { title: 'Your account — Vemporium', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const userId = await currentUserId();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 font-display text-3xl text-maroon">Your account</h1>
      <AccountView signedInAs={userId} />
    </main>
  );
}