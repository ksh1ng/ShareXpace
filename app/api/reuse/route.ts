import { relayReuse } from "../_lib/relay-service";
import { errorResponse, requireActor } from "../_lib/workspace";

export async function POST(request: Request) {
  try {
    const actor = requireActor(request);
    const body = await request.json() as { recordId?: string; question?: string; similarity?: number; estimateId?: string };
    if (!body.recordId) return Response.json({ error: "Record is required.", code: "record_required" }, { status: 400 });
    if (!body.estimateId) return Response.json({ error: "Estimate tokens before reusing.", code: "estimate_required" }, { status: 428 });
    return Response.json(await relayReuse({ actor, question: body.question, estimateId: body.estimateId, recordId: body.recordId, similarity: body.similarity }));
  } catch (error) {
    return errorResponse(error, "Unable to reuse this answer.");
  }
}
