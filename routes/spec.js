import express from "express";
import { authRequired } from "../middleware/auth.js";
import { query } from "../db/db.js";
import axios from "axios";

const router = express.Router();

const ENABLE_IMAGES = false;


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

  const model = apiResults?.ModelDetails || {};
  const mId = model.ModelIdentification || {};
  const dims = model.Dimensions || {};
  const weights = model.Weights || {};
  const body = model.BodyDetails || {};
  const colour = apiResults?.VehicleHistory?.ColourDetails || {};

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
  const transmission = powertrain?.Transmission || {};

  let clean = {
	_meta: {
      generated_at: new Date().toISOString(),
      spec_version: 2
    },
	
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
      country_of_origin: mId.CountryOfOrigin,
      original_colour: colour?.OriginalColour,
      cab_type: body?.CabType
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
      engine_description: ice?.EngineDescription,
      engine_code: ice?.EngineCode || vTech?.EngineCode
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
	  wheelbase_mm: dims?.WheelbaseLengthMm,
	  internal_load_length_mm: dims?.InternalLoadLengthMm,
	  payload_volume_litres: dims?.PayloadVolumeLitres || dims?.LoadVolumeLitres
	},

	weights: {
	  kerb_weight_kg: weights?.KerbWeightKg,
	  unladen_weight_kg: weights?.UnladenWeightKg,
	  mass_in_service_kg: vTech?.MassInServiceKg,
	  gross_vehicle_weight_kg: weights?.GrossVehicleWeightKg,
	  gross_train_weight_kg: weights?.GrossTrainWeightKg,
	  gross_combined_weight_kg: weights?.GrossCombinedWeightKg,
	  payload_kg:
		weights?.PayloadWeightKg ??
		(weights?.GrossVehicleWeightKg && vTech?.MassInServiceKg
		  ? weights.GrossVehicleWeightKg - vTech.MassInServiceKg
		  : null)
	},


    drivetrain: {
      drive_type: transmission?.DriveType,
      driving_axle: transmission?.DrivingAxle
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

  // -------------------------
  // TOWING
  // -------------------------
  if (
    weights?.GrossTrainWeightKg ||
    weights?.MaxBrakedTrailerWeightKg ||
    weights?.MaxUnbrakedTrailerWeightKg ||
    weights?.GrossCombinedWeightKg
  ) {
    clean.towing = {
      max_braked_kg: weights?.MaxBrakedTrailerWeightKg ?? 0,
      max_unbraked_kg: weights?.MaxUnbrakedTrailerWeightKg ?? 0,
      gross_train_weight_kg: weights?.GrossTrainWeightKg ?? null,
      gross_combined_weight_kg: weights?.GrossCombinedWeightKg ?? null,
      max_nose_weight_kg: weights?.MaxNoseWeightKg ?? null,
      towbar_approved: (weights?.MaxBrakedTrailerWeightKg ?? 0) > 0
    };
  }
// -------------------------
// ELECTRIC VEHICLE
// -------------------------
const hasEvData =
  powertrain?.EvDetails ||
  powertrain?.EvDetails?.BatteryDetailsList?.length > 0;

if (hasEvData) {
  const ev = powertrain.EvDetails || {};

  const battery = ev.BatteryDetailsList?.[0] || {};
  const motor = ev.MotorDetailsList?.[0] || {};
  const port = ev.ChargePortDetailsList?.[0] || {};

  clean.ev = {
    powertrain_type: ev.TechnicalDetails?.PowertrainType ?? "BEV",

    efficiency: {
      wh_per_mile: performance?.WhMile ?? null,
      real_range_miles: performance?.RangeFigures?.RealRangeMiles ?? null,
      real_range_km: performance?.RangeFigures?.RealRangeKm ?? null,
    },

    battery: {
      total_kwh: battery.TotalCapacityKwh ?? null,
      usable_kwh: battery.UsableCapacityKwh ?? null,
      chemistry: battery.Chemistry ?? null,
      voltage: battery.Voltage ?? null,
      location: battery.LocationOnVehicle ?? null,
      warranty_months: battery.ManufacturerWarrantyMonths ?? null,
      warranty_miles: battery.ManufacturerWarrantyMiles ?? null,
    },

    charging: {
      ac_kw: port.MaxChargePowerKw ?? null,
      dc_kw: ev.Performance?.MaxChargeInputPowerKw ?? null,
      port_type: port.PortType ?? null,
      port_location: port.LocationOnVehicle ?? null,
      avg_10_to_80_mins:
        port.ChargeTimes?.AverageChargeTimes10To80Percent?.[0]?.TimeInMinutes ??
        null,
    },

    motor: {
      power_kw: motor.PowerKw ?? null,
      torque_nm: motor.MaxTorqueNm ?? null,
      location: motor.MotorLocation ?? null,
      axle: motor.AxleDrivenByMotor ?? null,
      regen: motor.SupportsRegenerativeBraking ?? null,
    },
  };
}



// -------------------------
// HYBRID (PHEV / HEV / MHEV)
// -------------------------
if (
  powertrain?.Type === "PHEV" ||
  powertrain?.Type === "HEV" ||
  powertrain?.Type === "MHEV"
) {
  const battery = powertrain?.BatteryDetails || {};
  const range = powertrain?.RangeDetails || {};

  clean.hybrid = {
    powertrain_type: powertrain.Type,
    hybrid_type: powertrain.Type,
    battery_kwh: battery?.TotalCapacityKwh,
    ev_range_miles: range?.ElectricOnlyMiles
  };
}


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
// UNLOCK SPEC ROUTE (AUTHORITATIVE VERSION)
// ------------------------------------------------------------
router.post("/unlock-spec", authRequired, async (req, res) => {
  const client = await query("BEGIN").catch(() => null);

  try {
    const { vrm } = req.body;
    if (!vrm) return res.status(400).json({ error: "VRM required" });

    const vrmUpper = vrm.toUpperCase();
    const user = req.user;
    const user_id = user.id;

    // --------------------------------------------------
    // STEP 1: Already unlocked? (DB is authority)
    // --------------------------------------------------
    const alreadyUnlocked = await query(
      `SELECT 1 FROM unlocked_specs WHERE user_id=$1 AND vrm=$2`,
      [user_id, vrmUpper]
    );

    if (alreadyUnlocked.rowCount > 0) {
      const cached = await query(
        `SELECT spec_json FROM vehicle_specs WHERE vrm=$1`,
        [vrmUpper]
      );

      const spec =
        cached.rowCount > 0
          ? cached.rows[0].spec_json
          : await fetchSpecDataFromAPI(vrmUpper);

      return res.json({
        success: true,
        alreadyUnlocked: true,
        price: 0,
        saved: true,
        spec
      });
    }

    // --------------------------------------------------
    // STEP 2: Fetch user state
    // --------------------------------------------------
    const userRow = await query(
      `SELECT premium, premium_until, monthly_unlocks_used
       FROM users WHERE id=$1 FOR UPDATE`,
      [user_id]
    );

    const u = userRow.rows[0];
    const isPremium =
      u.premium &&
      (!u.premium_until || new Date(u.premium_until) > new Date());

    let price = 1.49;
    let remainingFreeUnlocks = null;

    if (isPremium) {
      const remaining = Math.max(3 - u.monthly_unlocks_used, 0);
      remainingFreeUnlocks = remaining;

      if (remaining === 0) {
        price = Number((1.49 * 0.75).toFixed(2));
      }
    }

    // --------------------------------------------------
    // STEP 3: Fetch spec
    // --------------------------------------------------
    let cached = await query(
      `SELECT spec_json FROM vehicle_specs WHERE vrm=$1`,
      [vrmUpper]
    );

    let spec =
      cached.rowCount > 0
        ? cached.rows[0].spec_json
        : await fetchSpecDataFromAPI(vrmUpper);
	console.log("──────── VEHICLE SPEC DEBUG ────────");
    console.log("VRM:", vrmUpper);
	console.log("SPEC SOURCE:", cached.rowCount > 0 ? "DATABASE" : "API");
	console.log("TOP LEVEL KEYS:", Object.keys(spec || {}));
	console.log("HAS TOWING:", !!spec?.towing, spec?.towing);
	console.log("HAS EV:", !!spec?.ev, spec?.ev);
	console.log("SPEC VERSION:", spec?._meta?.spec_version);
	console.log("────────────────────────────────────");


    if (!spec) {
      await query("ROLLBACK");
      return res.status(404).json({ error: "Vehicle spec not found" });
    }

    // --------------------------------------------------
    // STEP 4: Persist unlock FIRST
    // --------------------------------------------------
    const unlockInsert = await query(
      `INSERT INTO unlocked_specs (user_id, vrm)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING 1`,
      [user_id, vrmUpper]
    );

    // If insert failed, abort (safety net)
    if (unlockInsert.rowCount === 0) {
      await query("ROLLBACK");
      return res.status(409).json({ error: "Unlock already exists" });
    }

    // --------------------------------------------------
    // STEP 5: Increment usage ONLY AFTER successful insert
    // --------------------------------------------------
    if (isPremium && remainingFreeUnlocks > 0) {
      await query(
        `UPDATE users
         SET monthly_unlocks_used = monthly_unlocks_used + 1
         WHERE id=$1`,
        [user_id]
      );
    }

    // --------------------------------------------------
    // STEP 6: Cache spec
    // --------------------------------------------------
    await query(
      `INSERT INTO vehicle_specs (vrm, spec_json)
       VALUES ($1, $2)
       ON CONFLICT (vrm)
       DO UPDATE SET spec_json=$2, updated_at=NOW()`,
      [vrmUpper, spec]
    );

    await query("COMMIT");

    return res.json({
      success: true,
      price,
      isPremium,
      remainingFreeUnlocks:
        remainingFreeUnlocks !== null
          ? Math.max(remainingFreeUnlocks - 1, 0)
          : null,
      saved: true,
      spec
    });

  } catch (err) {
    await query("ROLLBACK");
    console.error("UNLOCK SPEC ERROR:", err);
    res.status(500).json({ error: "Failed to unlock spec" });
  }
});



/**
 * POST /api/spec/unlock
 * body: { vehicle_id }
 * auth: required
 */



export default router;
