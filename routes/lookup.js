import express from "express";
import fetch from "node-fetch";
import axios from "axios";
import { getToken } from "../lib/dvsaToken.js";

const router = express.Router();

// ─────────────────────────────────────────────
// Simple in-memory cache (same as /mot)
// ─────────────────────────────────────────────
const vrmCache = {};
const CACHE_LIFETIME = 60 * 60; // 1 hour

const normaliseVRM = (vrm) =>
  vrm.replace(/[^A-Z0-9]/gi, "").toUpperCase();

router.get("/", async (req, res) => {
  const { vrm } = req.query;

  if (!vrm) {
    return res.status(400).json({ error: "Missing VRM" });
  }

  const normalisedVRM = normaliseVRM(vrm);

  try {
    // ─────────────────────────────────────────────
    // 1️⃣ DVLA (authoritative, fatal if fails)
    // ─────────────────────────────────────────────
    const dvlaRes = await fetch(
      "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.DVLA_API_KEY_LIVE,
        },
        body: JSON.stringify({
          registrationNumber: normalisedVRM,
        }),
      }
    );

    if (dvlaRes.status === 404) {
      return res.status(404).json({ error: "VEHICLE_NOT_FOUND" });
    }

    if (!dvlaRes.ok) {
      return res.status(502).json({ error: "DVLA_TEMPORARY_ERROR" });
    }

    const vehicle = await dvlaRes.json();
	
	// ─────────────────────────────────────────────
	// Cache DVLA lookup (temporary DB cache)
	// ─────────────────────────────────────────────
	try {
	  await query(
		`
		INSERT INTO dvla_lookup_cache (vrm, dvla_json, fetched_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (vrm)
		DO UPDATE SET dvla_json = EXCLUDED.dvla_json, fetched_at = NOW()
		`,
		[normalisedVRM, vehicle]
	  );
	} catch (e) {
	  console.error("DVLA cache write failed (non-fatal):", e.message);
	}

	

    // ─────────────────────────────────────────────
    // 2️⃣ MOT (secondary, cached, non-fatal)
    // ─────────────────────────────────────────────
    let mot = null;
    let motStatus = "PENDING";

    const now = Math.floor(Date.now() / 1000);

    try {
      if (
        vrmCache[normalisedVRM] &&
        now < vrmCache[normalisedVRM].expires
      ) {
        mot = vrmCache[normalisedVRM].data;
        motStatus = "AVAILABLE";
      } else {
        const token = await getToken();

        const url = `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(
          normalisedVRM
        )}`;

        const motRes = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-API-Key": process.env.API_KEY,
          },
        });

        mot = motRes.data;
        motStatus = "AVAILABLE";

        vrmCache[normalisedVRM] = {
          data: mot,
          expires: now + CACHE_LIFETIME,
        };
      }
    } catch (e) {
      console.log("MOT fetch failed (non-fatal):", e.message);
    }

    // ─────────────────────────────────────────────
    // 3️⃣ Unified response
    // ─────────────────────────────────────────────
    return res.json({
      vehicle,
      mot,
      motStatus,
    });
  } catch (err) {
    console.error("Lookup error:", err);
    return res.status(500).json({ error: "LOOKUP_FAILED" });
  }
});

export default router;
