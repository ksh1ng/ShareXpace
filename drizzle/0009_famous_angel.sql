CREATE TABLE `document_chunk_embeddings` (
	`chunk_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`embedding_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `document_chunk_embeddings_workspace_model_idx` ON `document_chunk_embeddings` (`workspace_id`,`model`,`dimensions`);--> statement-breakpoint
CREATE TABLE `document_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`file_id` text NOT NULL,
	`file_name` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`char_start` integer NOT NULL,
	`char_end` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `document_chunks_workspace_file_idx` ON `document_chunks` (`workspace_id`,`file_id`);--> statement-breakpoint
ALTER TABLE `workspace_files` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `workspace_files` ADD `processing_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_files` ADD `processing_error` text;--> statement-breakpoint
ALTER TABLE `workspace_files` ADD `extracted_text_length` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_files` ADD `chunk_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_files` ADD `embedded_chunk_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_files` ADD `processed_at` text;