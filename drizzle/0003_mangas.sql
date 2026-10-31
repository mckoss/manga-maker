CREATE TABLE `mangas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`title` text NOT NULL,
	`logline` text DEFAULT '' NOT NULL,
	`reading_direction` text DEFAULT 'rtl' NOT NULL,
	`style_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`style_id`) REFERENCES `styles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Styles used to be a library of their own; each existing one becomes a manga.
INSERT INTO `mangas` (`owner_id`, `title`, `style_id`, `created_at`, `updated_at`)
SELECT `owner_id`, `name`, `id`, `created_at`, `created_at` FROM `styles`;
