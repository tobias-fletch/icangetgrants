import { handleCallback } from '@/lib/google-auth';
import { authEnv, linkStore } from '@/app/auth/google-env';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleCallback(request, authEnv(), linkStore());
}
