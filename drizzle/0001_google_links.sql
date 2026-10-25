CREATE TABLE `google_links` (
	`google_sub` text PRIMARY KEY NOT NULL,
	`chatgpt_user_id` text NOT NULL,
	`linked_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_links_chatgpt_user_id_unique` ON `google_links` (`chatgpt_user_id`);