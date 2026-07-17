CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`author` text NOT NULL,
	`message_type` text NOT NULL,
	`content` text NOT NULL,
	`agent` text,
	`model` text,
	`billing_mode` text,
	`task_status` text,
	`source_message_id` text,
	`created_at` text NOT NULL
);
