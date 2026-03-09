export default async function handler(request, context) {
  const PASSWORD = "wld-tool-001"; // 👈 Changez ici

  const authHeader = request.headers.get("authorization");

  if (authHeader) {
    const base64 = authHeader.replace("Basic ", "");
    const decoded = atob(base64);
    const [, password] = decoded.split(":");

    if (password === PASSWORD) {
      return context.next();
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