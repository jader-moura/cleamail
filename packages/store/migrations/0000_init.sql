CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`address` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_sync_at` integer
);
--> statement-breakpoint
CREATE TABLE `actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`decision_id` integer NOT NULL,
	`email_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`applied_at` integer NOT NULL,
	`reversed_at` integer,
	`error` text,
	FOREIGN KEY (`decision_id`) REFERENCES `decisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `actions_email_idx` ON `actions` (`email_id`);--> statement-breakpoint
CREATE INDEX `actions_applied_idx` ON `actions` (`applied_at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`kind` text NOT NULL,
	`email_id` text,
	`decision_id` integer,
	`summary` text NOT NULL,
	`details_json` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `corrections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` text NOT NULL,
	`account_id` text NOT NULL,
	`from_category` text,
	`to_category` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `corrections_email_idx` ON `corrections` (`email_id`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` text NOT NULL,
	`account_id` text NOT NULL,
	`category` text NOT NULL,
	`importance` real NOT NULL,
	`confidence` real NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`rule_id` text,
	`model` text,
	`actions_json` text DEFAULT '[]' NOT NULL,
	`policy_version` text NOT NULL,
	`decided_at` integer NOT NULL,
	`applied_at` integer,
	`dry_run` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decisions_email_idx` ON `decisions` (`email_id`);--> statement-breakpoint
CREATE INDEX `decisions_decided_idx` ON `decisions` (`decided_at`);--> statement-breakpoint
CREATE TABLE `emails` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_json` text DEFAULT '[]' NOT NULL,
	`cc_json` text DEFAULT '[]' NOT NULL,
	`reply_to_json` text,
	`subject` text DEFAULT '' NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`body_text` text DEFAULT '' NOT NULL,
	`headers_json` text DEFAULT '{}' NOT NULL,
	`provider_labels_json` text DEFAULT '[]' NOT NULL,
	`is_read` integer NOT NULL,
	`is_starred` integer NOT NULL,
	`is_in_inbox` integer NOT NULL,
	`received_at` integer NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `emails_account_received_idx` ON `emails` (`account_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `emails_thread_idx` ON `emails` (`thread_id`);--> statement-breakpoint
CREATE TABLE `embeddings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` text NOT NULL,
	`model` text NOT NULL,
	`vector` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `embeddings_email_model_unq` ON `embeddings` (`email_id`,`model`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
