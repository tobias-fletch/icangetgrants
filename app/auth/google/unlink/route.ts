import { handleUnlink } from '@/lib/google-auth';
import { authEnv, linkStore } from '@/app/auth/google-env';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handleUnlink(request, authEnv(), linkStore());
}
