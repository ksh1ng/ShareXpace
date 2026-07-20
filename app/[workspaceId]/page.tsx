import { requireChatGPTUser } from "../chatgpt-auth";
import WorkspaceDashboard from "../workspace-dashboard";

export const dynamic = "force-dynamic";

export default async function WorkspaceDashboard({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const decodedWorkspaceId = decodeURIComponent(workspaceId);
  await requireChatGPTUser(`/${encodeURIComponent(decodedWorkspaceId)}`);
  return <WorkspaceDashboard initialWorkspaceId={decodedWorkspaceId} />;
}
