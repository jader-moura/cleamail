-- Rebuilt so a decision without a classification can be stored: the classification columns are
-- nullable now, and review_reason, review_detail and run_id are new.
--
-- Hand-edited: drizzle-kit generated the copy as if the old table already had the new columns,
-- which fails on a database created by 0000. The copy below names only the columns 0000 created,
-- so run_id takes its default and the review columns start null.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email_id` text NOT NULL,
	`account_id` text NOT NULL,
	`run_id` text DEFAULT '' NOT NULL,
	`category` text,
	`importance` real,
	`confidence` real,
	`reason` text,
	`source` text,
	`rule_id` text,
	`model` text,
	`review_reason` text,
	`review_detail` text,
	`actions_json` text DEFAULT '[]' NOT NULL,
	`policy_version` text NOT NULL,
	`decided_at` integer NOT NULL,
	`applied_at` integer,
	`dry_run` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_decisions`("id", "email_id", "account_id", "category", "importance", "confidence", "reason", "source", "rule_id", "model", "actions_json", "policy_version", "decided_at", "applied_at", "dry_run") SELECT "id", "email_id", "account_id", "category", "importance", "confidence", "reason", "source", "rule_id", "model", "actions_json", "policy_version", "decided_at", "applied_at", "dry_run" FROM `decisions`;--> statement-breakpoint
DROP TABLE `decisions`;--> statement-breakpoint
ALTER TABLE `__new_decisions` RENAME TO `decisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `decisions_email_idx` ON `decisions` (`email_id`);--> statement-breakpoint
CREATE INDEX `decisions_decided_idx` ON `decisions` (`decided_at`);--> statement-breakpoint
CREATE INDEX `decisions_run_idx` ON `decisions` (`run_id`);--> statement-breakpoint
ALTER TABLE `actions` ADD `outcome` text DEFAULT 'applied' NOT NULL;