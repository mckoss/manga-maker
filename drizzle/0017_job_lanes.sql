CREATE TABLE `job_lanes` (
	`lane` text PRIMARY KEY NOT NULL,
	`paused` integer DEFAULT false NOT NULL
);
