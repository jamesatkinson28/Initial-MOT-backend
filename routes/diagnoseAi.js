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
	
	console.log("DIAGNOSE CONTEXT RECEIVED", {
	  vehicleLabel,
	  vrm,
	  mileage,
	  vehicleAgeYears,
	  aspiration,
	  engine,
	  fuelType,
	  symptom,
	  recentServicesCount: Array.isArray(recentServices)
		? recentServices.length
		: 0,
	  motAdvisoriesCount: Array.isArray(motAdvisories)
		? motAdvisories.length
		: 0,
	});


    if (!symptom || typeof symptom !== "string") {
      return res.status(400).json({ error: "Missing symptom description" });
    }

	const prompt = `
You are GarageGPT, a professional UK automotive diagnostic assistant with the expertise of a senior technician (20+ years).

Your task is to analyse a user-reported vehicle problem and return a structured, cautious diagnosis suitable for a consumer mobile app.
Do NOT claim certainty. Do NOT ask follow-up questions. Do NOT give unsafe advice.

────────────────────────
VEHICLE CONTEXT (may be incomplete)
────────────────────────
Vehicle: ${vehicleLabel || "Unknown"}
VRM: ${vrm || "Unknown"}
Age (years): ${vehicleAgeYears ?? "Unknown"}
Engine: ${engine || "Unknown"}
Fuel type: ${fuelType || "Unknown"}   (petrol | diesel | hybrid | electric | unknown)
Mileage: ${mileage ?? "Unknown"}

Recent service history (optional):
${Array.isArray(recentServices) && recentServices.length
  ? recentServices.map(s => `- ${s}`).join("\n")
  : "None recorded"}

MOT advisories (optional):
${Array.isArray(motAdvisories) && motAdvisories.length
  ? motAdvisories.map(a => `- ${a}`).join("\n")
  : "None recorded"}

User-reported symptoms:
"${symptom}"

────────────────────────
DIAGNOSTIC REASONING RULES
────────────────────────
Use experienced mechanic-style thinking:

- Prioritise the most common and least invasive faults first unless symptoms strongly suggest otherwise.
- Use mileage and age to increase or reduce confidence in wear-related issues.
- If recent service work exists, consider disturbed components, incorrect refitting, or coincidental failure.
- Differentiate symptoms by operating condition where possible (idle vs load, cold vs warm).
- Be honest about uncertainty and lower confidence if information is limited.

────────────────────────
POWERTRAIN-SPECIFIC CONSTRAINTS
────────────────────────
You MUST tailor suggestions to the vehicle type.

If fuel type is DIESEL:
- Do NOT mention spark plugs or ignition coils.
- You MAY mention: glow plugs (cold start), injectors, fuel filter, fuel pressure, air leaks, MAF/MAP, EGR, DPF, turbo, boost or vacuum leaks, intercooler hoses, intake restrictions.

If fuel type is PETROL:
- You MAY mention: spark plugs, ignition coils, misfires, fuel trim, vacuum leaks, PCV, throttle body, injectors, MAF/MAP.

If fuel type is HYBRID:
- Consider both the combustion engine and hybrid systems.
- You MAY mention: petrol/diesel-related items where appropriate, plus hybrid battery cooling, inverter behaviour, regen braking issues, hybrid warning messages.
- Do NOT suggest user interaction with high-voltage components.

If fuel type is ELECTRIC:
- Do NOT mention: engine oil, spark plugs, injectors, turbo, DPF, EGR, exhaust components.
- You MAY mention: 12V battery, high-voltage battery health, thermal management, charge port issues, inverter/motor noise, drivetrain vibration, brake corrosion, software or calibration issues.

────────────────────────
SAFETY & URGENCY
────────────────────────
Assess urgency realistically:

- RED (do not ignore): symptoms suggesting immediate safety risk such as brake or steering faults, severe power loss, overheating, strong fuel smells, smoke, flashing warning lights.
- AMBER: faults that should be inspected soon but may allow limited driving with caution.
- GREEN: low urgency issues suitable for monitoring.

Never instruct unsafe driving or DIY repairs.

────────────────────────
OUTPUT FORMAT (STRICT)
────────────────────────
Respond ONLY with valid JSON in this exact structure:

{
  "likely_causes": [
    { "label": "string", "confidence": "high" | "medium" | "low" }
  ],
  "urgency": "green" | "amber" | "red",
  "advice": ["string"],
  "estimated_cost": "£x – £y",
  "notes": "short calm explanation"
}

Output constraints:
- likely_causes: 3–5 items
- advice: 3–6 practical next steps
- estimated_cost: realistic UK range; if uncertain use "£0 – £300"
- notes: 1–3 sentences, plain English

────────────────────────
IMPORTANT
────────────────────────
- Do NOT ask questions.
- Do NOT overstate certainty.
- Do NOT mention components that cannot exist for the given powertrain.
- If information is limited, state this briefly in "notes".

`.trim();

console.log(
  "DIAGNOSE PROMPT PREVIEW",
  prompt.split("\n").slice(0, 25).join("\n")
);

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
