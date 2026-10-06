/**
 * Hashed files under /assets. A missing script must not become the app page.
 * The catch-all rewrite serves index.html with status 200, and /assets is cached
 * for a year, so a browser keeps that page in place of the script and every
 * refresh stays blank.
 */

type AssetEnv = {
  ASSETS: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
};

const CODE_FILE = /\.(?:js|mjs|css|map|woff2?|svg|png|jpe?g|gif|webp|ico)$/i;

export const onRequest = async (context: { request: Request; env: AssetEnv }): Promise<Response> => {
  const { pathname } = new URL(context.request.url);
  const asset = await context.env.ASSETS.fetch(context.request);
  const type = asset.headers.get("content-type") ?? "";
  if (CODE_FILE.test(pathname) && (asset.status === 404 || type.includes("text/html"))) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "cdn-cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return asset;
};
