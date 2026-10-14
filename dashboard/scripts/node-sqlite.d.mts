import type { DatabaseSync } from 'node:sqlite';
export type SqliteResult<T = Record<string, unknown>> = {success: boolean; results: T[]; meta: {changes?: number; last_row_id?: number}};
export interface SqliteStatement {
  bind(...values: unknown[]): SqliteStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqliteResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqliteResult<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}
export class SqliteDatabase {
  constructor(native: DatabaseSync);
  native: DatabaseSync;
  prepare(sql: string): SqliteStatement;
  batch<T = Record<string, unknown>>(statements: SqliteStatement[]): Promise<SqliteResult<T>[]>;
  exec(sql: string): Promise<{count: number; duration: number}>;
}
export function databaseFile(root?: string): string;
export function openSqlite(root?: string): DatabaseSync;
export function getDatabase(): SqliteDatabase;
export function closeDatabase(): void;
export function migrate(native: DatabaseSync, root: string): void;
