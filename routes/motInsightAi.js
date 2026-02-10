import express from "express";
import { optionalAuth } from "../middleware/auth.js";
import { openai } from "../lib/openai.js"; // adapt to your setup

const router = express.Router();

router.post("/mot-insight/explain", optionalAuth, async (req, res) => {
  try {
    const {
      vehicle,
      categoryId,
      categoryLabel,
      motSummary,
    } = req.body || {};

    const vehicleLabel = vehicle?.label;
    const vehicleAgeYears = vehicle?.ageYears;
    const latestMileage = vehicle?.mileage;

    console.log("MOT AI payload:", {
      vehicleLabel,
      vehicleAgeYears,
      latestMileage,
      categoryId,
      categoryLabel,
    });

    if (!categoryId || !categoryLabel) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const prompt = `
You are an experienced UK MOT tester.

Your task is to explain what MOT testers commonly FAIL or ADVISE on
for the vehicle below, specifically within the given category.

Use real MOT certificate wording where possible.
Focus on known failure and advisory patterns for this type of vehicle.
Do NOT speculate wildly and do NOT claim faults exist.

Vehicle:
${vehicleLabel || vrm}
Age: ${vehicleAgeYears ?? "unknown"} years
Mileage: ${latestMileage ?? "unknown"}

Category:
${categoryLabel}

MOT history summary:
- Tests recorded: ${motSummary?.totalTests ?? "unknown"}
- Previous fails: ${motSummary?.totalFails ?? "unknown"}
- Total advisories: ${motSummary?.totalAdvisories ?? "unknown"}

Guidance:
- It is acceptable to mention issues that have NOT yet appeared if they are commonly seen on this model.
- Use MOT-style phrases such as "excessive play", "deteriorated", "corroded", "insecure", "ineffective".
- Avoid generic phrases like "due to age and mileage".
- If available data is limited, say so briefly.

Return JSON ONLY in this exact format:
{
  "headline": string (max 6 words),
  "why": string (max 40 words),
  "checks": string[] (2–3 specific MOT check items),
  "tip": string (max 25 words),
  "confidence": number (0–1)
}
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const usage = completion.usage;
	if (usage) {
	  const PRICING = { inPer1M: 0.40, outPer1M: 1.60 }; // gpt-4.1-mini
	  const estCost =
		(usage.prompt_tokens * PRICING.inPer1M +
		  usage.completion_tokens * PRICING.outPer1M) /
		1_000_000;

	console.log("MOT_AI_USAGE", {
      model: "gpt-4.1-mini",
      prompt: usage.prompt_tokens,
      completion: usage.completion_tokens,
      total: usage.total_tokens,
      estCostUsd: Number(estCost.toFixed(8)),
	});
  }

    const text = completion.choices?.[0]?.message?.content || "{}";
    const data = JSON.parse(text);

    return res.json({
      headline: typeof data.headline === "string" ? data.headline : "",
      why: typeof data.why === "string" ? data.why : "",
      checks: Array.isArray(data.checks) ? data.checks.slice(0, 3) : [],
      tip: typeof data.tip === "string" ? data.tip : "",
      confidence: typeof data.confidence === "number" ? data.confidence : 0.6,
    });

  } catch (e) {
    console.log("mot-insight/explain error", e);
    return res.status(500).json({ error: "AI failed" });
  }
});

export default router;
