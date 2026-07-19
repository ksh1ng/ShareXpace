CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `workspaces` (`id`, `name`, `created_by`, `created_at`)
VALUES ('RoamTogether', 'RoamTogether', 'System migration', '2026-07-19T00:00:00.000Z');
--> statement-breakpoint
UPDATE `memory_records` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `reuse_events` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `workspace_files` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `answer_cache` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `model_calls` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `workspace_cache_state` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `chat_messages` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `record_embeddings` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `routing_events` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `token_estimates` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
--> statement-breakpoint
UPDATE `mcp_events` SET `workspace_id` = 'RoamTogether' WHERE `workspace_id` = 'relay-production';
