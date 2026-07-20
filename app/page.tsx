import { requireChatGPTUser } from "./chatgpt-auth";
import WorkspaceDashboard from "./workspace-dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireChatGPTUser("/");
  return <WorkspaceDashboard />;
}
