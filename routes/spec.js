import express from "express";
import { authRequired } from "../middleware/auth.js";
import { query } from "../db/db.js";
import axios from "axios";

const router = express.Router();

const ENABLE_IMAGES = false;

// ------------------------------------------------------------
// RESET MONTHLY FREE UNLOCKS
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
// REMOVE NULLS FROM OUTPUT
// ------------------------------------------------------------
function removeNulls(obj) {
  if (Array.isArray(obj)) return obj.map(removeNulls);

  if (obj !== null && typeof obj === "object") {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined) {
        cleaned[key] = removeNulls(value);
      }
    }
    return cleaned;
  }
  return obj;
}

// ------------------------------------------------------------
// CLEAN SPEC BUILDER (STATIC DATA ONLY)
// Includes MPG, L/100km + Sound Levels
// ------------------------------------------------------------
function buildCleanSpec(apiResults) {
  const vd = apiResults?.VehicleDetails || {};
  const vId = vd.VehicleIdentification || {};
  const vTech = vd.DvlaTechnicalDetails || {};
  const vStatus = vd.VehicleStatus || {};

  const model = apiResults?.ModelDetails || {};
  const mId = model.ModelIdentification || {};
  const dims = model.Dimensions || {};
  const weights = model.Weights || {};
  const body = model.BodyDetails || {};

  const performance = model.Performance || {};
  const power = performance?.Power || {};
  const torque = performance?.Torque || {};
  const stats = performance?.Statistics || {};
  const fuelEconomy = performance?.FuelEconomy || {};

  const emissions = model.Emissions || {};
  const sound = emissions?.SoundLevels || {};
  const safety = model.Safety || {};

  const powertrain = model.Powertrain || {};
  const ice = powertrain?.IceDetails || {};

  let clean = {
    identity: {
      vrm: vId.Vrm,
      make: mId.Make || vId.DvlaMake,
      model: mId.Model || mId.Range || vId.DvlaModel,
      variant: mId.ModelVariant,
      year_of_manufacture: vId.YearOfManufacture,
      body_style: body.BodyStyle,
      number_of_doors: body.NumberOfDoors,
      seats: body.NumberOfSeats,
      wheelbase: body.WheelbaseType,
      axles: body.NumberOfAxles,
      country_of_origin: mId.CountryOfOrigin
    },

    engine: {
      engine_cc: ice?.EngineCapacityCc || vTech.EngineCapacityCc,
      engine_litres: ice?.EngineCapacityLitres,
      aspiration: ice?.Aspiration,
      cylinder_arrangement: ice?.CylinderArrangement,
      cylinders: ice?.NumberOfCylinders,
      bore_mm: ice?.BoreMm,
      stroke_mm: ice?.StrokeMm,
      valves_per_cylinder: ice?.ValvesPerCylinder,
      valve_gear: ice?.ValveGear,
      fuel_type: vId.DvlaFuelType || powertrain.FuelType,
      engine_location: ice?.EngineLocation,
      engine_description: ice?.EngineDescription
    },

    performance: {
      bhp: power?.Bhp,
      ps: power?.Ps,
      kw: power?.Kw,
      torque_nm: torque?.Nm,
      torque_lbft: torque?.LbFt,
      zero_to_60_mph: stats?.ZeroToSixtyMph,
      zero_to_100_kph: stats?.ZeroToOneHundredKph,
      top_speed_mph: stats?.MaxSpeedMph,
      top_speed_kph: stats?.MaxSpeedKph
    },

    fuel_economy: {
      urban_mpg: fuelEconomy?.UrbanColdMpg,
      extra_urban_mpg: fuelEconomy?.ExtraUrbanMpg,
      combined_mpg: fuelEconomy?.CombinedMpg,
      urban_l_100km: fuelEconomy?.UrbanColdL100Km,
      extra_urban_l_100km: fuelEconomy?.ExtraUrbanL100Km,
      combined_l_100km: fuelEconomy?.CombinedL100Km
    },

    dimensions: {
      height_mm: dims?.HeightMm,
      length_mm: dims?.LengthMm,
      width_mm: dims?.WidthMm,
      wheelbase_mm: dims?.WheelbaseLengthMm
    },

    weights: {
      kerb_weight_kg: weights?.KerbWeightKg,
      gross_vehicle_weight_kg: weights?.GrossVehicleWeightKg,
      mass_in_service_kg: vTech?.MassInServiceKg
    },

    safety: {
      ncap_rating: safety?.EuroNcap?.NcapStarRating,
      ncap_adult_percent: safety?.EuroNcap?.NcapAdultPercent,
      ncap_child_percent: safety?.EuroNcap?.NcapChildPercent,
      ncap_pedestrian_percent: safety?.EuroNcap?.NcapPedestrianPercent,
      ncap_safety_assist_percent: safety?.EuroNcap?.NcapSafetyAssistPercent
    },

    emissions: {
      euro_status: emissions?.EuroStatus,
      co2_g_km: emissions?.ManufacturerCo2,
      sound_stationary_db: sound?.StationaryDb,
      sound_driveby_db: sound?.DriveByDb
    },

    images: null
  };

  return removeNulls(clean);
}

// ------------------------------------------------------------
// OPTIONAL IMAGE FETCHING (DISABLED)
// ------------------------------------------------------------
async function fetchImagesFromVDG(vrm) {
  if (!ENABLE_IMAGES) return null;
  return { main: null, angles: [] };
}

// ------------------------------------------------------------
// FETCH SPEC FROM API
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

  if (!data?.Results?.VehicleDetails) return null;

  const cleanSpec = buildCleanSpec(data.Results);
  cleanSpec.images = await fetchImagesFromVDG(vrm);

  return cleanSpec;
}

// ------------------------------------------------------------
// UNLOCK SPEC ROUTE (CORRECTED VERSION)
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

    // Check if already unlocked
    const unlocked = await query(
      `SELECT 1 FROM unlocked_specs WHERE user_id=$1 AND vrm=$2`,
      [user_id, vrmUpper]
    );

    if (unlocked.rows.length > 0) {
      return res.json({
        success: true,
        price: 0,
        alreadyUnlocked: true,
        spec: cached.rows.length > 0 ? cached.rows[0].spec_json : null
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
        price = Number((1.49 * 0.75).toFixed(2)); // 25% discount
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

    // Fix: Prevent duplicate unlock errors
    await query(
      `INSERT INTO unlocked_specs (user_id, vrm)
       VALUES ($1, $2)
       ON CONFLICT (user_id, vrm) DO NOTHING`,
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
