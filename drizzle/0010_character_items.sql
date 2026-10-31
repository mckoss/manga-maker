-- Characters move onto versioned items (scope "character:<id>"). Import
-- every profile field, design, picture, reference and sheet view as the
-- first version of its item, recording what each was made from where it is
-- known, then drop the old columns and table.
UPDATE `jobs` SET `status` = 'canceled' WHERE `kind` LIKE 'character.%' AND `status` IN ('queued', 'running');--> statement-breakpoint
CREATE TEMP TABLE `imp_field` AS
SELECT c.id AS character_id, s.owner_id, f.kind, CASE f.kind WHEN 'name' THEN c.name WHEN 'role' THEN c.role WHEN 'brief' THEN c.brief WHEN 'personality' THEN c.personality WHEN 'motivation' THEN c.motivation WHEN 'backstory' THEN c.backstory WHEN 'speech' THEN c.speech WHEN 'age' THEN c.age WHEN 'appearance' THEN c.appearance WHEN 'outfit' THEN c.outfit END AS value, c.created_at, c.updated_at,
	json_object('brief', c.brief, 'role', c.role) AS inputs
FROM `characters` c JOIN `series` s ON s.id = c.series_id JOIN (SELECT 'name' AS kind UNION ALL SELECT 'role' AS kind UNION ALL SELECT 'brief' AS kind UNION ALL SELECT 'personality' AS kind UNION ALL SELECT 'motivation' AS kind UNION ALL SELECT 'backstory' AS kind UNION ALL SELECT 'speech' AS kind UNION ALL SELECT 'age' AS kind UNION ALL SELECT 'appearance' AS kind UNION ALL SELECT 'outfit' AS kind) f;--> statement-breakpoint
DELETE FROM `imp_field` WHERE `value` = '';--> statement-breakpoint
INSERT INTO `items` (`owner_id`, `scope`, `kind`, `key`, `locked`, `created_at`)
SELECT owner_id, 'character:' || character_id, kind, '', CASE kind WHEN 'name' THEN 1 ELSE 0 END, created_at FROM `imp_field`;--> statement-breakpoint
INSERT INTO `versions` (`item_id`, `status`, `origin`, `text`, `inputs`, `created_at`)
SELECT i.id, 'ready', CASE f.kind WHEN 'role' THEN 'user' WHEN 'brief' THEN 'user' ELSE 'import' END, f.value,
	CASE WHEN f.kind IN ('role', 'brief') THEN '{}' ELSE f.inputs END, f.updated_at
FROM `imp_field` f JOIN `items` i ON i.scope = 'character:' || f.character_id AND i.kind = f.kind AND i.key = '';--> statement-breakpoint
CREATE TEMP TABLE `imp_design` AS
SELECT ci.id AS image_id, c.id AS character_id, s.owner_id, ci.created_at,
	CAST(ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY ci.id) AS TEXT) AS slot,
	json_object('label', coalesce(ci.variant, 'Current look'), 'appearance', coalesce(ci.appearance, c.appearance), 'outfit', coalesce(ci.outfit, c.outfit)) AS design,
	json_object('brief', c.brief, 'age', c.age, 'appearance', c.appearance, 'outfit', c.outfit) AS look,
	ci.prompt, ci.asset_hash, ci.thumb_hash, ci.seed,
	CAST(ci.style_prompt_version_id AS TEXT) AS style, st.color_mode, st.model, c.age
FROM `character_images` ci
JOIN `characters` c ON c.id = ci.character_id
JOIN `series` s ON s.id = c.series_id
LEFT JOIN `styles` st ON st.id = s.style_id
WHERE ci.kind = 'candidate' AND ci.asset_hash IS NOT NULL
	AND ci.id IS NOT c.reference_image_id
	AND ci.id NOT IN (SELECT pinned_image_id FROM `chapter_cast` WHERE pinned_image_id IS NOT NULL)
	AND ci.id IN (SELECT x.id FROM `character_images` x WHERE x.character_id = c.id AND x.kind = 'candidate'
		AND x.id IS NOT c.reference_image_id ORDER BY x.id DESC LIMIT 4);--> statement-breakpoint
INSERT INTO `items` (`owner_id`, `scope`, `kind`, `key`, `locked`, `created_at`)
SELECT owner_id, 'character:' || character_id, 'design', slot, 0, created_at FROM `imp_design`;--> statement-breakpoint
INSERT INTO `items` (`owner_id`, `scope`, `kind`, `key`, `locked`, `created_at`)
SELECT owner_id, 'character:' || character_id, 'picture', slot, 0, created_at FROM `imp_design`;--> statement-breakpoint
INSERT INTO `versions` (`item_id`, `status`, `origin`, `text`, `inputs`, `created_at`)
SELECT i.id, 'ready', 'import', d.design, d.look, d.created_at
FROM `imp_design` d JOIN `items` i ON i.scope = 'character:' || d.character_id AND i.kind = 'design' AND i.key = d.slot;--> statement-breakpoint
INSERT INTO `versions` (`item_id`, `status`, `origin`, `text`, `asset_hash`, `thumb_hash`, `seed`, `inputs`, `created_at`)
SELECT i.id, 'ready', 'import', d.prompt, d.asset_hash, d.thumb_hash, d.seed,
	json_object('design', d.design, 'age', d.age, 'style', coalesce(d.style, ''), 'color', coalesce(d.color_mode, ''), 'model', coalesce(d.model, '')),
	d.created_at
FROM `imp_design` d JOIN `items` i ON i.scope = 'character:' || d.character_id AND i.kind = 'picture' AND i.key = d.slot;--> statement-breakpoint
CREATE TEMP TABLE `imp_ref` AS
SELECT ci.id AS image_id, c.id AS character_id, s.owner_id, ci.created_at, ci.id = c.reference_image_id AS chosen,
	json_object('label', coalesce(ci.variant, 'Current look'), 'appearance', coalesce(ci.appearance, c.appearance), 'outfit', coalesce(ci.outfit, c.outfit)) AS design,
	json_object('brief', c.brief, 'age', c.age, 'appearance', c.appearance, 'outfit', c.outfit,
		'style', coalesce(CAST(ci.style_prompt_version_id AS TEXT), ''), 'color', coalesce(st.color_mode, ''), 'model', coalesce(st.model, '')) AS inputs,
	ci.asset_hash, ci.thumb_hash, ci.seed
FROM `character_images` ci
JOIN `characters` c ON c.id = ci.character_id
JOIN `series` s ON s.id = c.series_id
LEFT JOIN `styles` st ON st.id = s.style_id
WHERE ci.asset_hash IS NOT NULL AND (ci.id = c.reference_image_id
	OR ci.id IN (SELECT pinned_image_id FROM `chapter_cast` WHERE character_id = c.id));--> statement-breakpoint
INSERT INTO `items` (`owner_id`, `scope`, `kind`, `key`, `locked`, `created_at`)
SELECT owner_id, 'character:' || character_id, 'reference', '', 0, min(created_at) FROM `imp_ref` GROUP BY character_id, owner_id;--> statement-breakpoint
INSERT INTO `versions` (`item_id`, `status`, `origin`, `text`, `asset_hash`, `thumb_hash`, `seed`, `inputs`, `guidance`, `created_at`)
SELECT i.id, 'ready', 'user', r.design, r.asset_hash, r.thumb_hash, r.seed, r.inputs, 'imported:' || r.image_id, r.created_at
FROM `imp_ref` r JOIN `items` i ON i.scope = 'character:' || r.character_id AND i.kind = 'reference'
ORDER BY r.chosen, r.image_id;--> statement-breakpoint
CREATE TEMP TABLE `imp_map` AS
SELECT CAST(substr(v.guidance, 10) AS INTEGER) AS image_id, v.id AS version_id
FROM `versions` v JOIN `items` i ON i.id = v.item_id
WHERE i.kind = 'reference' AND v.guidance LIKE 'imported:%';--> statement-breakpoint
UPDATE `versions` SET `guidance` = '' WHERE `guidance` LIKE 'imported:%';--> statement-breakpoint
CREATE TEMP TABLE `imp_sheet` AS
SELECT ci.id AS image_id, c.id AS character_id, s.owner_id, ci.view, ci.prompt, ci.asset_hash, ci.thumb_hash, ci.seed, ci.created_at,
	json_object('reference', coalesce(CAST(m.version_id AS TEXT), ''), 'color', coalesce(st.color_mode, '')) AS inputs
FROM `character_images` ci
JOIN `characters` c ON c.id = ci.character_id
JOIN `series` s ON s.id = c.series_id
LEFT JOIN `styles` st ON st.id = s.style_id
LEFT JOIN `imp_map` m ON m.image_id = ci.source_image_id
WHERE ci.kind = 'sheet' AND ci.asset_hash IS NOT NULL AND ci.view IS NOT NULL
	AND ci.id = (SELECT max(x.id) FROM `character_images` x WHERE x.character_id = c.id AND x.kind = 'sheet' AND x.view = ci.view AND x.asset_hash IS NOT NULL);--> statement-breakpoint
INSERT INTO `items` (`owner_id`, `scope`, `kind`, `key`, `locked`, `created_at`)
SELECT owner_id, 'character:' || character_id, 'sheet', view, 0, created_at FROM `imp_sheet`;--> statement-breakpoint
INSERT INTO `versions` (`item_id`, `status`, `origin`, `text`, `asset_hash`, `thumb_hash`, `seed`, `inputs`, `created_at`)
SELECT i.id, 'ready', 'import', sh.prompt, sh.asset_hash, sh.thumb_hash, sh.seed, sh.inputs, sh.created_at
FROM `imp_sheet` sh JOIN `items` i ON i.scope = 'character:' || sh.character_id AND i.kind = 'sheet' AND i.key = sh.view;--> statement-breakpoint
UPDATE `items` SET `current_version_id` = (SELECT max(v.id) FROM `versions` v WHERE v.item_id = `items`.id)
WHERE `scope` LIKE 'character:%' AND `current_version_id` IS NULL;--> statement-breakpoint
ALTER TABLE `chapter_cast` ADD `pinned_version_id` integer;--> statement-breakpoint
UPDATE `chapter_cast` SET `pinned_version_id` = (SELECT m.version_id FROM `imp_map` m WHERE m.image_id = `chapter_cast`.pinned_image_id);--> statement-breakpoint
DROP TABLE `imp_field`;--> statement-breakpoint
DROP TABLE `imp_design`;--> statement-breakpoint
DROP TABLE `imp_ref`;--> statement-breakpoint
DROP TABLE `imp_map`;--> statement-breakpoint
DROP TABLE `imp_sheet`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chapter_cast` (
	`chapter_id` integer NOT NULL,
	`character_id` integer NOT NULL,
	`pinned_version_id` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`chapter_id`, `character_id`),
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pinned_version_id`) REFERENCES `versions`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_chapter_cast`("chapter_id", "character_id", "pinned_version_id", "created_at") SELECT "chapter_id", "character_id", "pinned_version_id", "created_at" FROM `chapter_cast`;--> statement-breakpoint
DROP TABLE `chapter_cast`;--> statement-breakpoint
ALTER TABLE `__new_chapter_cast` RENAME TO `chapter_cast`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `brief`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `personality`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `motivation`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `backstory`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `speech`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `age`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `appearance`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `outfit`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `notes`;--> statement-breakpoint
ALTER TABLE `characters` DROP COLUMN `reference_image_id`;--> statement-breakpoint
DROP TABLE `character_images`;
