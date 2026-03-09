export default async function handler(request, context) {
  const PASSWORD = Netlify.env.get("DASHBOARD_PASSWORD");

  const authHeader = request.headers.get("authorization");

  if (authHeader && authHeader.startsWith("Basic ")) {
    try {
      const base64 = authHeader.slice(6);
      const decoded = new TextDecoder().decode(
        Uint8Array.from(atob(base64), c => c.charCodeAt(0))
      );
      const password = decoded.split(":").slice(1).join(":");

      if (password === PASSWORD) {
        return context.next();
      }
    } catch (e) {
      // décodage échoué
    }
  }

  return new Response("Accès refusé", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Dashboard – accès restreint"',
    },
  });
}

export const config = {
  path: "/*",
};