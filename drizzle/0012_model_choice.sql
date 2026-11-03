ALTER TABLE `series` ADD `image_model` text;--> statement-breakpoint
ALTER TABLE `users` ADD `image_model` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `model` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- The image model moves from the style to the series (and the user's default):
-- each series keeps drawing with its style's model.
UPDATE `series` SET `image_model` = (SELECT `model` FROM `styles` WHERE `styles`.`id` = `series`.`style_id`) WHERE `style_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `styles` DROP COLUMN `model`;