/**
 * Porkbun — our real, irreversible action.
 * DEMO_MODE unset -> sandbox keys (what judges run; fully functional, /sandbox/reset)
 * DEMO_MODE=live  -> live keys (what the video shows)
 * One env var, one code path, zero mocks.
 */
const BASE = "https://api.porkbun.com/api/json/v3";
const live = process.env.DEMO_MODE === "live";

const creds = () => ({
  apikey: (live ? process.env.PORKBUN_LIVE_API_KEY : process.env.PORKBUN_API_KEY) ?? "",
  secretapikey: (live ? process.env.PORKBUN_LIVE_SECRET_KEY : process.env.PORKBUN_SECRET_KEY) ?? "",
});

async function call(path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ ...creds(), ...body }),
  });
  return res.json() as Promise<any>;
}

export const isLive = () => live;
export const checkDomain = (d: string) => call(`/domain/checkDomain/${d}`);

/** dryRun:true returns wouldSucceed/cost/costDisplay/withinMonthlySpendLimit.
 *  This response IS the content of our approval card. Nothing is mocked. */
export const previewRegister = (d: string) => call(`/domain/create/${d}`, { dryRun: true });

export const register = (d: string, idempotencyKey: string) =>
  call(`/domain/create/${d}`, { agreeToTerms: "yes" }, { "Idempotency-Key": idempotencyKey });

export const getDomain = (d: string) => call(`/domain/get/${d}`);

export const upsertDns = (d: string, type: string, name: string, content: string) =>
  call(`/dns/create/${d}`, { type, name, content, ttl: "600" });
