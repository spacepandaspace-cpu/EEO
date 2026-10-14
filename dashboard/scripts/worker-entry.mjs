// Loaded as a virtual module next to the built application by run-server.mjs.
import app from './index.js';

const entry = {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.searchParams.has('sso_token') && !url.pathname.startsWith('/api/')) {
      url.pathname = '/api/auth/workbench';
      return app.fetch(new Request(url, request), env, ctx);
    }
    return app.fetch(request, env, ctx);
  },
};

export default entry;
