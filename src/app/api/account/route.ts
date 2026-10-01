/**
 * Account data-subject rights.
 *
 *   GET    /api/account   Art. 15/20 — download everything we hold
 *   DELETE /api/account   Art. 17  — delete the account and its avatars
 *
 * DELETE is deliberately awkward to trigger by accident: it requires an
 * explicit `{"confirm": "DELETE"}` body. Erasure is irreversible, and a stray
 * double-click should not be enough to destroy someone's saved avatars.
 */

import { NextResponse } from 'next/server';
import { currentUserId } from '@/lib/auth';
import { exportData, eraseAccount } from '@/lib/privacy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const data = await exportData();
  if (!data) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  return NextResponse.json(data, {
    headers: {
      // Forces a download rather than rendering it in the browser.
      'content-disposition': 'attachment; filename="vemporium-my-data.json"',
      // Personal data must never sit in a shared cache.
      'cache-control': 'private, no-store',
    },
  });
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: { confirm?: string };
  try {
    body = (await request.json()) as { confirm?: string };
  } catch {
    return NextResponse.json({ error: 'Body must be {"confirm":"DELETE"}' }, { status: 400 });
  }

  if (body.confirm !== 'DELETE') {
    return NextResponse.json(
      { error: 'Erasure is permanent. Send {"confirm":"DELETE"} to proceed.' },
      { status: 428 },
    );
  }

  const result = await eraseAccount(userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ erased: true });
}
