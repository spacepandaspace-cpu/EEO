CREATE TABLE `source_run` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`data_as_of` text,
	`row_count` integer DEFAULT 0 NOT NULL,
	`file_name` text,
	`file_hash` text,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`created_by_user_id` integer,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user_account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_source_run_source_started` ON `source_run` (`source`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_source_run_status` ON `source_run` (`status`);
--> statement-breakpoint
CREATE TABLE `crm_payment_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_record_key` text NOT NULL,
	`uid` text,
	`customer_name` text NOT NULL,
	`consultant_name` text DEFAULT '' NOT NULL,
	`order_no` text DEFAULT '' NOT NULL,
	`paid_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`mapping_status` text NOT NULL,
	`source_run_id` integer NOT NULL,
	`source_row` integer NOT NULL,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_run_id`) REFERENCES `source_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_crm_payment_event_source_key` ON `crm_payment_event` (`source_record_key`);
--> statement-breakpoint
CREATE INDEX `idx_crm_payment_event_uid_paid_date` ON `crm_payment_event` (`uid`,`paid_date`);
--> statement-breakpoint
CREATE INDEX `idx_crm_payment_event_mapping_status` ON `crm_payment_event` (`mapping_status`);
--> statement-breakpoint
CREATE INDEX `idx_crm_payment_event_source_run` ON `crm_payment_event` (`source_run_id`);
--> statement-breakpoint
CREATE TABLE `system_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by_user_id` integer,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `user_account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `system_config` (`key`, `value`) VALUES
	('refresh.schedule.timezone', 'Asia/Shanghai'),
	('refresh.eeo.weekday', '1'),
	('refresh.eeo.time', '10:00'),
	('refresh.startup_catchup', 'true'),
	('refresh.crm.mode', 'cumulative_upload')
ON CONFLICT(`key`) DO NOTHING;
