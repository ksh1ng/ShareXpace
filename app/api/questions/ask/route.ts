import type { BillingMode } from "../../_lib/model";
import { relayExecute } from "../../_lib/relay-service";
import { ensureWorkspace, requireActor, validateQuestion, withRequestedWorkspaceResponse, type TokenOperation } from "../../_lib/workspace";

export async function POST(request: Request) {
  return withRequestedWorkspaceResponse(request, "The agent could not complete the request.", async () => {
    const actor = requireActor(request);
    await ensureWorkspace();
    const body = await request.json() as {
      question?: string;
      agent?: string;
      billingMode?: BillingMode;
      personalApiKey?: string;
      estimateId?: string;
      operation?: TokenOperation;
    };
    const question = validateQuestion(body.question);
    if (!body.estimateId) return Response.json({ error: "Estimate tokens before sending.", code: "estimate_required" }, { status: 428 });
    const operation: TokenOperation = body.operation === "generate_with_team_knowledge" ? body.operation : "auto";
    const result = await relayExecute({
      question,
      actor,
      agent: body.agent,
      billingMode: body.billingMode === "personal" ? "personal" : "master",
      personalApiKey: body.personalApiKey,
      estimateId: body.estimateId,
      operation,
    });
    return Response.json(result, { status: 201 });
  });
}
