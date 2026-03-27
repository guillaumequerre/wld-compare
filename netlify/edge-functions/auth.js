export default async function handler(request, context) {
  const PASSWORD = Deno.env.get("DASHBOARD_PASSWORD") || "";

  // API routes have their own security (API keys) — skip Basic Auth
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return context.next();
  }

  const authHeader = request.headers.get("authorization") || "";

  if (authHeader.startsWith("Basic ")) {
    const base64 = authHeader.slice(6);
    const decoded = atob(base64);
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (password === PASSWORD) {
      return context.next();
    }
  }

  return new Response("Accès refusé", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Dashboard"',
    },
  });
}

export const config = {
  path: "/*",
};