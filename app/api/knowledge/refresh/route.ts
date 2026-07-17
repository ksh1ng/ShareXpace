import type { BillingMode } from "../../_lib/model";
import { relayExecute } from "../../_lib/relay-service";
import { errorResponse, requireActor } from "../../_lib/workspace";

export async function POST(request: Request) {
  try {
    const actor = requireActor(request);
    const body = await request.json() as { recordId?: string; estimateId?: string; billingMode?: BillingMode; personalApiKey?: string; agent?: string };
    if (!body.recordId) return Response.json({ error: "Record is required.", code: "record_required" }, { status: 400 });
    if (!body.estimateId) return Response.json({ error: "Estimate refresh tokens before sending.", code: "estimate_required" }, { status: 428 });
    const result = await relayExecute({
      question: "Refresh source",
      actor,
      agent: body.agent,
      billingMode: body.billingMode === "personal" ? "personal" : "master",
      personalApiKey: body.personalApiKey,
      estimateId: body.estimateId,
      operation: "refresh",
      recordId: body.recordId,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Unable to refresh this knowledge record.");
  }
}
