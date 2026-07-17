CREATE TABLE `mcp_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor` text NOT NULL,
	`client_name` text NOT NULL,
	`method` text NOT NULL,
	`tool_name` text,
	`success` integer DEFAULT 1 NOT NULL,
	`route` text,
	`created_at` text NOT NULL
);
