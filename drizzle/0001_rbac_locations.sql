CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_name_unique` ON `roles` (`name`);--> statement-breakpoint
ALTER TABLE `employees` ADD `location` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `last_active_at` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `employees` ADD `sso_subject` text;