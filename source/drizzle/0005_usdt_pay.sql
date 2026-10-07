ALTER TABLE `people` ADD `hourly_rate` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `wallet_trc20` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`period` text NOT NULL,
	`range_from` integer NOT NULL,
	`range_to` integer NOT NULL,
	`milliseconds` integer NOT NULL,
	`hourly_rate` integer NOT NULL,
	`amount` integer NOT NULL,
	`wallet` text NOT NULL,
	`status` text NOT NULL,
	`tx_hash` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payout_person_range` ON `payouts` (`person_id`,`period`,`range_from`);
