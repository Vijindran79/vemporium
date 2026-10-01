/**
 * Auth.js route handler. Mounts sign-in, sign-out, session and CSRF endpoints.
 * All the configuration lives in src/lib/auth.ts.
 */

import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
