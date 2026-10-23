// DO NOT MERGE: Google sign-in feasibility probe. Isolated from ChatGPT sign-in and owner checks.
import { handleProbe } from "@/lib/google-probe";
import { probeEnv } from "@/app/auth/probe-env";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleProbe(request, probeEnv());
}
