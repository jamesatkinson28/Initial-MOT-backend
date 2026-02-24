// routes/diagnoseAi.js
import express from "express";
import { optionalAuth } from "../middleware/auth.js";
import { openai } from "../lib/openai.js";

function escalateUrgency(aiUrgency, minUrgency) {
  const order = { green: 0, amber: 1, red: 2 };

  if (!minUrgency) return aiUrgency;
  if (!aiUrgency) return minUrgency;

  return order[minUrgency] > order[aiUrgency]
    ? minUrgency
    : aiUrgency;
}

function getUrgencyReason(minUrgency, warningLights = []) {
  if (!minUrgency || !Array.isArray(warningLights) || warningLights.length === 0) {
    return null;
  }

  const critical = [
    "Oil pressure",
    "Engine temp",
    "Brake warning",
    "Battery / charging",
  ];

  const safety = [
    "Engine light",
    "DPF / emissions",
    "Glow plug",
    "ABS",
    "Traction control",
  ];

  const matched =
    minUrgency === "red"
      ? warningLights.filter(l => critical.includes(l))
      : warningLights.filter(l => safety.includes(l));

  if (matched.length === 0) return null;

  return `Urgency increased due to reported ${matched.join(", ")} warning light${matched.length > 1 ? "s" : ""}.`;
}


const router = express.Router();

/**
 * POST /diagnose/analyse
 * AI-powered vehicle diagnosis based on symptoms + context
 */
router.post(
  "/diagnose/analyse",
  (req, res, next) => {
    next();
  },
  optionalAuth,
  async (req, res) => {
    try {
      const userId = req.user?.id ?? null;
      const guestId =
	    req.guestId ??
	    req.query.guestId ??
	    null;

      if (!userId && !guestId) {
        return res.status(401).json({ error: "Not authorised" });
      }

      const {
        vehicleLabel,
        vrm,
        mileage,
        vehicleAgeYears,
        engine,
        fuelType,
		aspiration,
        symptom,
        recentServices,
        motAdvisories,
		warningLights,
		minUrgency,
      } = req.body || {};

      if (!symptom || typeof symptom !== "string") {
        return res.status(400).json({ error: "Missing symptom description" });
      }
		
	  const formatServiceHistory = (services = []) => {
	    if (!Array.isArray(services) || services.length === 0) {
		  return "None recorded";
	    }

	    return services.map((s) => {
		  const parts = [];

		  if (s.title) parts.push(s.title);
		  if (s.notes) parts.push(s.notes);
		  if (s.date) {
		    parts.push(new Date(s.date).toLocaleDateString("en-GB"));
		  }
		  if (s.mileage) parts.push(`${s.mileage} miles`);

		  return `- ${parts.join(" – ")}`;
	    }).join("\n");
	  };
	  
	  
	  const formattedServices = formatServiceHistory(recentServices);

const prompt = `
You are GarageGPT, a professional UK automotive diagnostic assistant with the expertise of a senior technician (20+ years).

Your task is to analyse a user-reported vehicle problem and return a structured, cautious diagnosis suitable for a consumer mobile app.

IMPORTANT BEHAVIOUR RULES:
• Do NOT claim certainty.
• Do NOT state that a fault is definite or confirmed.
• Use probability-based language such as "likely", "possible", or "commonly caused by".
• Do NOT ask follow-up questions in v1.
• Do NOT give unsafe advice or instructions.
• Assume no physical inspection has been performed.
• Do NOT restate the vehicle context or repeat input data in the output.


You MUST return strictly valid JSON.
Do NOT include commentary, explanations, or bullet points outside the JSON structure.
Do NOT repeat advice or causes outside their designated fields.
If unsure, return fewer items rather than breaking structure.


────────────────────────
VEHICLE CONTEXT (may be incomplete)
────────────────────────
Vehicle: ${vehicleLabel || "Unknown"}
VRM: ${vrm || "Unknown"}
Age (years): ${vehicleAgeYears ?? "Unknown"}
Engine description: ${engine || "Unknown"}
Fuel type: ${fuelType || "Unknown"}   (petrol | diesel | hybrid | electric | unknown)
Aspiration: ${aspiration || "Unknown"}   (turbocharged | naturally aspirated | supercharged | unknown)
Mileage: ${mileage ?? "Unknown"}

Recent service history (optional):
${formattedServices}

MOT advisories (optional):
${Array.isArray(motAdvisories) && motAdvisories.length
  ? motAdvisories.map(a => `- ${a}`).join("\n")
  : "None recorded"}

User-reported symptoms:
"${symptom}"

────────────────────────
DIAGNOSTIC REASONING RULES
────────────────────────
Use experienced mechanic-style reasoning:

• Prioritise common and age-appropriate faults before rare failures.
• Use mileage and age to increase or reduce confidence in wear-related issues.
• If recent service work exists, consider disturbed components, incorrect refitting, or coincidental failure.
• Differentiate symptoms by operating condition where possible (cold vs warm, idle vs load).
• Be honest about uncertainty and reduce confidence where information is limited.

If a component has been recently replaced or rebuilt, reduce confidence that it is the primary cause unless symptoms strongly indicate installation, sealing, or secondary failure.

If emissions-related modifications or previous engine work are mentioned, consider:
- Incomplete blanking or sealing
- Calibration or mapping side effects
- Thermal expansion noises from altered exhaust or turbo components
Do NOT assume legality or illegality; diagnose based on mechanical behaviour only.

If a component has been recently replaced, rebuilt, or serviced, you MUST reduce confidence that simple wear is the cause.
Only assign "medium" confidence if symptoms strongly indicate installation, sealing, calibration, or secondary system issues.
Otherwise, assign "low" confidence and prioritise related systems (breather, oil control, turbo drainage, sensors, or residual effects).

────────────────────────
MODIFIED OR NON-STANDARD VEHICLES
────────────────────────
• Vehicles may have been modified, tuned, or altered from factory specification.
• If the user indicates modifications (e.g. EGR/DPF removal, remapping, exhaust changes), do NOT refuse diagnosis.
• Do NOT comment on legality, compliance, or regulations.
• Diagnose the vehicle as-presented.
• Consider technical consequences of incomplete physical removal, poor calibration, sensor mismatches, exhaust leaks, or degraded components following modification.
• Adjust likelihoods accordingly without assuming modifications unless stated.

────────────────────────
POWERTRAIN-SPECIFIC CONSTRAINTS
────────────────────────
You MUST tailor suggestions to the vehicle type.

If fuel type is DIESEL:
• Do NOT mention spark plugs or ignition coils.
• You MAY mention: glow plugs (cold start), injectors, fuel filter, fuel pressure, air leaks, MAF/MAP, EGR, DPF, turbo, boost or vacuum leaks, intercooler hoses, intake restrictions.

If fuel type is PETROL:
• You MAY mention: spark plugs, ignition coils, misfires, fuel trim, vacuum leaks, PCV, throttle body, injectors, MAF/MAP.

If fuel type is HYBRID:
• Consider both combustion and hybrid systems.
• You MAY mention relevant petrol/diesel components plus hybrid battery cooling, inverter behaviour, regen braking issues, hybrid warning messages.
• Do NOT suggest user interaction with high-voltage components.

If fuel type is ELECTRIC:
• Do NOT mention: engine oil, spark plugs, injectors, turbo, DPF, EGR, exhaust components.
• You MAY mention: 12V battery, high-voltage battery health, thermal management, charge port issues, inverter or motor noise, drivetrain vibration, brake corrosion, software or calibration issues.


Warning lights reported by user:
${Array.isArray(warningLights) && warningLights.length
  ? warningLights.map(l => `- ${l}`).join("\n")
  : "None reported"}

If critical warning lights are present, you MUST NOT assign "green" urgency.
If safety-related lights are present, prioritise "red" or "amber" accordingly.

────────────────────────
SAFETY & URGENCY
────────────────────────
Assess urgency realistically:

• RED: symptoms suggesting immediate safety risk (e.g. severe power loss, overheating, strong fuel smells, continuous smoke, flashing warning lights).
• AMBER: faults that should be inspected soon but may allow limited driving with caution.
• GREEN: low urgency issues suitable for monitoring.

Never instruct unsafe driving or DIY repairs.

────────────────────────
OUTPUT FORMAT (STRICT JSON ONLY)
────────────────────────
The JSON MUST be directly parseable using JSON.parse().
Return ONLY valid JSON in exactly this structure.
Do NOT include markdown.
Do NOT include trailing commas or duplicate brackets.
Do NOT include text outside the JSON object.
If any field cannot be populated confidently, return a sensible placeholder rather than omitting the field.

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
• likely_causes: 3–5 items
• advice: 3–6 practical next steps
• estimated_cost: realistic UK independent garage range; if uncertain use "£0 – £300"
• notes: 1–3 sentences in plain English, explaining reasoning and uncertainty

────────────────────────
FINAL REMINDERS
────────────────────────
• Never state that a diagnosis is definitive.
• Never assume missing information.
• If information is limited, state this briefly in "notes".
• Diagnose the vehicle as it exists today, not how it left the factory.
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
    }

      const text = completion.choices?.[0]?.message?.content || "{}";


		let data;
		try {
		  data = JSON.parse(text);
		} catch (e) {
		  console.error("DIAGNOSE JSON PARSE FAILED", text);
		  data = {};
		}

		// 🔐 Enforce minimum urgency based on warning lights
		data.urgency = escalateUrgency(
		  data.urgency,
		  minUrgency
		);
		
		const urgencyReason = getUrgencyReason(minUrgency, warningLights);

		if (urgencyReason) {
		  data.urgency_reason = urgencyReason;
		}


		// ✅ HARD GUARANTEES — frontend can trust this shape
		return res.json({
		  likely_causes: Array.isArray(data.likely_causes)
			? data.likely_causes.slice(0, 5)
			: [],

		  advice: Array.isArray(data.advice)
			? data.advice.slice(0, 6)
			: [],

		  urgency:
			data.urgency === "red" ||
			data.urgency === "amber" ||
			data.urgency === "green"
			  ? data.urgency
			  : "amber",

		  estimated_cost:
			typeof data.estimated_cost === "string"
			  ? data.estimated_cost
			  : "£0 – £300",

		  notes:
			typeof data.notes === "string"
			  ? data.notes
			  : "Based on the information provided, this assessment is indicative and further inspection may be required.",
		});
			} catch (err) {
			  console.error("DIAGNOSE BACKEND ERROR", err);
			  return res.status(500).json({ error: "AI failed" });
			}
		  }
		);



export default router;

