CREATE TABLE `character_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`character_id` integer NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`seed` integer NOT NULL,
	`style_version_id` integer,
	`job_id` integer,
	`asset_hash` text,
	`thumb_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`style_version_id`) REFERENCES `style_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_hash`) REFERENCES `assets`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thumb_hash`) REFERENCES `assets`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manga_id` integer NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'supporting' NOT NULL,
	`brief` text DEFAULT '' NOT NULL,
	`personality` text DEFAULT '' NOT NULL,
	`motivation` text DEFAULT '' NOT NULL,
	`backstory` text DEFAULT '' NOT NULL,
	`speech` text DEFAULT '' NOT NULL,
	`age` text DEFAULT '' NOT NULL,
	`appearance` text DEFAULT '' NOT NULL,
	`outfit` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`seed` integer NOT NULL,
	`reference_image_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`manga_id`) REFERENCES `mangas`(`id`) ON UPDATE no action ON DELETE cascade
);
