ALTER TABLE `projects` ADD `budget_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `people` ADD `daily_minutes` integer DEFAULT 360 NOT NULL;--> statement-breakpoint
CREATE TABLE `absences` (
	`person_id` text NOT NULL,
	`day` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY (`person_id`, `day`)
);--> statement-breakpoint
CREATE TABLE `work_links` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`day` text NOT NULL,
	`url` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `work_link_person_day` ON `work_links` (`person_id`,`day`);
