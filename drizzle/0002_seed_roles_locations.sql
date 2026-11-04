-- Starter custom roles (editable/deletable in Admin → Access control).
INSERT OR IGNORE INTO `roles` (`id`,`name`,`description`,`permissions`,`created_at`,`updated_at`) VALUES ('transport_manager','Transport manager','Monitors journeys, responds to SOS alerts and downloads reports.','["dashboard.view","alerts.manage","reports.view","employees.manage"]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
INSERT OR IGNORE INTO `roles` (`id`,`name`,`description`,`permissions`,`created_at`,`updated_at`) VALUES ('security_desk','Security desk','Watches live journeys and handles SOS alerts.','["dashboard.view","alerts.manage"]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'));
--> statement-breakpoint
-- The single Gondia office was replaced by the multi-office `locations` setting.
UPDATE `app_settings` SET `value`=json_remove(`value`,'$.officeName','$.officeAddress') WHERE `id`='main';
