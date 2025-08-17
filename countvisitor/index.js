// countvisitor/index.js
module.exports = async function (context, req) {
  // ---------- CORS (incl. preflight) ----------
  const allowedOrigins = new Set([
    "https://resume.kaymacfoy.com",
    "https://kmreshtml.z13.web.core.windows.net",
  ]);
  const reqOrigin = req?.headers?.origin;
  const corsOrigin = allowedOrigins.has(reqOrigin)
    ? reqOrigin
    : "https://resume.kaymacfoy.com";

  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };

  if ((req.method || "").toUpperCase() === "OPTIONS") {
    context.res = { status: 204, headers: corsHeaders };
    return;
  }

  // ---------- Diagnostics ----------
  context.log("countvisitor invoked");
  const hasEndpoint = !!process.env.COSMOS_ENDPOINT;
  const hasKey = !!process.env.COSMOS_KEY;
  context.log(`Has COSMOS_ENDPOINT: ${hasEndpoint}, Has COSMOS_KEY: ${hasKey}`);

  let CosmosClient;
  try {
    ({ CosmosClient } = require("@azure/cosmos"));
    context.log("Cosmos SDK loaded");
  } catch (e) {
    context.log.error("Module load error:", e?.message || e);
    context.res = { status: 500, headers: corsHeaders, body: { error: `Module load error: ${e?.message || e}` } };
    return;
  }

  try {
    if (!hasEndpoint || !hasKey) {
      throw new Error("Missing COSMOS_ENDPOINT or COSMOS_KEY");
    }

    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;

    // Allow overrides via env, else default to your known names
    const databaseId = process.env.COSMOS_DB || "visitors";
    const containerId = process.env.COSMOS_CONTAINER || "counter";

    const client = new CosmosClient({ endpoint, key });
    context.log(`Cosmos client created for ${endpoint}`);
    const container = client.database(databaseId).container(containerId);
    context.log(`Using DB='${databaseId}' Container='${containerId}'`);

    // Read-or-create the counter doc
    const pkValue = "visitorCount";
    const pk = { partitionKey: pkValue };
    let item;

    try {
      const read = await container.item(pkValue, pkValue).read();
      item = read.resource;
      context.log("Read ok; current count:", item?.count);
    } catch (e) {
      if (e?.code === 404) {
        context.log("Item missing; seeding new counter");
        item = { id: pkValue, count: 0 };
      } else {
        throw e; // surface non-404 errors
      }
    }

    // Increment safely
    const next = Number.isFinite(item?.count) ? item.count + 1 : 1;
    item.count = next;

    // Upsert (create if missing, replace if exists)
    await container.items.upsert(item, pk);
    context.log("Upsert ok; new count:", next);

    context.res = {
      status: 200,
      headers: corsHeaders,
      body: { count: next },
    };
  } catch (err) {
    // Capture Cosmos and other runtime errors with detail
    const code = err?.code || err?.statusCode;
    const msg = err?.message || String(err);
    context.log.error("❌ Handler error:", code ? `[${code}]` : "", msg);
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: { error: msg, code: code || "UNKNOWN" },
    };
  }
};
