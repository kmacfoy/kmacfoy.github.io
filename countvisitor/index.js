// countvisitor/index.js
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

  // Only expose debug information when explicitly enabled server-side
  // AND requested with ?debug=1.
  const debug =
    process.env.ENABLE_DEBUG === "true" &&
    req?.query?.debug === "1";

  // --- CORS allow-list ---
  const allowed = new Set([
    "https://resume.kaymacfoy.com",
    "https://kmreshtml.z13.web.core.windows.net",
  ]);

  const reqOrigin = req?.headers?.origin;
  const corsHeaders = {
    "Content-Type": "application/json",
    Vary: "Origin",
  };

  // Only return Access-Control-Allow-Origin for an approved origin.
  if (allowed.has(reqOrigin)) {
    corsHeaders["Access-Control-Allow-Origin"] = reqOrigin;
  }

  // Handle CORS preflight without touching Cosmos.
  if (req?.method === "OPTIONS") {
    context.res = {
      status: 204,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
      body: "",
    };
    return;
  }

  // Only GET is supported.
  if (req?.method && req.method !== "GET") {
    context.res = {
      status: 405,
      headers: {
        ...corsHeaders,
        Allow: "GET, OPTIONS",
      },
      body: { error: "Method not allowed" },
    };
    return;
  }

  // --- Environment diagnostics (non-secret) ---
  const hasEndpoint = !!process.env.COSMOS_ENDPOINT;
  const hasKey = !!process.env.COSMOS_KEY;

  log(`Has COSMOS_ENDPOINT: ${hasEndpoint}, Has COSMOS_KEY: ${hasKey}`);

  // --- Load Cosmos SDK safely ---
  let CosmosClient;

  try {
    ({ CosmosClient } = require("@azure/cosmos"));
    log("Cosmos SDK loaded");
  } catch (e) {
    logError("Module load error:", e?.message || e);

    context.res = {
      status: 500,
      headers: corsHeaders,
      body: debug
        ? {
            error: "Module load error",
            detail: e?.message || String(e),
          }
        : {
            error: "Internal server error",
          },
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

    // Partition key is `/id`, so partitionKey === id.
    const totalId = "visitorCount";

    // Use Eastern time for the daily counter.
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const dailyId = `daily_${day}`;

    // Read an existing counter or initialize a new one.
    async function readOrInit(id) {
      try {
        const { resource } = await container.item(id, id).read();

        if (!resource) {
          return { id, count: 0 };
        }

        return resource;
      } catch (e) {
        const status = e?.code ?? e?.statusCode;

        if (status === 404) {
          return { id, count: 0 };
        }

        throw e;
      }
    }

    // Increment total counter.
    const total = await readOrInit(totalId);
    total.count = (total.count ?? 0) + 1;

    await container.items.upsert(total, {
      partitionKey: totalId,
    });

    // Increment today's counter.
    const daily = await readOrInit(dailyId);
    daily.count = (daily.count ?? 0) + 1;

    await container.items.upsert(daily, {
      partitionKey: dailyId,
    });

    const body = debug
      ? {
          count: total.count,
          today: daily.count,
          _debug: {
            hasEndpoint,
            hasKey,
            day,
            totalId,
            dailyId,
          },
        }
      : {
          count: total.count,
          today: daily.count,
        };

    context.res = {
      status: 200,
      headers: corsHeaders,
      body,
    };
  } catch (err) {
    const code =
      err?.code ||
      err?.statusCode ||
      err?.name ||
      "UNKNOWN";

    const msg = err?.message || String(err);
    const extra =
      err?.body?.message ||
      err?.body?.toString?.();

    // Keep detailed diagnostics in Azure logs.
    logError(
      "❌ Handler error:",
      code ? `[${code}]` : "",
      msg,
      extra
    );

    // Don't expose internal details publicly.
    context.res = {
      status: 500,
      headers: corsHeaders,
      body: debug
        ? {
            error: msg,
            code,
            extra,
          }
        : {
            error: "Internal server error",
          },
    };
  }
};