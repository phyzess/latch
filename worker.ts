import {
  authenticateRequest,
  handleRequest,
  type AuthSession,
  type Env,
} from "@phyzess/latch/worker";

export type { Env };

export interface LatchEnv extends Env {
  LATCH_AUTH_PASSWORD?: string;
  LATCH_AUTH_SECRET?: string;
  LATCH_AUTH_EMAIL?: string;
  LATCH_AUTH_SESSION_TTL?: string;
  LATCH_AUTH_COOKIE_NAME?: string;
}

const DEFAULT_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const DEFAULT_COOKIE_NAME = "latch_session";
const LOGIN_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Latch 登录</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f6f8fb; }
  .card { width: min(92vw, 380px); padding: 32px 28px; border: 1px solid rgba(0,0,0,.08); border-radius: 16px; background: #fff; box-shadow: 0 12px 30px rgba(0,0,0,.05); }
  h1 { margin: 0 0 6px; font-size: 20px; }
  p.sub { margin: 0 0 22px; color: #64748b; font-size: 14px; }
  label { display: block; margin: 14px 0 6px; font-size: 14px; font-weight: 500; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 15px; background: #f8fafc; }
  input:focus { outline: 2px solid #3b82f6; border-color: transparent; }
  button { margin-top: 20px; width: 100%; padding: 11px 12px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .error { min-height: 18px; margin-top: 12px; color: #dc2626; font-size: 13px; }
  .hint { margin-top: 16px; color: #94a3b8; font-size: 12px; line-height: 1.5; }
</style>
</head>
<body>
<main class="card">
  <h1>Latch</h1>
  <p class="sub">登录后继续访问你的私有服务面板</p>
  <form id="login">
    <label for="email">邮箱</label>
    <input id="email" name="email" type="email" autocomplete="username" required autofocus />
    <label for="password">密码</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button id="submit" type="submit">登录</button>
    <div class="error" id="error"></div>
  </form>
  <p class="hint">登录状态会保存在当前浏览器中，默认 90 天免登录。</p>
</main>
<script>
const form = document.querySelector("#login");
const email = document.querySelector("#email");
const password = document.querySelector("#password");
const error = document.querySelector("#error");
const submit = document.querySelector("#submit");
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  submit.disabled = true;
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value.trim(), password: password.value })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "登录失败，请检查邮箱和密码。");
    }
    const next = new URLSearchParams(location.search).get("next");
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    location.href = target;
  } catch (err) {
    error.textContent = err && err.message ? err.message : "登录失败，请稍后重试。";
  } finally {
    submit.disabled = false;
  }
});
</script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: LatchEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Keep local development behaviour: localhost automatically gets an admin session.
    if (isLocalRequest(request)) {
      return handleRequest(request, env, ctx);
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return handleLogout(env);
    }

    if (url.pathname === "/login" && request.method === "GET") {
      const existing = await getSession(request, env);
      if (existing) {
        return Response.redirect(new URL("/", request.url), 302);
      }
      return html(LOGIN_PAGE);
    }

    // A valid long-lived Latch session is the primary auth mechanism.
    const session = await getSession(request, env);
    if (session) {
      return handleRequest(request, env, ctx, session);
    }

    // Optional fallback: if Cloudflare Access is still in front and supplies a JWT, keep it.
    if (env.POLICY_AUD && env.TEAM_DOMAIN) {
      try {
        const accessSession = await authenticateRequest(request, env);
        if (!(accessSession instanceof Response)) {
          return handleRequest(request, env, ctx, accessSession);
        }
      } catch {
        // Ignore Access misconfiguration; the built-in login path below will handle the request.
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Unauthorized" }, 401);
    }
    return html(LOGIN_PAGE);
  },
};

async function handleLogin(request: Request, env: LatchEnv): Promise<Response> {
  const passwordSecret = env.LATCH_AUTH_PASSWORD;
  if (!passwordSecret) {
    return json({ error: "LATCH_AUTH_PASSWORD is not configured." }, 500);
  }

  try {
    await verifySameOrigin(request);
  } catch {
    return json({ error: "Cross-origin login rejected." }, 403);
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || !isAllowedEmail(email, env)) {
    return json({ error: "Invalid email or password." }, 401);
  }
  if (!timingSafeEqual(password, passwordSecret)) {
    return json({ error: "Invalid email or password." }, 401);
  }

  const ttl = getSessionTtl(env);
  const token = await createSessionToken(email, ttl, env);
  const cookieName = getCookieName(env);
  const cookiePart = `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ttl}`;
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookiePart,
    },
    status: 200,
  });
}

function handleLogout(env: LatchEnv): Response {
  const cookieName = getCookieName(env);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
    status: 200,
  });
}

async function getSession(request: Request, env: LatchEnv): Promise<AuthSession | null> {
  const token = getCookie(request, getCookieName(env));
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [emailB64, expString, signature] = parts;
  const payload = `${emailB64}.${expString}`;
  const secret = env.LATCH_AUTH_SECRET ?? env.LATCH_AUTH_PASSWORD;
  if (!secret) {
    return null;
  }
  const expected = await signPayload(payload, secret);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  const expiresAt = Number(expString);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) {
    return null;
  }
  let email = "";
  try {
    email = new TextDecoder().decode(decodeBase64Url(emailB64)).toLowerCase();
  } catch {
    return null;
  }
  if (!isAllowedEmail(email, env)) {
    return null;
  }
  return {
    email,
    isAdmin: true,
    isLocal: false,
  };
}

async function createSessionToken(email: string, ttlSeconds: number, env: LatchEnv): Promise<string> {
  const secret = env.LATCH_AUTH_SECRET ?? env.LATCH_AUTH_PASSWORD;
  if (!secret) {
    throw new Error("Missing LATCH_AUTH_SECRET or LATCH_AUTH_PASSWORD.");
  }
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${encodeBase64Url(email)}.${expiresAt}`;
  const signature = await signPayload(payload, secret);
  return `${payload}.${signature}`;
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

function isAllowedEmail(email: string, env: LatchEnv): boolean {
  if (env.LATCH_AUTH_EMAIL && email === env.LATCH_AUTH_EMAIL.toLowerCase()) {
    return true;
  }
  return (env.LATCH_ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}

function getSessionTtl(env: LatchEnv): number {
  const value = Number.parseInt(env.LATCH_AUTH_SESSION_TTL ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SESSION_TTL_SECONDS;
}

function getCookieName(env: LatchEnv): string {
  return env.LATCH_AUTH_COOKIE_NAME || DEFAULT_COOKIE_NAME;
}

async function verifySameOrigin(request: Request): Promise<void> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!origin) {
    return;
  }
  const originUrl = new URL(origin);
  if (originUrl.host !== url.host) {
    throw new Error("Cross-origin login rejected.");
  }
}

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function encodeBase64Url(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}
