ALTER TABLE `catalog` ADD `city` text;--> statement-breakpoint
ALTER TABLE `catalog` ADD `county` text;--> statement-breakpoint
CREATE INDEX `catalog_city_idx` ON `catalog` (`city`);--> statement-breakpoint
CREATE INDEX `catalog_county_idx` ON `catalog` (`county`);