import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton.
 *
 * Next.js dev mode hot-reloads modules, which would otherwise open a new
 * connection pool on every edit until Postgres refuses connections. Stashing
 * the client on globalThis in development is the documented workaround.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
