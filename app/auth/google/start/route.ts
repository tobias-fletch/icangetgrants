import { handleStart } from '@/lib/google-auth';
import { authEnv } from '@/app/auth/google-env';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleStart(request, authEnv());
}
