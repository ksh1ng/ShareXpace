CREATE TABLE `record_embeddings` (
	`record_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`embedding_json` text NOT NULL,
	`created_at` text NOT NULL
);
