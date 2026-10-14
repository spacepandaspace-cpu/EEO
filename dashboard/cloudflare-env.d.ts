declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    EEO_SYNC_TOKEN?: string;
    AUTH_MODE?: string;
    WORKBENCH_SECRET?: string;
    WORKBENCH_LOGIN_URL?: string;
    WORKBENCH_LOGOUT_URL?: string;
    WORKBENCH_REVOKE_MODE?: string;
    WORKBENCH_INTROSPECT_URL?: string;
    WORKBENCH_INTROSPECT_TOKEN?: string;
    BUCKET?: R2Bucket;
  }
}
