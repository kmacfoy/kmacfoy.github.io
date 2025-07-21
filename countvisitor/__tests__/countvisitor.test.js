const countVisitor = require('../index');

describe('countVisitor function', () => {
  let context;

  beforeEach(() => {
    context = {
      log: jest.fn(),
      res: {}
    };
  });

  it('should return 500 if @azure/cosmos fails to load', async () => {
    jest.resetModules();
    jest.mock('@azure/cosmos', () => {
      throw new Error('Failed to load cosmos');
    });

    const brokenFunc = require('../index');
    await brokenFunc(context, {});
    expect(context.res.status).toBe(500);
    expect(context.res.body).toHaveProperty('error');
  });
});
