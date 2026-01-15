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

    if (response.status === 404) {
	  return res.status(404).json({ error: "VEHICLE_NOT_FOUND" });
	}

	if (!response.ok) {
	  return res.status(502).json({
		error: "DVLA_TEMPORARY_ERROR",
		status: response.status,
	  });
	}

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "DVLA service error" });
  }
});

export default router;
