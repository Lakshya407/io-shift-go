CREATE TABLE `app_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text NOT NULL,
	`details` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `automation_state` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_code` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'employee' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_employee_code_unique` ON `employees` (`employee_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `employees_email_unique` ON `employees` (`email`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`trip_id` text,
	`type` text NOT NULL,
	`server_time` text NOT NULL,
	`device_time` text,
	`location` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_event_idempotency` ON `events` (`employee_id`,`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_arrival_per_trip` ON `events` (`trip_id`) WHERE "events"."type" = 'arrive';--> statement-breakpoint
CREATE TABLE `notification_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`lease_token` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`provider_id` text,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipt_lease_unique` ON `notification_attempts` (`notification_id`,`lease_token`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`sos_id` text,
	`report_id` text,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_attempt_at` text,
	`sent_at` text,
	`lease_token` text,
	`lease_expires_at` text,
	`provider_id` text,
	`error` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sos_id`) REFERENCES `sos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notification_due_idx` ON `notifications` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`generated_at` text NOT NULL,
	`trip_count` integer NOT NULL,
	`completed_count` integer NOT NULL,
	`active_count` integer NOT NULL,
	`sos_count` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `report_period_unique` ON `reports` (`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sos` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`trip_id` text,
	`event_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`acknowledged_at` text,
	`acknowledged_by` text,
	`resolved_at` text,
	`note` text DEFAULT '' NOT NULL,
	`location` text NOT NULL,
	`escalation_count` integer DEFAULT 0 NOT NULL,
	`next_escalation_at` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sos_event_id_unique` ON `sos` (`event_id`);--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`direction` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`cab` text DEFAULT '' NOT NULL,
	`boarded_at` text NOT NULL,
	`arrived_at` text,
	`board_location` text NOT NULL,
	`arrival_location` text,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_trip_per_employee` ON `trips` (`employee_id`) WHERE "trips"."status" = 'active';--> statement-breakpoint
CREATE INDEX `trips_boarded_at_idx` ON `trips` (`boarded_at`);