CREATE TABLE `answer_cache` (
	`workspace_id` text NOT NULL,
	`question_fingerprint` text NOT NULL,
	`record_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `question_fingerprint`)
);
--> statement-breakpoint
CREATE TABLE `model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`prompt_cache_key` text NOT NULL,
	`knowledge_version` integer NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_cache_state` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`knowledge_version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
