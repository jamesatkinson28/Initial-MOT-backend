import express from "express";
import { authRequired } from "../middleware/auth.js";
import { query } from "../db/db.js";
import axios from "axios";

const router = express.Router();

// ------------------------------------------------------------
// FUTURE IMAGE SUPPORT (OFF FOR NOW — ENABLE LATER)
// ------------------------------------------------------------
const ENABLE_IMAGES = false; // 🔥 Turn to TRUE in future when 20p lookups are OK

// ------------------------------------------------------------
// Reset premium unlocks monthly
// ------------------------------------------------------------
async function resetMonthlyIfNeeded(user_id) {
  const { rows } = await query(
    `SELECT monthly_unlocks_remaining, last_unlock_reset 
     FROM users WHERE id=$1`,
    [user_id]
  );

  const user = rows[0];
  const now = new Date();
  const lastReset = new Date(user.last_unlock_reset);

  const isNewMonth =
    now.getMonth() !== lastReset.getMonth() ||
    now.getFullYear() !== lastReset.getFullYear();

  if (isNewMonth) {
    await query(
      `UPDATE users
       SET monthly_unlocks_remaining = 3,
           last_unlock_reset = NOW()
       WHERE id=$1`,
      [user_id]
    );
    return 3;
  }

  return user.monthly_unlocks_remaining;
}

// ------------------------------------------------------------
// CLEAN SPEC BUILDER (EXTENDED VERSION)
// ------------------------------------------------------------
function buildCleanSpec(apiResults) {
  const vd = apiResults?.VehicleDetails || {};
  const vId = vd.VehicleIdentification || {};
  const vTech = vd.DvlaTechnicalDetails || {};
  const vStatus = vd.VehicleStatus || {};
  const vHist = vd.VehicleHistory || {};

  const model = apiResults?.ModelDetails || {};
  const mId = model.ModelIdentification || {};
  const mBody = model.BodyDetails || {};
  const dims = model.Dimensions || {};
  const weights = model.Weights || {};
  const powertrain = model.Powertrain || {};
  const ice = powertrain.IceDetails || {};
  const perf = model.Performance || {};
  const emissions = model.Emissions || {};
  const safety = model.Safety || {};
  const trans = model.Transmission || {};

  return {
    vrm: vId.Vrm || null,

    // -------------------------
    // BASIC VEHICLE INFO
    // -------------------------
    make: mId.Make || vId.DvlaMake || "Unknown",
    model: mId.Range || vId.DvlaModel || "Unknown",
    variant: mId.ModelVariant || null,
    mark: mId.Mark || null,
    year: vId.YearOfManufacture || null,
    country_of_origin: mId.CountryOfOrigin || null,

    // -------------------------
    // ENGINE DETAILS
    // -------------------------
    engine: {
      capacity_cc: ice.EngineCapacityCc || vTech.EngineCapacityCc || null,
      capacity_litres: ice.EngineCapacityLitres || null,
      cylinders: ice.NumberOfCylinders || null,
      aspiration: ice.Aspiration || null,
      fuel_type: vId.DvlaFuelType || powertrain.FuelType || null,

      power_bhp: perf?.Power?.Bhp || null,
      power_kw: perf?.Power?.Kw || null,
      torque_nm: perf?.Torque?.Nm || null,

      bore_mm: ice.BoreMm || null,
      stroke_mm: ice.StrokeMm || null,
      valve_gear: ice.ValveGear || null,
      valves_per_cylinder: ice.ValvesPerCylinder || null,
      cylinder_arrangement: ice.CylinderArrangement || null
    },

    // -------------------------
    // PERFORMANCE
    // -------------------------
    performance: {
      zero_to_60_mph: perf?.Statistics?.ZeroToSixtyMph || null,
      zero_to_100_kph: perf?.Statistics?.ZeroToOneHundredKph || null,
      top_speed_mph: perf?.Statistics?.MaxSpeedMph || null,
      top_speed_kph: perf?.Statistics?.MaxSpeedKph || null
    },

    // -------------------------
    // DIMENSIONS
    // -------------------------
    dimensions: {
      height_mm: dims.HeightMm || null,
      length_mm: dims.LengthMm || null,
      width_mm: dims.WidthMm || null,
      wheelbase_mm: dims.WheelbaseLengthMm || null
    },

    // -------------------------
    // WEIGHTS
    // -------------------------
    weights: {
      kerb_weight_kg: weights.KerbWeightKg || null,
      gross_vehicle_weight_kg: weights.GrossVehicleWeightKg || null,
      payload_kg: weights.PayloadWeightKg || null
    },

    // -------------------------
    // DVLA DATA
    // -------------------------
    dvla: {
      body_type: vId.DvlaBodyType || null,
      fuel_type: vId.DvlaFuelType || null,
      co2: vStatus?.VehicleExciseDutyDetails?.DvlaCo2 || emissions.ManufacturerCo2 || null,
      tax_band: vStatus?.VehicleExciseDutyDetails?.DvlaCo2Band || null,
      original_colour: vHist?.ColourDetails?.OriginalColour || null
    },

    // -------------------------
    // BODY DETAILS
    // -------------------------
    body: {
      doors: mBody.NumberOfDoors || null,
      seats: mBody.NumberOfSeats || null,
      axles: mBody.NumberOfAxles || null,
      fuel_tank_litres: mBody.FuelTankCapacityLitres || null,
      driving_axle:
		trans.DrivingAxle ||
		powertrain?.TransmissionDetailsList?.[0]?.DrivingAxle ||
		null
    },

    // -------------------------
    // TRANSMISSION
    // -------------------------
    const primaryTrans = raw?.Results?.ModelDetails?.Powertrain?.Transmission || {};
	const evTrans = raw?.Results?.ModelDetails?.Powertrain?.TransmissionDetailsList?.[0] || {};

	transmission: {
	  type:
		primaryTrans.TransmissionType ||
		evTrans.TransmissionType ||
		null,

	  drive:
		primaryTrans.DriveType ||
		evTrans.DriveType ||
		null,

	  gears:
		primaryTrans.NumberOfGears ||
		evTrans.NumberOfGears ||
		null
    },

    // -------------------------
    // EMISSIONS
    // -------------------------
    emissions: {
      euro_status: emissions.EuroStatus || null
    },

    // -------------------------
    // SAFETY
    // -------------------------
    safety: {
      ncap_star_rating: safety?.EuroNcap?.NcapStarRating || null,
      ncap_adult_percent: safety?.EuroNcap?.NcapAdultPercent || null,
      ncap_child_percent: safety?.EuroNcap?.NcapChildPercent || null,
      ncap_pedestrian_percent: safety?.EuroNcap?.NcapPedestrianPercent || null,
      ncap_safety_assist_percent: safety?.EuroNcap?.NcapSafetyAssistPercent || null
    },

    // FUTURE IMAGE SUPPORT
    images: null
  };
}


// ------------------------------------------------------------
// FUTURE IMAGE FETCHING (DISABLED)
// ------------------------------------------------------------
async function fetchImagesFromVDG(vrm) {
  if (!ENABLE_IMAGES) return null; // Images turned off for now

  // 🔥 In the future, VDG may expose image URLs here
  // Placeholder for future support
  return {
    main: null,
    angles: []
  };
}

// ------------------------------------------------------------
// FETCH VEHICLE DETAILS FROM VDG (SPEC ONLY FOR NOW)
// ------------------------------------------------------------
async function fetchSpecDataFromAPI(vrm) {
  const url = `${process.env.SPEC_API_BASE_URL}/r2/lookup`;

  const response = await axios.get(url, {
    params: {
      ApiKey: process.env.SPEC_API_KEY,
      PackageName: "VehicleDetails",
      Vrm: vrm
    }
  });

  const data = response.data;

  if (!data?.Results?.VehicleDetails) {
    return null;
  }

  const cleanSpec = buildCleanSpec(data.Results);

  // Add future image support (currently null)
  cleanSpec.images = await fetchImagesFromVDG(vrm);

  return cleanSpec;
}

// ------------------------------------------------------------
// UNLOCK SPEC ROUTE
// ------------------------------------------------------------
router.post("/unlock-spec", authRequired, async (req, res) => {
  try {
    const { vrm } = req.body;
    if (!vrm) return res.status(400).json({ error: "VRM required" });

    const vrmUpper = vrm.toUpperCase();
    const user_id = req.user.id;

    // Check cache
    const cached = await query(
      `SELECT spec_json FROM vehicle_specs WHERE vrm=$1`,
      [vrmUpper]
    );

    if (cached.rows.length > 0) {
      return res.json({
        success: true,
        price: 0,
        alreadyUnlocked: true,
        spec: cached.rows[0].spec_json
      });
    }

    // Premium logic
    const userRow = await query(
      `SELECT premium, premium_until, monthly_unlocks_remaining 
       FROM users WHERE id=$1`,
      [user_id]
    );

    const user = userRow.rows[0];
    const isPremium =
      user.premium &&
      (!user.premium_until || new Date(user.premium_until) > new Date());

    let remaining = isPremium ? await resetMonthlyIfNeeded(user_id) : null;

    let price = 1.49;
    if (isPremium) {
      if (remaining > 0) {
        price = 0;
        await query(
          `UPDATE users SET monthly_unlocks_remaining = monthly_unlocks_remaining - 1 WHERE id=$1`,
          [user_id]
        );
      } else {
        price = Number((1.49 * (1 - 0.25)).toFixed(2));
      }
    }

    // Fetch fresh spec
    const spec = await fetchSpecDataFromAPI(vrmUpper);
    if (!spec) return res.status(404).json({ error: "Vehicle spec not found" });

    // Cache it
    await query(
      `INSERT INTO vehicle_specs (vrm, spec_json)
       VALUES ($1, $2)
       ON CONFLICT (vrm) DO UPDATE SET spec_json=$2, updated_at=NOW()`,
      [vrmUpper, spec]
    );

    // Mark unlocked
    await query(
      `INSERT INTO unlocked_specs (user_id, vrm) VALUES ($1, $2)`,
      [user_id, vrmUpper]
    );

    return res.json({
      success: true,
      price,
      isPremium,
      remainingFreeUnlocks: isPremium ? remaining - (price === 0 ? 1 : 0) : null,
      spec
    });

  } catch (err) {
    console.error("UNLOCK SPEC ERROR:", err);
    res.status(500).json({ error: "Failed to unlock spec" });
  }
});

export default router;
