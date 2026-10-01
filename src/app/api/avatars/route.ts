/**
 * Avatar persistence.
 *
 *   GET    /api/avatars      list the signed-in shopper's avatars
 *   POST   /api/avatars      create or update (upsert by `id` when supplied)
 *   DELETE /api/avatars?id=  delete one (Art. 17)
 *
 * Every handler resolves the user from the SESSION, never from the request
 * body. Accepting a userId from the client would make every route here an IDOR
 * over Art. 9 data.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { currentUserId } from '@/lib/auth';
import { eraseAvatar } from '@/lib/privacy';
import type { Gender } from '@prisma/client';

const GENDERS: Gender[] = ['MALE', 'FEMALE', 'KID_BOY', 'KID_GIRL'];

interface AvatarInput {
  id?: string;
  label?: string;
  gender?: Gender;
  heightCm?: number;
  weightKg?: number;
  bustCm?: number | null;
  chestCm?: number | null;
  waistCm?: number;
  hipCm?: number;
  skinToneHex?: string;
  hairStyleId?: string | null;
  hairColorHex?: string | null;
}

interface ValidAvatar {
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

/**
 * Validates and clamps a measurement payload.
 *
 * Every field is range-checked rather than trusted. These numbers drive a
 * garment's fit and a purchase; a NaN or a 900cm waist from a bad client would
 * poison the avatar and yield a nonsense size recommendation.
 */
function validate(input: AvatarInput): { ok: true; data: ValidAvatar } | { ok: false; error: string } {
  const clamp = (v: unknown, min: number, max: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('not-a-number');
    return Math.min(max, Math.max(min, n));
  };
  const hex = (v: unknown, fallback: string | null): string | null => {
    const s = String(v ?? fallback ?? '');
    return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
  };

  if (input.gender !== undefined && !GENDERS.includes(input.gender)) {
    return { ok: false, error: 'Invalid gender' };
  }

  try {
    return {
      ok: true,
      data: {
        label: String(input.label ?? 'My avatar').slice(0, 60),
        gender: input.gender ?? 'FEMALE',
        heightCm: clamp(input.heightCm ?? 168, 80, 230),
        weightKg: clamp(input.weightKg ?? 62, 10, 250),
        bustCm: input.bustCm == null ? null : clamp(input.bustCm, 40, 200),
        chestCm: input.chestCm == null ? null : clamp(input.chestCm, 40, 200),
        waistCm: clamp(input.waistCm ?? 70, 35, 200),
        hipCm: clamp(input.hipCm ?? 96, 40, 220),
        skinToneHex: hex(input.skinToneHex, '#B87D52')!,
        hairStyleId: input.hairStyleId ? String(input.hairStyleId).slice(0, 40) : null,
        hairColorHex: hex(input.hairColorHex, null),
      },
    };
  } catch {
    return { ok: false, error: 'Measurements must be numbers' };
  }
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const avatars = await prisma.avatarProfile.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json({ avatars });
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: AvatarInput;
  try {
    body = (await request.json()) as AvatarInput;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const result = validate(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  if (body.id) {
    // Scoped to the owner: an id belonging to someone else matches zero rows
    // rather than modifying another user's body data.
    const updated = await prisma.avatarProfile.updateMany({
      where: { id: body.id, userId },
      data: result.data,
    });
    if (updated.count === 0) return NextResponse.json({ error: 'Avatar not found' }, { status: 404 });
    const row = await prisma.avatarProfile.findUnique({ where: { id: body.id } });
    return NextResponse.json({ avatar: row });
  }

  // A per-user cap, so one account cannot grow unbounded rows in our database.
  const count = await prisma.avatarProfile.count({ where: { userId } });
  if (count >= 10) {
    return NextResponse.json({ error: 'You can save up to 10 avatars. Delete one to make room.' }, { status: 409 });
  }

  const row = await prisma.avatarProfile.create({ data: { ...result.data, userId } });
  return NextResponse.json({ avatar: row }, { status: 201 });
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const result = await eraseAvatar(id, userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ deleted: id });
}