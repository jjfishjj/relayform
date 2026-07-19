CREATE TABLE `connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`base_url` text NOT NULL,
	`status` text NOT NULL,
	`metadata` text NOT NULL,
	`raw_document` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`response_status` integer,
	`error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tools` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connector_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`risk` text NOT NULL,
	`input_schema` text NOT NULL,
	`output_schema` text,
	FOREIGN KEY (`connector_id`) REFERENCES `connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
