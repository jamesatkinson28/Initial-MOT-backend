import express from "express";
import { authRequired } from "../middleware/auth.js";
import { openai } from "../lib/openai.js"; // adapt to your setup

const router = express.Router();

router.post("/mot-insight/explain", authRequired, async (req, res) => {
  try {
    // premium gate
    if (!req.user?.premium) {
      return res.status(403).json({ error: "Premium required" });
    }

    const {
      vrm,
      vehicleLabel,
      latestMileage,
      vehicleAgeYears,
      category, // { id, label, riskLevel, reason, estimatedMinCost, estimatedMaxCost }
      motSummary, // small summary only (counts)
    } = req.body || {};
	console.log("MOT AI payload:", {
	  vrm,
	  categoryId: category?.id,
	  categoryLabel: category?.label,
	});


    if (!vrm || !category?.id || !category?.label) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const prompt = `
You are GarageGPT, a UK MOT-focused assistant.
Explain why this MOT risk category is flagged, in plain UK terms.
Be specific, practical, and avoid making up facts. Use only the data provided.

Vehicle: ${vehicleLabel || vrm}
Age (years): ${vehicleAgeYears ?? "unknown"}
Latest mileage: ${latestMileage ?? "unknown"}

Category: ${category.label}
Risk level: ${category.riskLevel}
Reason (from rules): ${category.reason}
Estimated repair range: £${category.estimatedMinCost} - £${category.estimatedMaxCost}

MOT summary:
- totalTests: ${motSummary?.totalTests ?? "unknown"}
- totalFails: ${motSummary?.totalFails ?? "unknown"}
- totalAdvisories: ${motSummary?.totalAdvisories ?? "unknown"}

Return JSON ONLY with:
{
  "headline": string (max 6 words),
  "why": string (max 40 words, probabilistic language),
  "checks": string[] (2–3 practical checks),
  "tip": string (max 25 words),
  "confidence": number (0-1)
}

Rules:
- Do not claim faults exist.
- Use “may”, “likely”, “suggests”.
- If data is limited, say so briefly.
- Avoid repeating wording across categories.
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
