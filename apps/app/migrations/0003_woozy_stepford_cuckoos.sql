CREATE TABLE `holds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slot_id` integer NOT NULL,
	`member_id` text NOT NULL,
	`seats` integer NOT NULL,
	`status` text DEFAULT 'held' NOT NULL,
	`expires_at` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `holds_slot_id_status_expires_at_idx` ON `holds` (`slot_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `holds_member_id_idempotency_key_idx` ON `holds` (`member_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `holds_member_id_expires_at_idx` ON `holds` (`member_id`,`expires_at`);