CREATE TABLE `routing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`route` text NOT NULL,
	`action` text NOT NULL,
	`similarity` real DEFAULT 0 NOT NULL,
	`actual_cached_tokens` integer DEFAULT 0 NOT NULL,
	`estimated_tokens_saved` integer DEFAULT 0 NOT NULL,
	`record_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `memory_records` ADD `knowledge_type` text DEFAULT 'dynamic' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `generated_at` text;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `allow_direct_reuse` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `requires_refresh` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `superseded_by` text;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `version` integer DEFAULT 1 NOT NULL;