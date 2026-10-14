import 'server-only';
import { getDatabase } from '../scripts/node-sqlite.mjs';

// Credentials are read at runtime, never injected into the browser build.
export const env = {
  get DB() { return getDatabase(); },
  get AUTH_MODE() { return process.env.AUTH_MODE; },
  get DASHBOARD_ORIGIN() { return process.env.DASHBOARD_ORIGIN; },
  get EEO_SYNC_TOKEN() { return process.env.EEO_SYNC_TOKEN; },
  get WORKBENCH_SECRET() { return process.env.WORKBENCH_SECRET; },
  get WORKBENCH_ACCOUNT_TOKEN() { return process.env.WORKBENCH_ACCOUNT_TOKEN; },
  get WORKBENCH_LOGIN_URL() { return process.env.WORKBENCH_LOGIN_URL; },
  get WORKBENCH_LOGOUT_URL() { return process.env.WORKBENCH_LOGOUT_URL; },
  get WORKBENCH_REVOKE_MODE() { return process.env.WORKBENCH_REVOKE_MODE; },
  get WORKBENCH_INTROSPECT_URL() { return process.env.WORKBENCH_INTROSPECT_URL; },
  get WORKBENCH_INTROSPECT_TOKEN() { return process.env.WORKBENCH_INTROSPECT_TOKEN; },
};
