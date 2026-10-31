-- Each manga becomes a series (same id), and its characters belong to the series.
ALTER TABLE `mangas` RENAME TO `series`;--> statement-breakpoint
ALTER TABLE `characters` RENAME COLUMN `manga_id` TO `series_id`;--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`logline` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chapter_cast` (
	`chapter_id` integer NOT NULL,
	`character_id` integer NOT NULL,
	`pinned_image_id` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`chapter_id`, `character_id`),
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pinned_image_id`) REFERENCES `character_images`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- The manga's story becomes chapter 1 of its series, with the whole cast in it,
-- each pinned to the reference picture they have now.
INSERT INTO `chapters` (`series_id`, `number`, `title`, `logline`, `created_at`, `updated_at`)
SELECT `id`, 1, '', `logline`, `created_at`, `updated_at` FROM `series`;--> statement-breakpoint
INSERT INTO `chapter_cast` (`chapter_id`, `character_id`, `pinned_image_id`, `created_at`)
SELECT `chapters`.`id`, `characters`.`id`, `characters`.`reference_image_id`, `characters`.`created_at`
FROM `characters` JOIN `chapters` ON `chapters`.`series_id` = `characters`.`series_id`;
