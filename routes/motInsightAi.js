import express from "express";
import authMiddleware from "../middleware/auth.js";
import { openai } from "../lib/openai.js"; // adapt to your setup

const router = express.Router();

router.post("/mot-insight/explain", authMiddleware, async (req, res) => {
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
  "explanation": string (max 60 words),
  "preventativeAdvice": string (max 60 words),
  "confidence": number (0-1)
}
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const text = completion.choices?.[0]?.message?.content || "{}";
    const data = JSON.parse(text);

    return res.json({
      explanation: data.explanation || "",
      preventativeAdvice: data.preventativeAdvice || "",
      confidence: typeof data.confidence === "number" ? data.confidence : 0.6,
    });
  } catch (e) {
    console.log("mot-insight/explain error", e);
    return res.status(500).json({ error: "AI failed" });
  }
});

export default router;
