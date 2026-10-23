// DO NOT MERGE: feasibility probe helper. Reads Worker env bindings (Site secrets).
import { env } from "cloudflare:workers";
import type { ProbeEnv } from "@/lib/google-probe";

export function probeEnv(): ProbeEnv {
  return env as unknown as ProbeEnv;
}
