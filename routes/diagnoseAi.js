// routes/diagnoseAi.js
import express from "express";
import { authRequired } from "../middleware/auth.js";
import { openai } from "../lib/openai.js";

const router = express.Router();

/**
 * POST /diagnose/analyse
 * AI-powered vehicle diagnosis based on symptoms + context
 */
router.post("/diagnose/analyse", authRequired, async (req, res) => {
  try {
    // 🔒 Premium gate (same as MOT insight)
    if (!req.user?.premium) {
      return res.status(403).json({ error: "Premium required" });
    }

    const {
      vehicleLabel,
      vrm,
      mileage,
      vehicleAgeYears,
      engine,
      fuelType,
      symptom,          // REQUIRED (free text)
      recentServices,   // optional array
      motAdvisories,    // optional array of strings
    } = req.body || {};

    if (!symptom || typeof symptom !== "string") {
      return res.status(400).json({ error: "Missing symptom description" });
    }

    console.log("DIAGNOSE_AI payload:", {
      vrm,
      vehicleLabel,
      mileage,
      symptom: symptom.slice(0, 120),
    });

    const prompt = `
You are GarageGPT, an automotive diagnostic assistant for UK vehicles.

Your task is to analyse a user-described vehicle problem and suggest
possible causes, urgency, and next steps.

Vehicle:
${vehicleLabel || vrm || "Unknown vehicle"}
Age (years): ${vehicleAgeYears ?? "unknown"}
Engine: ${engine ?? "unknown"}
Fuel type: ${fuelType ?? "unknown"}
Mileage: ${mileage ?? "unknown"}

Recent service history:
${Array.isArray(recentServices) && recentServices.length
  ? JSON.stringify(recentServices)
  : "No recent service history provided"}

MOT advisories:
${Array.isArray(motAdvisories) && motAdvisories.length
  ? motAdvisories.join(", ")
  : "No MOT advisories provided"}

User-reported symptoms:
"${symptom}"

Respond ONLY with valid JSON in this exact format:

{
  "likely_causes": [
    { "label": "string", "confidence": "high" | "medium" | "low" }
  ],
  "urgency": "green" | "amber" | "red",
  "advice": ["string"],
  "estimated_cost": "£x – £y",
  "notes": "short, calm explanation for the user"
}

Rules:
- Use probabilistic language ("may", "could", "suggests")
- Do NOT claim faults definitely exist
- Do NOT instruct dangerous actions
- If information is limited, say so briefly
- Assume the vehicle may still be drivable unless clearly unsafe
- Be concise and practical
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const usage = completion.usage;
    if (usage) {
      const PRICING = { inPer1M: 0.40, outPer1M: 1.60 };
      const estCost =
        (usage.prompt_tokens * PRICING.inPer1M +
          usage.completion_tokens * PRICING.outPer1M) /
        1_000_000;

      console.log("DIAGNOSE_AI_USAGE", {
        model: "gpt-4.1-mini",
        prompt: usage.prompt_tokens,
        completion: usage.completion_tokens,
        total: usage.total_tokens,
        estCostUsd: Number(estCost.toFixed(8)),
      });
    }

    const text = completion.choices?.[0]?.message?.content || "{}";
    const data = JSON.parse(text);

    // 🧹 Defensive sanitising (same philosophy as MOT insight)
    return res.json({
      likely_causes: Array.isArray(data.likely_causes)
        ? data.likely_causes.slice(0, 4)
        : [],
      urgency:
        data.urgency === "red" ||
        data.urgency === "amber" ||
        data.urgency === "green"
          ? data.urgency
          : "amber",
      advice: Array.isArray(data.advice) ? data.advice.slice(0, 4) : [],
      estimated_cost:
        typeof data.estimated_cost === "string"
          ? data.estimated_cost
          : "£0 – £300",
      notes: typeof data.notes === "string" ? data.notes : "",
    });

  } catch (e) {
    console.log("diagnose/analyse error", e);
    return res.status(500).json({ error: "AI failed" });
  }
});

export default router;
