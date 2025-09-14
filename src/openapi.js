app.get('/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'Allowlist API',
      version: '1.2.0'
    },
    paths: {
      '/entries': {
        post: {
          summary: 'Create entry',
          description: 'Crea un registro nuevo. Devuelve 409 si username, email o mm_uid ya existen.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['username', 'email', 'panelUrl', 'token'],
                  properties: {
                    username: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    panelUrl: { type: 'string', format: 'uri' },
                    token: { type: 'string' },
                    active: { type: 'boolean', default: true },
                    mm_uid: { type: 'string', nullable: true }
                  }
                }
              }
            }
          },
          responses: {
            201: { description: 'Created', content: { 'application/json': {} } },
            409: { description: 'Conflict (username/email/mm_uid already exist)' }
          }
        },
        get: {
          summary: 'List entries',
          parameters: [
            { name: 'email', in: 'query', schema: { type: 'string' } },
            { name: 'username', in: 'query', schema: { type: 'string' } },
            { name: 'domain', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } }
          ],
          responses: {
            200: { description: 'OK', content: { 'application/json': {} } }
          }
        }
      },
      '/entries/{id}': {
        get: {
          summary: 'Get entry by id',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } }
        },
        put: {
          summary: 'Update entry by id',
          description: 'Actualiza un registro existente. Devuelve 409 si intenta usar valores únicos que ya están en otro registro.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: {
                  username: { type: 'string' },
                  email: { type: 'string' },
                  panelUrl: { type: 'string' },
                  token: { type: 'string' },
                  active: { type: 'boolean' },
                  mm_uid: { type: 'string', nullable: true }
                }}
              }
            }
          },
          responses: { 200: { description: 'Updated' }, 409: { description: 'Conflict' } }
        },
        delete: {
          summary: 'Delete entry by id',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'Deleted' } }
        }
      },
      '/validate': {
        get: {
          summary: 'Validate entry',
          description: 'Verifica si un usuario es válido por email/username/mm_uid. Solo válido si active=1.',
          parameters: [
            { name: 'email', in: 'query', schema: { type: 'string' } },
            { name: 'username', in: 'query', schema: { type: 'string' } },
            { name: 'mm_uid', in: 'query', schema: { type: 'string' } }
          ],
          responses: { 200: { description: 'OK' } }
        }
      }
    },
    components: {
      schemas: {
        Entry: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            username: { type: 'string' },
            email: { type: 'string' },
            panelUrl: { type: 'string' },
            token: { type: 'string' },
            active: { type: 'boolean' },
            mm_uid: { type: 'string', nullable: true },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' }
          }
        }
      }
    }
  });
});
