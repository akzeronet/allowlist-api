export const openapi = {
  openapi: '3.0.3',
  info: { title: 'Allowlist API', version: '1.0.0' },
  servers: [{ url: '/' }],
  paths: {
    '/health': { get: { summary: 'Healthcheck', responses: { '200': { description: 'OK' } } } },
    '/entries': {
      get: {
        summary: 'List entries',
        parameters: [
          { in: 'query', name: 'email', schema: { type: 'string' } },
          { in: 'query', name: 'username', schema: { type: 'string' } },
          { in: 'query', name: 'domain', schema: { type: 'string' } },
          { in: 'query', name: 'limit', schema: { type: 'integer' } },
          { in: 'query', name: 'offset', schema: { type: 'integer' } }
        ],
        responses: { '200': { description: 'OK' } }
      },
      post: { summary: 'Create or update by email', responses: { '201': { description: 'Created/Updated' } } }
    },
    '/entries/{id}': {
      get: { summary: 'Read one', responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } } },
      put: { summary: 'Update', responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } } },
      delete: { summary: 'Delete', responses: { '200': { description: 'OK' } } }
    },
    '/validate': {
      get: {
        summary: 'Validate user',
        parameters: [
          { in: 'query', name: 'email', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'username', required: false, schema: { type: 'string' } }
        ],
        responses: { '200': { description: 'OK' } }
      }
    }
  }
};
