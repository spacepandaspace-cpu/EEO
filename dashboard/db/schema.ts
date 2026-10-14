import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const userAccounts = sqliteTable("user_account", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  role: text("role", { enum: ["admin", "consultant"] }).notNull(),
  consultantName: text("consultant_name"),
  passwordSalt: text("password_salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  encryptedPassword: text("encrypted_password"),
  passwordIv: text("password_iv"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_user_account_username").on(table.username),
  uniqueIndex("uq_user_account_consultant_name").on(table.consultantName),
  index("idx_user_account_role_enabled").on(table.role, table.enabled),
]);

export const authSessions = sqliteTable("auth_session", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => userAccounts.id),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_auth_session_user_id").on(table.userId),
  index("idx_auth_session_expires_at").on(table.expiresAt),
]);

export const customerLogs = sqliteTable("customer_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uid: text("uid").notNull(),
  type: text("type", { enum: ["客户反馈", "跟进记录"] }).notNull(),
  recordTime: text("record_time").notNull(),
  content: text("content").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => userAccounts.id),
  createdByName: text("created_by_name").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_customer_log_uid_record_time").on(table.uid, table.recordTime),
]);

export const auditLogs = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorUserId: integer("actor_user_id").references(() => userAccounts.id),
  actorName: text("actor_name").notNull(),
  action: text("action").notNull(),
  objectType: text("object_type").notNull(),
  objectId: text("object_id").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_audit_log_object").on(table.objectType, table.objectId),
  index("idx_audit_log_created_at").on(table.createdAt),
]);

export const sourceRuns = sqliteTable("source_run", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source", { enum: ["eeo", "crm"] }).notNull(),
  trigger: text("trigger", { enum: ["scheduled", "manual", "upload", "startup_catchup"] }).notNull(),
  status: text("status", { enum: ["running", "waiting_for_login", "validating", "success", "success_with_warnings", "failed"] }).notNull(),
  dataAsOf: text("data_as_of"),
  rowCount: integer("row_count").notNull().default(0),
  fileName: text("file_name"),
  fileHash: text("file_hash"),
  summaryJson: text("summary_json").notNull().default("{}"),
  errorMessage: text("error_message").notNull().default(""),
  createdByUserId: integer("created_by_user_id").references(() => userAccounts.id),
  startedAt: text("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: text("finished_at"),
}, (table) => [
  index("idx_source_run_source_started").on(table.source, table.startedAt),
  index("idx_source_run_status").on(table.status),
]);

export const crmPaymentEvents = sqliteTable("crm_payment_event", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceRecordKey: text("source_record_key").notNull(),
  uid: text("uid"),
  customerName: text("customer_name").notNull(),
  consultantName: text("consultant_name").notNull().default(""),
  orderNo: text("order_no").notNull().default(""),
  paidDate: text("paid_date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  mappingStatus: text("mapping_status", { enum: ["matched", "unmapped"] }).notNull(),
  sourceRunId: integer("source_run_id").notNull().references(() => sourceRuns.id),
  sourceRow: integer("source_row").notNull(),
  rawJson: text("raw_json").notNull().default("{}"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("uq_crm_payment_event_source_key").on(table.sourceRecordKey),
  index("idx_crm_payment_event_uid_paid_date").on(table.uid, table.paidDate),
  index("idx_crm_payment_event_mapping_status").on(table.mappingStatus),
  index("idx_crm_payment_event_source_run").on(table.sourceRunId),
]);

export const systemConfigs = sqliteTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedByUserId: integer("updated_by_user_id").references(() => userAccounts.id),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
