const TEST_SIGNING_SECRET = 'unit-test-secret-not-for-deployment';

export const secrets = {
  get(name) {
    return name === 'HARNESS_SIGNING_SECRET' ? TEST_SIGNING_SECRET : undefined;
  },
};