describe('countVisitor function', () => {
  let originalEnv;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    originalEnv = { ...process.env };

    process.env.COSMOS_ENDPOINT = 'https://example.documents.azure.com:443/';
    process.env.COSMOS_KEY = 'fake-test-key';
    delete process.env.ENABLE_DEBUG;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function makeContext() {
    const log = jest.fn();
    log.error = jest.fn();

    return {
      log,
      res: {},
    };
  }

  it('returns 500 if @azure/cosmos fails to load', async () => {
    jest.doMock('@azure/cosmos', () => {
      throw new Error('Failed to load cosmos');
    });

    const countVisitor = require('../index');
    const context = makeContext();

    await countVisitor(context, {
      method: 'GET',
      headers: {},
      query: {},
    });

    expect(context.res.status).toBe(500);
    expect(context.res.body).toEqual({
      error: 'Internal server error',
    });
  });

  it('returns 500 when Cosmos environment variables are missing', async () => {
    delete process.env.COSMOS_ENDPOINT;
    delete process.env.COSMOS_KEY;

    jest.doMock('@azure/cosmos', () => ({
      CosmosClient: jest.fn(),
    }));

    const countVisitor = require('../index');
    const context = makeContext();

    await countVisitor(context, {
      method: 'GET',
      headers: {},
      query: {},
    });

    expect(context.res.status).toBe(500);
    expect(context.res.body).toEqual({
      error: 'Internal server error',
    });
  });

  it('handles OPTIONS without accessing Cosmos', async () => {
    const CosmosClient = jest.fn();

    jest.doMock('@azure/cosmos', () => ({
      CosmosClient,
    }));

    const countVisitor = require('../index');
    const context = makeContext();

    await countVisitor(context, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://resume.kaymacfoy.com',
      },
      query: {},
    });

    expect(context.res.status).toBe(204);
    expect(CosmosClient).not.toHaveBeenCalled();
  });

  it('returns 405 for unsupported HTTP methods', async () => {
    const CosmosClient = jest.fn();

    jest.doMock('@azure/cosmos', () => ({
      CosmosClient,
    }));

    const countVisitor = require('../index');
    const context = makeContext();

    await countVisitor(context, {
      method: 'POST',
      headers: {},
      query: {},
    });

    expect(context.res.status).toBe(405);
    expect(CosmosClient).not.toHaveBeenCalled();
  });

  it('increments the lifetime and daily counters', async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce({
        resource: {
          id: 'visitorCount',
          count: 10,
        },
      })
      .mockResolvedValueOnce({
        resource: {
          id: expect.any(String),
          count: 3,
        },
      });

    const upsert = jest.fn().mockResolvedValue({});

    const item = jest.fn(() => ({
      read,
    }));

    const container = {
      item,
      items: {
        upsert,
      },
    };

    const database = {
      container: jest.fn(() => container),
    };

    const client = {
      database: jest.fn(() => database),
    };

    const CosmosClient = jest.fn(() => client);

    jest.doMock('@azure/cosmos', () => ({
      CosmosClient,
    }));

    const countVisitor = require('../index');
    const context = makeContext();

    await countVisitor(context, {
      method: 'GET',
      headers: {
        origin: 'https://resume.kaymacfoy.com',
      },
      query: {},
    });

    expect(context.res.status).toBe(200);
    expect(context.res.body.count).toBe(11);
    expect(context.res.body.today).toBe(4);

    expect(upsert).toHaveBeenCalledTimes(2);

    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'visitorCount',
        count: 11,
      }),
      {
        partitionKey: 'visitorCount',
      }
    );

    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        count: 4,
      }),
      expect.objectContaining({
        partitionKey: expect.stringMatching(/^daily_/),
      })
    );
  });

  it('initializes a missing counter and increments it to 1', async () => {
    const notFound = Object.assign(new Error('Not found'), {
      code: 404,
    });

    const read = jest
      .fn()
      .mockRejectedValueOnce(notFound)
      .mockRejectedValueOnce(notFound);

    const upsert = jest.fn().mockResolvedValue({});

    const container = {
      item: jest.fn(() => ({
        read,
      })),
      items: {
        upsert,
      },
    };

    const client = {
      database: jest.fn(() => ({
        container: jest.fn(() => container),
      })),
    };

    jest.doMock('@azure/cosmos', () => ({
      CosmosClient: jest.fn(() => client),
    }));

    const countVisitor = require('../index');
    const context = makeContext();

    await countVisitor(context, {
      method: 'GET',
      headers: {},
      query: {},
    });

    expect(context.res.status).toBe(200);
    expect(context.res.body.count).toBe(1);
    expect(context.res.body.today).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('returns CORS header for an approved origin', async () => {
    const read = jest.fn().mockResolvedValue({
      resource: {
        id: 'visitorCount',
        count: 1,
      },
    });

    const container = {
      item: jest.fn(() => ({
        read,
      })),
      items: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const client = {
      database: jest.fn(() => ({
        container: jest.fn(() => container),
      })),
    };

    jest.doMock('@azure/cosmos', () => ({
      CosmosClient: jest.fn(() => client),
    }));

    const countVisitor = require('../index');
    const context = makeContext();

    await countVisitor(context, {
      method: 'GET',
      headers: {
        origin: 'https://resume.kaymacfoy.com',
      },
      query: {},
    });

    expect(
      context.res.headers['Access-Control-Allow-Origin']
    ).toBe('https://resume.kaymacfoy.com');
  });

  it('does not return CORS header for an unapproved origin', async () => {
    const read = jest.fn().mockResolvedValue({
      resource: {
        id: 'visitorCount',
        count: 1,
      },
    });

    const container = {
      item: jest.fn(() => ({
        read,
      })),
      items: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };

    const client = {
      database: jest.fn(() => ({
        container: jest.fn(() => container),
      })),
    };

    jest.doMock('@azure/cosmos', () => ({
      CosmosClient: jest.fn(() => client),
    }));

    const countVisitor = require('../index');
    const context = makeContext();

    await countVisitor(context, {
      method: 'GET',
      headers: {
        origin: 'https://evil.example',
      },
      query: {},
    });

    expect(
      context.res.headers['Access-Control-Allow-Origin']
    ).toBeUndefined();
  });
});
