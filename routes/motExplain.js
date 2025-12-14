import express from "express";
import auth from "../middleware/auth.js";
import openai from "../lib/openai.js";

const router = express.Router();

router.post("/mot-explain", auth, async (req, res) => {
  const { text, type } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Missing MOT text" });
  }

  const prompt = `
You are GarageGPT, a UK MOT expert.

Explain the following MOT ${type === "ADVISORY" ? "advisory" : "failure"}
in plain English for a non-technical car owner.

Be clear, practical, and concise.
Do NOT mention laws or test numbers.

MOT item:
"${text}"
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 180,
    });

    res.json({
      explanation: completion.choices[0].message.content.trim(),
    });
  } catch (err) {
    console.error("mot-explain error", err);
    res.status(500).json({ error: "AI explain failed" });
  }
});

export default router;
