import { getDatabase } from "../scripts/node-sqlite.mjs";
// The database is native SQLite; no remote database or Workers binding.
export function getDb() { return getDatabase(); }
