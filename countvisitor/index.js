// countvisitor/index.js
module.exports = async function (context, req) {
  // --- Safe logger polyfill so tests don't crash ---
  const baseLog = context?.log || (() => {});
  const log = (...args) => baseLog(...args);
  const logError =
    (typeof context?.log === "object" && typeof context.log.error === "function")
      ? context.log.error.bind(context.log)
      : (...args) => baseLog(...args);

  log("countvisitor invoked");

  const debug = req?.query?.debug === "1";

  // CORS allow-list
  const allowed = new Set([
    "https://resume.kaymacfoy.com",
    "https://kmreshtml.z13.web.core.windows.net",
  ]);
  const reqOrigin = req?.headers?.origin;
  const corsOrigin = allowed.has(reqOrigin)
    ? reqOrigin
    : "https://resume.kaymacfoy.com";

  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };

  // Quick env diagnostics (non-secret)
  const hasEndpoint = !!process.env.COSMOS_ENDPOINT;
  const hasKey = !!process.env.COSMOS_KEY;
  log(`Has COSMOS_ENDPOINT: ${hasEndpoint}, Has COSMOS_KEY: ${hasKey}`);

  // Load Cosmos SDK safely
  let CosmosClient;
  try {
    ({ CosmosClient } = require("@azure/cosmos"));
    log("Cosmos SDK loaded");
  } catch (e) {
    logError("Module load error:", e?.message || e);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: `Module load error: ${e?.message || e}` },
    };
    return;
  }

  try {
    if (!hasEndpoint || !hasKey) {
      throw new Error("Missing COSMOS_ENDPOINT or COSMOS_KEY");
    }

    const client = new CosmosClient({
      endpoint: process.env.COSMOS_ENDPOINT,
      key: process.env.COSMOS_KEY,
    });

    const databaseId = "visitors";
    const containerId = "counter";
    const container = client.database(databaseId).container(containerId);

    // --- IDs (partition key is `/id`, so partitionKey === id) ---
    const totalId = "visitorCount";

    // Use UTC date; if you want Eastern, we can switch to a TZ-based formatter.
    const day = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const dailyId = `daily_${day}`;

    // helper: read-or-create
    async function readOrInit(id) {
  try {
    const { resource } = await container.item(id, id).read();
    if (!resource) return { id, count: 0 };
    return resource;
  } catch (e) {
    const status = e?.code ?? e?.statusCode;
    if (status === 404) return { id, count: 0 };
    throw e;
  }
}

    // increment total
    const total = await readOrInit(totalId);
    total.count = (total.count ?? 0) + 1;
    await container.items.upsert(total, { partitionKey: totalId });

    // increment daily
    const daily = await readOrInit(dailyId);
    daily.count = (daily.count ?? 0) + 1;
    await container.items.upsert(daily, { partitionKey: dailyId });

    const body = debug
      ? {
          count: total.count,
          today: daily.count,
          _debug: { hasEndpoint, hasKey, day, totalId, dailyId },
        }
      : { count: total.count, today: daily.count };

    context.res = { status: 200, headers: corsHeaders, body };
  } catch (err) {
    const code = err?.code || err?.statusCode || err?.name || "UNKNOWN";
    const msg = err?.message || String(err);
    const extra = err?.body?.message || err?.body?.toString?.();

    logError("❌ Handler error:", code ? `[${code}]` : "", msg, extra);

    context.res = {
      status: 500,
      headers: corsHeaders,
      body: {
        error: msg,
        code,
        extra,
        stack: err?.stack,
      },
    };
  }
};