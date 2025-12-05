import express from "express";
import fetch from "node-fetch";
import db from "../db/db.js";
import { authMiddleware } from "../middleware/auth.js";


const router = express.Router();

const VDG_API_KEY = process.env.VDG_API_KEY;
const VDG_PACKAGE = process.env.VDG_PACKAGE;
const VDG_BASE_URL =
  process.env.VDG_BASE_URL || "https://uk.api.vehicledataglobal.com";

// ====================================================================
// FETCH RAW SPEC FROM VDG
// ====================================================================
async function fetchSpecFromVDG(vrm) {
  const url = `${VDG_BASE_URL}/r2/lookup?ApiKey=${VDG_API_KEY}&PackageName=${VDG_PACKAGE}&Vrm=${vrm}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("VDG API error");

  return res.json();
}

// ====================================================================
// NORMALIZE → CLEAN SPEC DATA FOR STORAGE
// ====================================================================
function normalizeSpec(raw, vrm) {
  const vehicle = raw?.Results?.VehicleDetails;
  const model = raw?.Results?.ModelDetails;

  return {
    vrm,
    make:
      model?.ModelIdentification?.Make ||
      vehicle?.VehicleIdentification?.DvlaMake ||
      null,
    model:
      model?.ModelIdentification?.Range ||
      vehicle?.VehicleIdentification?.DvlaModel ||
      null,
    variant: model?.ModelIdentification?.ModelVariant || null,
    year: vehicle?.VehicleIdentification?.YearOfManufacture || null,

    // Added fields
    country_of_origin: model?.ModelIdentification?.CountryOfOrigin || null,
    generation_mark: model?.ModelIdentification?.Mark || null,

    dvla: {
      body_type: vehicle?.VehicleIdentification?.DvlaBodyType || null,
      fuel_type: vehicle?.VehicleIdentification?.DvlaFuelType || null,
      co2:
        vehicle?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaCo2 || null,
      tax_band:
        vehicle?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaBand || null,
      original_colour:
        raw?.Results?.VehicleHistory?.ColourDetails?.OriginalColour || null,
    },

    engine: {
      capacity_cc: model?.Powertrain?.IceDetails?.EngineCapacityCc || null,
      capacity_litres:
        model?.Powertrain?.IceDetails?.EngineCapacityLitres || null,
      cylinders: model?.Powertrain?.IceDetails?.NumberOfCylinders || null,
      cylinder_arrangement:
        model?.Powertrain?.IceDetails?.CylinderArrangement || null,
      aspiration: model?.Powertrain?.IceDetails?.Aspiration || null,
      valve_gear: model?.Powertrain?.IceDetails?.ValveGear || null,
      valves_per_cylinder:
        model?.Powertrain?.IceDetails?.ValvesPerCylinder || null,
      bore_mm: model?.Powertrain?.IceDetails?.BoreMm || null,
      stroke_mm: model?.Powertrain?.IceDetails?.StrokeMm || null,
      fuel_type: model?.Powertrain?.FuelType || null,
      power_kw: model?.Performance?.Power?.Kw || null,
      power_bhp: model?.Performance?.Power?.Bhp || null,
      torque_nm: model?.Performance?.Torque?.Nm || null,
    },

    body: {
      doors: model?.BodyDetails?.NumberOfDoors || null,
      seats: model?.BodyDetails?.NumberOfSeats || null,
      axles: model?.BodyDetails?.NumberOfAxles || null,
      wheelbase_mm: model?.Dimensions?.WheelbaseLengthMm || null,
      fuel_tank_litres: model?.BodyDetails?.FuelTankCapacityLitres || null,
      driving_axle: model?.Transmission?.DrivingAxle || null,
    },

    dimensions: {
      length_mm: model?.Dimensions?.LengthMm || null,
      width_mm: model?.Dimensions?.WidthMm || null,
      height_mm: model?.Dimensions?.HeightMm || null,
      wheelbase_mm: model?.Dimensions?.WheelbaseLengthMm || null,
    },

    weights: {
      kerb_weight_kg: model?.Weights?.KerbWeightKg || null,
      gross_vehicle_weight_kg:
        model?.Weights?.GrossVehicleWeightKg || null,
      payload_kg: model?.Weights?.PayloadWeightKg || null,
    },

    emissions: {
      euro_status: model?.Emissions?.EuroStatus || null,
    },

    performance: {
      top_speed_kph: model?.Performance?.Statistics?.MaxSpeedKph || null,
      top_speed_mph: model?.Performance?.Statistics?.MaxSpeedMph || null,
      zero_to_60_mph:
        model?.Performance?.Statistics?.ZeroToSixtyMph || null,
      zero_to_100_kph:
        model?.Performance?.Statistics?.ZeroToOneHundredKph || null,
    },

    safety: {
      ncap_star_rating: model?.Safety?.EuroNcap?.NcapStarRating || null,
      ncap_adult_percent: model?.Safety?.EuroNcap?.NcapAdultPercent || null,
      ncap_child_percent: model?.Safety?.EuroNcap?.NcapChildPercent || null,
      ncap_pedestrian_percent:
        model?.Safety?.EuroNcap?.NcapPedestrianPercent || null,
      ncap_safety_assist_percent:
        model?.Safety?.EuroNcap?.NcapSafetyAssistPercent || null,
    },

    transmission: {
      type: model?.Transmission?.TransmissionType || null,
      gears: model?.Transmission?.NumberOfGears || null,
      drive: model?.Transmission?.DriveType || null,
    },

    images: null, // future upgrade
  };
}

// ====================================================================
// UNLOCK SPEC ENDPOINT
// ====================================================================
router.post("/unlock-spec", authenticateToken, async (req, res) => {
  const client = await db.connect();

  try {
    const { vrm } = req.body;
    if (!vrm) return res.status(400).json({ error: "VRM required" });

    const userId = req.user.id;

    await client.query("BEGIN");

    // Load user
    const userRes = await client.query(
      "SELECT premium, premium_until, monthly_unlocks_remaining, last_unlock_reset FROM users WHERE id = $1",
      [userId]
    );
    const user = userRes.rows[0];

    const now = new Date();
    const firstMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const premiumActive =
      user.premium && new Date(user.premium_until) > now;

    // Reset monthly unlocks if new month
    if (
      premiumActive &&
      (!user.last_unlock_reset ||
        new Date(user.last_unlock_reset) < firstMonth)
    ) {
      await client.query(
        "UPDATE users SET monthly_unlocks_remaining = 3, last_unlock_reset = $2 WHERE id = $1",
        [userId, firstMonth]
      );
      user.monthly_unlocks_remaining = 3;
    }

    // Check if already unlocked
    const checkUnlocked = await client.query(
      "SELECT 1 FROM unlocked_specs WHERE user_id = $1 AND vrm = $2",
      [userId, vrm]
    );

    if (checkUnlocked.rows.length > 0) {
      const cached = await client.query(
        "SELECT spec_json FROM vehicle_specs WHERE vrm = $1",
        [vrm]
      );

      await client.query("COMMIT");
      return res.json({
        success: true,
        alreadyUnlocked: true,
        price: 0,
        spec: cached.rows[0]?.spec_json || null,
      });
    }

    // Pricing
    let price = 1.49;
    let freeUsed = false;

    if (premiumActive && user.monthly_unlocks_remaining > 0) {
      price = 0;
      freeUsed = true;
    } else if (premiumActive) {
      price = parseFloat((1.49 * 0.75).toFixed(2)); // 25% off
    }

    if (freeUsed) {
      await client.query(
        "UPDATE users SET monthly_unlocks_remaining = monthly_unlocks_remaining - 1 WHERE id = $1",
        [userId]
      );
    }

    // Fetch live VDG spec
    const raw = await fetchSpecFromVDG(vrm);
    const clean = normalizeSpec(raw, vrm);

    // Store or update spec
    await client.query(
      `INSERT INTO vehicle_specs (vrm, spec_json)
       VALUES ($1, $2)
       ON CONFLICT (vrm) DO UPDATE SET spec_json = $2, updated_at = NOW()`,
      [vrm, clean]
    );

    // Mark as unlocked
    await client.query(
      "INSERT INTO unlocked_specs (user_id, vrm) VALUES ($1, $2)",
      [userId, vrm]
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      alreadyUnlocked: false,
      price,
      freeUsed,
      spec: clean,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Unlock spec error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

export default router;
