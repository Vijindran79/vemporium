/**
 * GDPR data-subject rights for body measurements.
 *
 * Body measurements are special-category personal data (GDPR Art. 9). That
 * raises the bar, so the two rights that actually matter for them are
 * implemented as SEPARATE operations:
 *
 *   exportData()   — Art. 15/20: everything we hold, machine-readable
 *   eraseAvatar()  — Art. 17: delete one avatar, keep shopping
 *   eraseAccount() — Art. 17: delete the account and cascade everything
 *
 * Erasure is a HARD delete, not a soft flag. A soft-deleted row is still
 * personal data under GDPR, which is the opposite of what was asked for. Sales
 * records that tax law requires us to keep are the one exception, and they are
 * detached from the identity first.
 */

import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { currentUserId } from './auth';

export interface AvatarExport {
  id: string;
  label: string;
  gender: string;
  heightCm: number;
  weightKg: number;
  bustCm: number | null;
  chestCm: number | null;
  waistCm: number;
  hipCm: number;
  skinToneHex: string;
  hairStyleId: string | null;
  hairColorHex: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataExport {
  exportedAt: string;
  account: {
    email: string;
    name: string | null;
    countryCode: string | null;
    locale: string;
    createdAt: string;
  };
  avatars: AvatarExport[];
  orders: {
    reference: string;
    status: string;
    currency: string;
    total: string;
    destinationCountry: string;
    createdAt: string;
    items: { title: string; size: string; quantity: number }[];
  }[];
  /**
   * The order financial record survives erasure, but the body measurements on
   * it do not.
   *
   * An Order row is retained because tax law requires it, and that row carries
   * `fittingSnapshot` — body measurements, which are special-category personal
   * data. Tax law requires the SALES RECORD, not the customer's waist.
   * eraseAccount scrubs the snapshot while keeping the money, so what remains
   * is no longer personal data.
   */
  retentionNotice: string;
}

export const RETENTION_NOTICE =
  'Avatars and account data are deleted on request. Sales records are retained with your email and body measurements removed, because tax law requires us to keep the transaction but not the measurements.';

function toExport(row: {
  id: string;
  label: string;
  gender: string;
  heightCm: number;
  weightKg: number;
  bustCm: number | null;
  chestCm: number | null;
  waistCm: number;
  hipCm: number;
  skinToneHex: string;
  hairStyleId: string | null;
  hairColorHex: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AvatarExport {
  return {
    id: row.id,
    label: row.label,
    gender: row.gender,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    bustCm: row.bustCm,
    chestCm: row.chestCm,
    waistCm: row.waistCm,
    hipCm: row.hipCm,
    skinToneHex: row.skinToneHex,
    hairStyleId: row.hairStyleId,
    hairColorHex: row.hairColorHex,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Art. 15/20 — a complete, portable copy of the personal data we hold. */
export async function exportData(userId?: string): Promise<DataExport | null> {
  const id = userId ?? (await currentUserId());
  if (!id) return null;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      avatars: { orderBy: { createdAt: 'asc' } },
      orders: {
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { product: { select: { title: true } } } } },
      },
    },
  });
  if (!user) return null;

  return {
    exportedAt: new Date().toISOString(),
    account: {
      email: user.email,
      name: user.name,
      countryCode: user.countryCode,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
    },
    avatars: user.avatars.map(toExport),
    orders: user.orders.map((o) => ({
      reference: o.reference,
      status: o.status,
      currency: o.currency,
      total: o.totalLocal.toString(),
      destinationCountry: o.destinationCountry,
      createdAt: o.createdAt.toISOString(),
      items: o.items.map((i) => ({ title: i.product.title, size: i.variantLabel, quantity: i.quantity })),
    })),
    retentionNotice: RETENTION_NOTICE,
  };
}

/**
 * Art. 17 — delete one avatar. The account, and the ability to shop, stay intact.
 *
 * Scoped by userId on purpose: an avatar id alone must never be sufficient, or
 * this is an IDOR that lets anyone delete anyone else's body data.
 */
export async function eraseAvatar(avatarId: string, userId?: string): Promise<{ ok: boolean; error?: string }> {
  const id = userId ?? (await currentUserId());
  if (!id) return { ok: false, error: 'Not signed in' };

  const deleted = await prisma.avatarProfile.deleteMany({ where: { id: avatarId, userId: id } });
  if (deleted.count === 0) return { ok: false, error: 'Avatar not found' };
  return { ok: true };
}

/**
 * Art. 17 — delete the account and every trace of it.
 *
 * Orders are retained (tax law) but detached from the identity first, so the
 * retained record is no longer personal data. Sessions are deleted so the
 * shopper is signed out everywhere immediately, not at token expiry.
 */
export async function eraseAccount(userId?: string): Promise<{ ok: boolean; error?: string }> {
  const id = userId ?? (await currentUserId());
  if (!id) return { ok: false, error: 'Not signed in' };

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return { ok: false, error: 'Account not found' };

  const orderIds = (await prisma.order.findMany({ where: { userId: id }, select: { id: true } })).map((o) => o.id);

  await prisma.$transaction(async (tx) => {
    // Re-parent retained sales records to a tombstone before removing the user,
    // because Order.userId is required and the cascade would take them with it.
    if (orderIds.length > 0) {
      const tombstone = await tx.user.create({
        data: { email: `erased+${id}@invalid.local`, name: 'Erased customer', marketingOptIn: false },
      });
      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: {
          userId: tombstone.id,
          // The snapshot is special-category body data sitting on a row we are
          // keeping for TAX reasons. Tax law requires the transaction, not the
          // customer's waist measurement. Without this line, "erase my account"
          // would leave their body measurements on disk indefinitely — which is
          // precisely the promise this function makes to the customer.
          fittingSnapshot: Prisma.DbNull,
          guestEmail: null,
        },
      });
    }
    await tx.session.deleteMany({ where: { userId: id } });
    // Cascades avatars, accounts and any remaining sessions.
    await tx.user.delete({ where: { id } });
  });

  return { ok: true };
}
