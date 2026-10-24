import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
export const runtime = "nodejs";
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const uiToken = process.env.DESKTOP_UI_TOKEN;
  if (uiToken) {
    const supplied = request.headers.get("x-studio-desktop-ui") || "";
    if (
      Buffer.byteLength(supplied) !== Buffer.byteLength(uiToken) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(uiToken))
    )
      return Response.json(
        { detail: "Accesso desktop non autorizzato" },
        { status: 403 },
      );
    const origin = request.headers.get("origin");
    if (origin && origin !== `http://${request.headers.get("host")}`)
      return Response.json(
        { detail: "Origine non consentita" },
        { status: 403 },
      );
  }
  const headers = new Headers({
    "Content-Type": request.headers.get("content-type") || "application/json",
  });
  if (request.headers.get("cookie"))
    headers.set("cookie", request.headers.get("cookie")!);
  if (process.env.DESKTOP_API_TOKEN)
    headers.set("x-studio-desktop-token", process.env.DESKTOP_API_TOKEN);
  try {
    let body: Uint8Array | undefined;
    if (!["GET", "HEAD"].includes(request.method) && request.body) {
      const libraryImport =
        path.length === 2 && path[0] === "kitchen" && path[1] === "import";
      const limit = libraryImport
        ? 20 * 1024 * 1024
        : path.includes("swatch")
          ? 2 * 1024 * 1024
          : 5 * 1024 * 1024;
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > limit) {
          await reader.cancel();
          return Response.json(
            { detail: "File o richiesta troppo grande" },
            { status: 413 },
          );
        }
        chunks.push(value);
      }
      body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
    }
    const response = await fetch(
      `${process.env.API_URL || "http://127.0.0.1:8000"}/api/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body: body as BodyInit | undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(
          (path[0] === "kitchen" && path[1] === "import") || path[0] === "plan"
            ? 60000
            : 15000,
        ),
      },
    );
    const outgoing = new Headers({
      "Content-Type":
        response.headers.get("content-type") || "application/json",
    });
    for (const name of ["cache-control", "x-content-type-options", "etag"]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    for (const cookie of response.headers.getSetCookie())
      outgoing.append("Set-Cookie", cookie);
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return Response.json(
      {
        detail:
          "Servizio non disponibile. Riprova: le modifiche locali sono conservate.",
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
