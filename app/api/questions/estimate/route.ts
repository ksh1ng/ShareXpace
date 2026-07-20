import type { BillingMode } from "../../_lib/model";
import { relayPreflight } from "../../_lib/relay-service";
import { requireActor, withRequestedWorkspaceResponse, type TokenOperation } from "../../_lib/workspace";

export async function POST(request: Request) {
  return withRequestedWorkspaceResponse(request, "Unable to estimate tokens.", async () => {
    const actor = requireActor(request);
    const body = await request.json() as {
      question?: string;
      billingMode?: BillingMode;
      personalApiKey?: string;
      operation?: TokenOperation;
      recordId?: string;
    };
    const operation: TokenOperation = body.operation === "generate_with_team_knowledge" || body.operation === "refresh"
      ? body.operation
      : "auto";
    const result = await relayPreflight({
      actor,
      question: body.question,
      billingMode: body.billingMode === "personal" ? "personal" : "master",
      personalApiKey: body.personalApiKey,
      operation,
      recordId: body.recordId,
    });
    return Response.json(result, { status: 201 });
  });
}
