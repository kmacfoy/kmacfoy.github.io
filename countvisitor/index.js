module.exports = async function (context, req) {
  context.log("🚀 countvisitor function started");

  let CosmosClient;

  try {
    const cosmosModule = require("@azure/cosmos");
    CosmosClient = cosmosModule.CosmosClient;
  } catch (importErr) {
    context.log("❌ Failed to load @azure/cosmos:", importErr.message);
    context.log("Has COSMOS_ENDPOINT:", !!process.env.COSMOS_ENDPOINT, "Has COSMOS_KEY:", !!process.env.COSMOS_KEY);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: `Module load error: ${importErr.message}` }
    };
    return;
  }

  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  const databaseId = 'visitors';
  const containerId = 'counter';

  const client = new CosmosClient({ endpoint, key });

  try {
    const container = client.database(databaseId).container(containerId);
    const { resource: item } = await container.item('visitorCount', 'visitorCount').read();

    if (!item) {
      throw new Error("visitorCount item not found in Cosmos DB");
    }

    context.log("🔢 Item before increment:", item);

    item.count += 1;
    await container.item('visitorCount', 'visitorCount').replace(item);

    context.log("✅ Item after update:", item);

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "https://resume.kaymacfoy.com",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin"
      },
      body: { count: item.count }
    };

    context.log("📤 Response sent.");
  } catch (err) {
    context.log(`❌ ERROR: ${err.message}`);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { error: err.message }
    };
  }
};
