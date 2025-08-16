// countvisitor/index.js
module.exports = async function (context, req) {
  context.log("countvisitor invoked");

  // Helpful diagnostics
  const hasEndpoint = !!process.env.COSMOS_ENDPOINT;
  const hasKey = !!process.env.COSMOS_KEY;
  context.log(`Has COSMOS_ENDPOINT: ${hasEndpoint}, Has COSMOS_KEY: ${hasKey}`);

  // Load SDK safely
  let CosmosClient;
  try {
    ({ CosmosClient } = require("@azure/cosmos"));
  } catch (e) {
    context.log(`Module load error: ${e.message}`);
    context.res = { status: 500, headers: { "Content-Type": "application/json" }, body: { error: `Module load error: ${e.message}` } };
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

    // read or create
    const pk = { partitionKey: "visitorCount" };
    let item;
    try {
      ({ resource: item } = await container.item("visitorCount", "visitorCount").read());
    } catch (e) {
      if (e.code === 404) {
        item = { id: "visitorCount", count: 0 };
      } else {
        throw e;
      }
    }

    item.count = (item.count ?? 0) + 1;
    await container.items.upsert(item, pk);

    // CORS
    const allowed = new Set([
      "https://resume.kaymacfoy.com",
      "https://kmreshtml.z13.web.core.windows.net",
    ]);
    const origin = allowed.has(req?.headers?.origin) ? req.headers.origin : "https://resume.kaymacfoy.com";

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
      },
      body: { count: item.count },
    };
  } catch (err) {
    context.log(`❌ ERROR: ${err.message}`);
    context.res = { status: 500, headers: { "Content-Type": "application/json" }, body: { error: err.message } };
  }
};
