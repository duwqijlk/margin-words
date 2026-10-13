/**
 * The books host stays public for catalogs, covers, and public-domain EPUBs.
 * A direct glossary.json download is refused. The reader loads a word list
 * through /api/glossary/:id on inputread.site, which applies the weekly cap.
 *
 * Routes can only wildcard the end of a path, so this worker is attached to
 * /word-lists/* and /public-books/* and forwards every other file.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/glossary.json")) {
      return new Response(JSON.stringify({ error: "glossary-week" }), {
        status: 403,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    return fetch(request);
  },
};
