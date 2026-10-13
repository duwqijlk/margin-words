/**
 * Refuse a direct download of glossary.json from the public books host.
 * The reader loads a word list through /api/glossary/:id on inputread.site,
 * which applies the weekly cap. Catalogs, covers, and public-domain EPUBs
 * are not matched by this worker's routes.
 */
export default {
  fetch(): Response {
    return new Response(JSON.stringify({ error: "glossary-week" }), {
      status: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  },
};
