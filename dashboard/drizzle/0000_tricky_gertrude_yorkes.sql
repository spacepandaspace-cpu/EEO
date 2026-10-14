CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user_account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_object` ON `audit_log` (`object_type`,`object_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_log_created_at` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `auth_session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user_account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_auth_session_user_id` ON `auth_session` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_session_expires_at` ON `auth_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `customer_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uid` text NOT NULL,
	`type` text NOT NULL,
	`record_time` text NOT NULL,
	`content` text NOT NULL,
	`created_by_user_id` integer NOT NULL,
	`created_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user_account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_customer_log_uid_record_time` ON `customer_log` (`uid`,`record_time`);--> statement-breakpoint
CREATE TABLE `user_account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`role` text NOT NULL,
	`consultant_name` text,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`encrypted_password` text,
	`password_iv` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_account_username` ON `user_account` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_account_consultant_name` ON `user_account` (`consultant_name`);--> statement-breakpoint
CREATE INDEX `idx_user_account_role_enabled` ON `user_account` (`role`,`enabled`);