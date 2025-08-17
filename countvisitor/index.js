// countvisitor/index.js
module.exports = async function (context, req) {
  // --- Safe logger polyfill so tests don't crash ---
  const baseLog = context?.log || (() => {});
  const log = (...args) => baseLog(...args);
  const logError =
    (typeof context?.log === "object" && typeof context.log.error === "function")
      ? context.log.error.bind(context.log)
      : (...args) => baseLog(...args); // fall back to normal log in tests

  log("countvisitor invoked");

  // CORS allow-list
  const allowed = new Set([
    "https://resume.kaymacfoy.com",
    "https://kmreshtml.z13.web.core.windows.net",
  ]);
  const reqOrigin = req?.headers?.origin;
  const corsOrigin = allowed.has(reqOrigin) ? reqOrigin : "https://resume.kaymacfoy.com";
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
      endpoint: process.env.COSMOS_ENDPOINT, // e.g. https://kmrescounter.documents.azure.com:443/
      key: process.env.COSMOS_KEY,
    });

    const databaseId = "visitors";
    const containerId = "counter";
    const container = client.database(databaseId).container(containerId);

    // Partition key is `/id` so use id === 'visitorCount'
    const id = "visitorCount";
    let item;

    // Read existing item (id, partitionKey) → partitionKey is the id itself
    try {
      const { resource } = await container.item(id, id).read();
      item = resource;
    } catch (e) {
      if (e?.code === 404) {
        item = { id, count: 0 };
      } else {
        throw e;
      }
    }

    item.count = (item.count ?? 0) + 1;

    // Upsert with matching partition key
    await container.items.upsert(item, { partitionKey: id });

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { count: item.count },
    };
  } catch (err) {
    const code = err?.code || err?.statusCode;
    const msg = err?.message || String(err);
    logError("❌ Handler error:", code ? `[${code}]` : "", msg);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: msg, code: code || "UNKNOWN" },
    };
  }
};