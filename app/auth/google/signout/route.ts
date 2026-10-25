import { handleSignout } from '@/lib/google-auth';
import { authEnv } from '@/app/auth/google-env';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleSignout(request, authEnv());
}

export function POST(request: Request) {
  return handleSignout(request, authEnv());
}
