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
// ----------------------
// NORMALIZE SPEC FUNCTION
// ----------------------
function normalizeSpec(raw, vrm) {
  const vehicle = raw?.Results?.VehicleDetails;
  const model = raw?.Results?.ModelDetails;

  const tech = vehicle?.DvlaTechnicalDetails || {};
  const body = model?.BodyDetails || {};
  const dims = model?.Dimensions || {};
  const weights = model?.Weights || {};
  const perf = model?.Performance || {};
  const ice = model?.Powertrain?.IceDetails || {};
  const trans =
	model?.Powertrain?.Transmission ||
	model?.Transmission ||
	raw?.Results?.ModelDetails?.Transmission ||
	{};
  const ncap = model?.Safety?.EuroNcap || {};
  const emissions = model?.Emissions || {};

  return {
    vrm,
    body: {
      axles: body.NumberOfAxles ?? null,
      doors: body.NumberOfDoors ?? null,
      seats: body.NumberOfSeats ?? tech.NumberOfSeats ?? null,
      driving_axle: trans.DrivingAxle ?? null,
      fuel_tank_litres: body.FuelTankCapacityLitres ?? null
    },
    dvla: {
      co2: vehicle?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaCo2 ?? null,
      tax_band: vehicle?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaCo2Band ?? null,
      body_type: vehicle?.VehicleIdentification?.DvlaBodyType ?? null,
      fuel_type: vehicle?.VehicleIdentification?.DvlaFuelType ?? null,
      original_colour: vehicle?.VehicleHistory?.ColourDetails?.OriginalColour ?? null
    },
    make: model?.ModelIdentification?.Make ?? null,
    model: model?.ModelIdentification?.Range ?? null,
    variant: model?.ModelIdentification?.ModelVariant ?? null,
    mark: model?.ModelIdentification?.Mark ?? null,
    country_of_origin: model?.ModelIdentification?.CountryOfOrigin ?? null,
    year: vehicle?.VehicleIdentification?.YearOfManufacture ?? null,

    engine: {
      capacity_cc: ice.EngineCapacityCc ?? null,
      capacity_litres: ice.EngineCapacityLitres ?? null,
      cylinders: ice.NumberOfCylinders ?? null,
      cylinder_arrangement: ice.CylinderArrangement ?? null,
      valves_per_cylinder: ice.ValvesPerCylinder ?? null,
      valve_gear: ice.ValveGear ?? null,
      bore_mm: ice.BoreMm ?? null,
      stroke_mm: ice.StrokeMm ?? null,
      aspiration: ice.Aspiration ?? null,
      torque_nm: perf?.Torque?.Nm ?? null,
      power_kw: perf?.Power?.Kw ?? null,
      power_bhp: perf?.Power?.Bhp ?? null,
      fuel_type: model?.Powertrain?.FuelType ?? null
    },

    safety: {
      ncap_star_rating: ncap.NcapStarRating ?? null,
      ncap_adult_percent: ncap.NcapAdultPercent ?? null,
      ncap_child_percent: ncap.NcapChildPercent ?? null,
      ncap_pedestrian_percent: ncap.NcapPedestrianPercent ?? null,
      ncap_safety_assist_percent: ncap.NcapSafetyAssistPercent ?? null
    },

    weights: {
      kerb_weight_kg: weights.KerbWeightKg ?? null,
      gross_vehicle_weight_kg: weights.GrossVehicleWeightKg ?? null,
      payload_kg: weights.PayloadWeightKg ?? null
    },

    emissions: {
      euro_status: emissions.EuroStatus ?? null
    },

    dimensions: {
      width_mm: dims.WidthMm ?? null,
      height_mm: dims.HeightMm ?? null,
      length_mm: dims.LengthMm ?? null,
      wheelbase_mm: dims.WheelbaseLengthMm ?? null
    },

    performance: {
      top_speed_kph: perf?.Statistics?.MaxSpeedKph ?? null,
      top_speed_mph: perf?.Statistics?.MaxSpeedMph ?? null,
      zero_to_60_mph: perf?.Statistics?.ZeroToSixtyMph ?? null,
      zero_to_100_kph: perf?.Statistics?.ZeroToOneHundredKph ?? null
    },

    transmission: {
	  type: trans.TransmissionType ?? null,
	  drive: trans.DriveType ?? null,
	  gears: trans.NumberOfGears ?? null,
	  driving_axle: trans.DrivingAxle ?? null
	},


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
