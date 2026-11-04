// Microsoft Entra ID (Azure AD) single sign-on — OpenID Connect authorization-code flow with PKCE.
//
//   GET /api/auth/sso/start     -> redirects the browser to Microsoft's sign-in page
//   GET /api/auth/sso/callback  -> Microsoft redirects back here (this is the "Redirect URI")
//
// Register the callback URL as a *Web* redirect URI on the app registration in Entra ID:
//   local:      http://localhost:5173/api/auth/sso/callback  (and/or http://127.0.0.1:5173/…)
//   deployed:   https://<your-domain>/api/auth/sso/callback
//
// SSO never creates accounts. A Microsoft user is matched to an existing, active ShiftGo
// account first by Entra object id (employees.sso_subject), otherwise by email — on the first
// match the object id is stored so later renames of the email still sign in to the same account.
import { one, statement, database, now, makeSession, sessionCookie, isHttps, rateLimit, auditStatement, sha, token, runtime, clientIp } from './core';
import type { Employee } from './types';

const COOKIE = 'nightshift_sso';
const COOKIE_PATH = '/api/auth/sso';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SsoConfig = { tenant: string; clientId: string; clientSecret: string };

function config(): SsoConfig | null {
  const tenant = String(runtime.AZURE_AD_TENANT_ID || '').trim();
  const clientId = String(runtime.AZURE_AD_CLIENT_ID || '').trim();
  const clientSecret = String(runtime.AZURE_AD_CLIENT_SECRET || '').trim();
  if (!GUID.test(tenant) || !GUID.test(clientId) || !clientSecret) return null;
  return { tenant: tenant.toLowerCase(), clientId: clientId.toLowerCase(), clientSecret };
}

/** Public SSO status for the login page. */
export function ssoInfo() {
  return { enabled: !!config(), provider: 'microsoft' as const };
}

/** The Redirect URI to register in Entra ID. AZURE_AD_REDIRECT_URI wins, then SITE_URL, then the request origin. */
export function redirectUri(request: Request) {
  const explicit = String(runtime.AZURE_AD_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const base = String(runtime.SITE_URL || '').trim().replace(/\/+$/, '') || new URL(request.url).origin;
  return `${base}${COOKIE_PATH}/callback`;
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeJwtPayload(jwt: string): Record<string, any> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch { return null; }
}
const safeNext = (v: string | null) => (v === '/admin' || v === '/app' ? v : '/');
function readCookie(request: Request) {
  const raw = request.headers.get('cookie')?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
  const [state, nonce, verifier, next] = raw.split('.');
  return state && nonce && verifier ? { state, nonce, verifier, next: safeNext(next ? decodeURIComponent(next) : null) } : null;
}
const flowCookie = (value: string, secure: boolean, maxAge: number) =>
  `${COOKIE}=${value}; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Path=${COOKIE_PATH}; Max-Age=${maxAge}`;

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}
function fail(request: Request, code: string) {
  return redirect(`/?sso_error=${encodeURIComponent(code)}`, [flowCookie('', isHttps(request), 0)]);
}

/** The session cookie is SameSite=Strict, so it is not sent on the cross-site redirect chain coming
 * back from Microsoft. Finish on a tiny same-origin page that then navigates into the app. */
function landing(next: string, cookies: string[]) {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${next}"><title>Signing in…</title><body style="background:#000;color:#ededed;font-family:system-ui;padding:24px">Signing you in… <a style="color:#ededed" href="${next}">Continue</a></body>`,
    { status: 200, headers },
  );
}

export async function ssoRoute(request: Request, path: string): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(request.url);
  const cfg = config();
  if (!cfg) return fail(request, 'not_configured');
  const authority = `https://login.microsoftonline.com/${cfg.tenant}`;

  if (path === 'auth/sso/start') {
    const state = token(), nonce = token(), verifier = token();
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const next = safeNext(url.searchParams.get('next'));
    const auth = new URL(`${authority}/oauth2/v2.0/authorize`);
    auth.search = new URLSearchParams({
      client_id: cfg.clientId, response_type: 'code', response_mode: 'query', redirect_uri: redirectUri(request),
      scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    }).toString();
    return redirect(auth.toString(), [flowCookie(`${state}.${nonce}.${verifier}.${encodeURIComponent(next)}`, isHttps(request), 600)]);
  }

  if (path === 'auth/sso/callback') {
    const flow = readCookie(request);
    if (url.searchParams.get('error')) return fail(request, url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'provider_error');
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    if (!flow || !code || !state || state !== flow.state) return fail(request, 'expired');
    try { await rateLimit(`sso:${clientIp(request)}`, 60); } catch { return fail(request, 'rate_limited'); }

    // Exchange the code directly with Microsoft over TLS using the client secret. Per OpenID Connect
    // Core §3.1.3.7, an ID token received this way may be trusted without a separate signature check;
    // the issuer, audience, tenant, nonce and expiry are still validated below.
    let tokens: Record<string, any>;
    try {
      const res = await fetch(`${authority}/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri(request), code_verifier: flow.verifier }),
      });
      tokens = await res.json();
      if (!res.ok) { console.error('SSO token exchange failed', tokens?.error, tokens?.error_codes); return fail(request, 'provider_error'); }
    } catch { return fail(request, 'provider_error'); }

    const claims = decodeJwtPayload(String(tokens.id_token || ''));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!claims || claims.aud !== cfg.clientId || claims.tid !== cfg.tenant || claims.iss !== `${authority}/v2.0` ||
        claims.nonce !== flow.nonce || !(Number(claims.exp) > nowSec - 60) || !GUID.test(String(claims.oid || '')))
      return fail(request, 'invalid_token');

    const oid = String(claims.oid).toLowerCase();
    const mail = String(claims.email || claims.preferred_username || '').trim().toLowerCase();
    let e = await one('SELECT * FROM employees WHERE sso_subject=? AND deleted_at IS NULL', oid) as Employee | null;
    let linked = false;
    if (!e && mail) {
      e = await one('SELECT * FROM employees WHERE lower(email)=? AND sso_subject IS NULL AND deleted_at IS NULL', mail) as Employee | null;
      linked = !!e;
    }
    if (!e) return fail(request, 'no_account');
    if (!e.active) return fail(request, 'inactive');

    const t = now();
    await database().batch([
      // Microsoft verified the identity, so a pending temporary-password change no longer applies.
      statement('UPDATE employees SET sso_subject=?, must_change_password=0, last_active_at=?, updated_at=? WHERE id=?', oid, t, t, e.id),
      auditStatement(e.id, linked ? 'auth.sso_linked' : 'auth.sso_login', e.id, { provider: 'microsoft', email: mail, oidHash: (await sha(oid)).slice(0, 16) }),
    ]);
    const raw = await makeSession(e.id);
    return landing(flow.next, [sessionCookie(raw, isHttps(request)), flowCookie('', isHttps(request), 0)]);
  }

  return new Response('Not found', { status: 404 });
}
