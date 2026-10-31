CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`key` text DEFAULT '' NOT NULL,
	`current_version_id` integer,
	`locked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_slot` ON `items` (`scope`,`kind`,`key`);--> statement-breakpoint
CREATE TABLE `versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`status` text NOT NULL,
	`origin` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`asset_hash` text,
	`thumb_hash` text,
	`seed` integer,
	`inputs` text DEFAULT '{}' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`guidance` text DEFAULT '' NOT NULL,
	`job_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_hash`) REFERENCES `assets`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thumb_hash`) REFERENCES `assets`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `styles` ADD `color_mode` text DEFAULT 'bw' NOT NULL;--> statement-breakpoint
ALTER TABLE `styles` ADD `model` text DEFAULT 'qwen-image' NOT NULL;--> statement-breakpoint
-- Styles used to be a series of whole versions (draft, approved, superseded).
-- Each part of them becomes a versioned item, and every version of every part
-- is kept: the newest becomes current. The color mode and model come from the
-- newest version (a draft, if there is one).
UPDATE `styles` SET
	`color_mode` = coalesce((
		SELECT CASE v.`color_mode` WHEN 'greyscale' THEN 'grayscale' ELSE v.`color_mode` END
		FROM `style_versions` v WHERE v.`style_id` = `styles`.`id` ORDER BY v.`number` DESC LIMIT 1
	), 'bw'),
	`model` = coalesce((
		SELECT v.`model` FROM `style_versions` v WHERE v.`style_id` = `styles`.`id`
		ORDER BY v.`number` DESC LIMIT 1
	), 'qwen-image');--> statement-breakpoint
INSERT INTO `items` (`owner_id`, `scope`, `kind`, `key`, `created_at`)
SELECT s.`owner_id`, 'style:' || s.`id`, k.`kind`, '', s.`created_at`
FROM `styles` s, (SELECT 'description' AS `kind` UNION ALL SELECT 'avoid' UNION ALL SELECT 'prompt') k;--> statement-breakpoint
INSERT INTO `items` (`owner_id`, `scope`, `kind`, `key`, `created_at`)
SELECT DISTINCT s.`owner_id`, 'style:' || s.`id`, 'scene', j.`key`, s.`created_at`
FROM `style_versions` v JOIN `styles` s ON s.`id` = v.`style_id`, json_each(v.`scenes`) j
WHERE trim(j.`value`) <> '';--> statement-breakpoint
INSERT INTO `items` (`owner_id`, `scope`, `kind`, `key`, `created_at`)
SELECT DISTINCT s.`owner_id`, 'style:' || s.`id`, 'picture', ss.`subject`, s.`created_at`
FROM `style_samples` ss
JOIN `style_versions` v ON v.`id` = ss.`version_id`
JOIN `styles` s ON s.`id` = v.`style_id`
WHERE ss.`asset_hash` IS NOT NULL;--> statement-breakpoint
-- Text parts: one version per style version, skipping repeats of the same text.
INSERT INTO `versions` (`item_id`, `status`, `origin`, `text`, `inputs`, `notes`, `created_at`)
SELECT i.`id`, 'ready', 'import', x.`val`, x.`inputs`, x.`notes`, x.`created_at`
FROM (
	SELECT v.`style_id`, v.`number`, v.`created_at`, p.`kind`, '' AS `key`,
		CASE p.`kind` WHEN 'description' THEN v.`description`
			WHEN 'avoid' THEN v.`negative_prompt` ELSE v.`prompt` END AS `val`,
		CASE p.`kind` WHEN 'prompt' THEN json_object(
			'description', v.`description`, 'avoid', v.`negative_prompt`,
			'color', CASE v.`color_mode` WHEN 'greyscale' THEN 'grayscale' ELSE v.`color_mode` END
		) ELSE '{}' END AS `inputs`,
		CASE p.`kind` WHEN 'prompt' THEN v.`notes` ELSE '' END AS `notes`,
		LAG(CASE p.`kind` WHEN 'description' THEN v.`description`
			WHEN 'avoid' THEN v.`negative_prompt` ELSE v.`prompt` END)
			OVER (PARTITION BY v.`style_id`, p.`kind` ORDER BY v.`number`) AS `prev`
	FROM `style_versions` v,
		(SELECT 'description' AS `kind` UNION ALL SELECT 'avoid' UNION ALL SELECT 'prompt') p
	UNION ALL
	SELECT v.`style_id`, v.`number`, v.`created_at`, 'scene', j.`key`, trim(j.`value`),
		json_object('description', v.`description`, 'avoid', v.`negative_prompt`), '',
		LAG(trim(j.`value`)) OVER (PARTITION BY v.`style_id`, j.`key` ORDER BY v.`number`)
	FROM `style_versions` v, json_each(v.`scenes`) j
) x
JOIN `items` i ON i.`scope` = 'style:' || x.`style_id` AND i.`kind` = x.`kind` AND i.`key` = x.`key`
WHERE x.`val` <> '' AND (x.`prev` IS NULL OR x.`prev` <> x.`val`)
ORDER BY x.`created_at`, x.`number`;--> statement-breakpoint
-- Sample pictures, oldest first. An input is recorded only when the picture's
-- prompt shows it was drawn from it (samples could lag behind edits).
INSERT INTO `versions` (`item_id`, `status`, `origin`, `text`, `asset_hash`, `thumb_hash`, `seed`, `inputs`, `job_id`, `created_at`)
SELECT i.`id`, 'ready', 'import', ss.`prompt`, ss.`asset_hash`, ss.`thumb_hash`, ss.`seed`,
	json_object(
		'prompt', CASE WHEN v.`prompt` <> '' AND instr(ss.`prompt`, v.`prompt`) > 0 THEN v.`prompt` END,
		'scene', CASE WHEN instr(ss.`prompt`, trim(coalesce(json_extract(v.`scenes`, '$.' || ss.`subject`), ''))) > 0
			AND trim(coalesce(json_extract(v.`scenes`, '$.' || ss.`subject`), '')) <> ''
			THEN trim(json_extract(v.`scenes`, '$.' || ss.`subject`)) END,
		'color', CASE v.`color_mode` WHEN 'greyscale' THEN 'grayscale' ELSE v.`color_mode` END,
		'model', v.`model`
	),
	ss.`job_id`, ss.`created_at`
FROM `style_samples` ss
JOIN `style_versions` v ON v.`id` = ss.`version_id`
JOIN `items` i ON i.`scope` = 'style:' || v.`style_id` AND i.`kind` = 'picture' AND i.`key` = ss.`subject`
WHERE ss.`asset_hash` IS NOT NULL
ORDER BY ss.`created_at`, ss.`id`;--> statement-breakpoint
UPDATE `items` SET `current_version_id` = (
	SELECT max(`id`) FROM `versions` WHERE `item_id` = `items`.`id` AND `status` = 'ready'
);--> statement-breakpoint
-- An approved style with no draft in progress was settled: lock its parts.
UPDATE `items` SET `locked` = 1
WHERE `kind` IN ('prompt', 'scene', 'picture') AND `current_version_id` IS NOT NULL
	AND `scope` IN (
		SELECT 'style:' || s.`id` FROM `styles` s
		WHERE s.`active_version_id` IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM `style_versions` v WHERE v.`style_id` = s.`id` AND v.`status` = 'draft'
		)
	);--> statement-breakpoint
UPDATE `jobs` SET `status` = 'canceled' WHERE `status` = 'cancelled';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_character_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`character_id` integer NOT NULL,
	`kind` text NOT NULL,
	`view` text,
	`source_image_id` integer,
	`prompt` text NOT NULL,
	`seed` integer NOT NULL,
	`style_prompt_version_id` integer,
	`job_id` integer,
	`asset_hash` text,
	`thumb_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`style_prompt_version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_hash`) REFERENCES `assets`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thumb_hash`) REFERENCES `assets`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_character_images`("id", "character_id", "kind", "view", "source_image_id", "prompt", "seed", "style_prompt_version_id", "job_id", "asset_hash", "thumb_hash", "created_at") SELECT "id", "character_id", "kind", "view", "source_image_id", "prompt", "seed", (
	SELECT max(pv.`id`) FROM `versions` pv
	JOIN `items` pi ON pi.`id` = pv.`item_id`
	JOIN `style_versions` sv ON sv.`id` = `character_images`.`style_version_id`
	WHERE pi.`scope` = 'style:' || sv.`style_id` AND pi.`kind` = 'prompt' AND pv.`text` = sv.`prompt`
), "job_id", "asset_hash", "thumb_hash", "created_at" FROM `character_images`;--> statement-breakpoint
DROP TABLE `character_images`;--> statement-breakpoint
ALTER TABLE `__new_character_images` RENAME TO `character_images`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP TABLE `style_samples`;--> statement-breakpoint
DROP TABLE `style_versions`;--> statement-breakpoint
ALTER TABLE `styles` DROP COLUMN `active_version_id`;
