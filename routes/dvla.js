import express from "express";
import fetch from "node-fetch";

const router = express.Router();

router.get("/dvla", async (req, res) => {
  const { vrm } = req.query;

  if (!vrm) {
    return res.status(400).json({ error: "Missing VRM" });
  }

  try {
    const response = await fetch(
      "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.DVLA_API_KEY_LIVE,
        },
        body: JSON.stringify({ registrationNumber: vrm }),
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "DVLA lookup failed" });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "DVLA service error" });
  }
});

export default router;
