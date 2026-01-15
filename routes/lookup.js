import express from "express";
import fetch from "node-fetch";

const router = express.Router();

router.get("/", async (req, res) => {
  const { vrm } = req.query;

  if (!vrm) {
    return res.status(400).json({ error: "Missing VRM" });
  }

  try {
    // 1️⃣ DVLA FIRST (authoritative)
    const dvlaRes = await fetch(
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

    if (dvlaRes.status === 404) {
      return res.status(404).json({ error: "VEHICLE_NOT_FOUND" });
    }

    if (!dvlaRes.ok) {
      return res.status(502).json({ error: "DVLA_TEMPORARY_ERROR" });
    }

    const vehicle = await dvlaRes.json();

    // 2️⃣ MOT SECONDARY (non-fatal)
    let mot = null;
    let motStatus = "PENDING";

    try {
      const motRes = await fetch(
        `https://initial-mot-backend-production.up.railway.app/mot?vrm=${vrm}`
      );

      if (motRes.ok) {
        mot = await motRes.json();
        motStatus = "AVAILABLE";
      }
    } catch {
      // swallow MOT errors
    }

    // 3️⃣ Always return DVLA vehicle
    res.json({
      vehicle,
      mot,
      motStatus,
    });
  } catch (err) {
    res.status(500).json({ error: "LOOKUP_FAILED" });
  }
});

export default router;
