import express from "express";
import { authRequired, optionalAuth } from "../middleware/auth.js";
import { query, withTransaction } from "../db/db.js";
import axios from "axios";
import { unlockSpec } from "../services/unlockSpec.js";

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
// REMOVE NULLS FROM OUTPUT
// ------------------------------------------------------------

// ==================================
// PROVIDER RETRY HELPERS
// ==================================

function nextWeeklyRetryDate() {
  // simple: retry in 7 days
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

export function buildFingerprint(spec) {
  const id = spec?.identity;
  if (!id) return null;

  const parts = [
    id.make,
    id.model,
    id.monthOfFirstRegistration,
    id.engineCapacity,
    id.fuelType,
    id.bodyStyle, // (yours is wheelplan currently)
  ]
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
    .map((v) => String(v).trim().toLowerCase());

  if (parts.length < 3) return null;
  return parts.join("|");
}



// ------------------------------------------------------------
// CLEAN SPEC BUILDER (STATIC DATA ONLY)
// Includes MPG, L/100km + Sound Levels
// ------------------------------------------------------------
export function buildCleanSpec(apiResults) {
  const vd = apiResults?.VehicleDetails || {};
  const vId = vd.VehicleIdentification || {};
  const vTech = vd.DvlaTechnicalDetails || {};
  const vCodes = apiResults?.VehicleCodes || {};
console.log("🧬 VehicleCodes payload:", vCodes);

  const model = apiResults?.ModelDetails || {};
  const mId = model.ModelIdentification || {};
  const classification = model.ModelClassification || {};
  const bodyDetails = model.BodyDetails || {};
  const powertrainType = model.Powertrain?.PowertrainType || null;

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
  console.log("POWERTRAIN KEYS:", Object.keys(powertrain));
  const ice = powertrain?.IceDetails || {};
  const transmission = powertrain?.Transmission || {};
  
  // -------------------------
// IDENTITY FALLBACK LOGIC
// -------------------------

const dvlaModel = vId?.DvlaModel ?? null;
const structuredModel =
  mId?.Model && mId.Model.trim() !== ""
    ? mId.Model
    : null;
const structuredRange = mId?.Range ?? null;

// Prefer structured model, fallback to DVLA
let finalModel = structuredModel || dvlaModel;

// Clean duplication if DVLA model contains range name
if (
  structuredRange &&
  dvlaModel &&
  dvlaModel.toLowerCase().startsWith(structuredRange.toLowerCase())
) {
  finalModel = dvlaModel.substring(structuredRange.length).trim();
}

  let clean = {
	_meta: {
      generated_at: new Date().toISOString(),
      spec_version: 3
    },
	
	identity: {
	  vrm: vId.Vrm,
	  make: mId.Make || vId.DvlaMake,
	  range: structuredRange ?? null,
	  model: finalModel ?? null,
	  variant: mId.ModelVariant,
	  generation: mId.Mark,
	  series: mId.Series,
	  production_start: mId.StartDate,
	  production_end: mId.EndDate,
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
	
	platform: {
	  name: body?.PlatformName,
	  shared_across_models: body?.PlatformIsSharedAcrossModels
	},

	
	codes: {
	  uvc: vCodes?.Uvc ?? null,
	  low_emissions_compliance: vCodes?.LowEmissionsCompliance ?? null
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
	  engine_manufacturer: ice?.EngineManufacturer,
      engine_family: ice?.EngineFamily ?? null,
      engine_code:
	    vCodes?.EngineCode ??
	    ice?.EngineCode ??
	    vTech?.EngineCode ??
	    null,
	  engine_number: ice?.EngineNumber || vTech?.EngineNumber
    },

	performance: {
	  bhp: power?.Bhp,
	  ps: power?.Ps,
	  kw: power?.Kw,
	  power_rpm: power?.Rpm,
	  torque_nm: torque?.Nm,
	  torque_lbft: torque?.LbFt,
	  torque_rpm: torque?.Rpm,
	  zero_to_60_mph: stats?.ZeroToSixtyMph,
	  zero_to_100_kph: stats?.ZeroToOneHundredKph,
	  top_speed_mph: stats?.MaxSpeedMph,
	  top_speed_kph: stats?.MaxSpeedKph
	},

	fuel: {
	  type: vId.DvlaFuelType || powertrain.FuelType,
	  tank_capacity_litres: body?.FuelTankCapacityLitres,
	  economy: {
		urban_mpg: fuelEconomy?.UrbanColdMpg,
		extra_urban_mpg: fuelEconomy?.ExtraUrbanMpg,
		combined_mpg: fuelEconomy?.CombinedMpg,
		urban_l_100km: fuelEconomy?.UrbanColdL100Km,
		extra_urban_l_100km: fuelEconomy?.ExtraUrbanL100Km,
		combined_l_100km: fuelEconomy?.CombinedL100Km
	  }
	},
	powertrain_type: powertrainType,


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
	
	transmission: {
	  type: transmission?.TransmissionType,
	  gear_count: transmission?.NumberOfGears
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
// TOWING (Weights + DVLA fallback)
// -------------------------
const maxBraked =
  weights?.MaxBrakedTrailerWeightKg ??
  vTech?.MaxPermissibleBrakedTrailerMassKg ??
  0;

const maxUnbraked =
  weights?.MaxUnbrakedTrailerWeightKg ??
  vTech?.MaxPermissibleUnbrakedTrailerMassKg ??
  0;

if (
  weights?.GrossTrainWeightKg ||
  weights?.GrossCombinedWeightKg ||
  maxBraked > 0 ||
  maxUnbraked > 0
) {
  clean.towing = {
    max_braked_kg: maxBraked,
    max_unbraked_kg: maxUnbraked,
    gross_train_weight_kg:
      weights?.GrossTrainWeightKg ?? null,
    gross_combined_weight_kg:
      weights?.GrossCombinedWeightKg ?? null,
    max_nose_weight_kg:
      weights?.MaxNoseWeightKg ?? null,
    towbar_approved: maxBraked > 0
  };
}


// -------------------------
// FULL HYBRID (FHEV - Self Charging)
// -------------------------
if (powertrainType === "FHEV") {
  clean.hybrid = {
    powertrain_type: "FHEV",
    hybrid_type: "Full Hybrid (Self Charging)",
    external_charging: false
  };
}
// -------------------------
// ELECTRIC VEHICLE (EV)
// -------------------------
const ev = powertrain?.EvDetails;

if (ev) {
  const tech = ev.TechnicalDetails || {};
  const perf = ev.Performance || {};
  const transmission = powertrain?.Transmission || {};

  const batteries = tech.BatteryDetailsList || [];
  const battery = batteries[0] || {};

  const motors = tech.MotorDetailsList || [];
  const primaryMotor =
    motors.find(m => (m?.PowerKw ?? 0) > 0) || motors[0] || {};

  const ports = Array.isArray(tech.ChargePortDetailsList)
    ? tech.ChargePortDetailsList
    : [];

  const acPort =
    ports.find(p => `${p?.PortType || ""}`.toUpperCase().includes("TYPE"))
    || ports.find(p => (p?.MaxChargePowerKw ?? 0) <= 22)
    || null;

  const dcPort =
    ports.find(p => `${p?.PortType || ""}`.toUpperCase().includes("CCS"))
    || ports.find(p => (p?.MaxChargePowerKw ?? 0) >= 50)
    || null;

  // WLTP extraction
  const wltp = perf.RangeFigures?.RangeTestCycleList?.find(
    r => r?.EvRangeTestType === "WLTP"
  );

  // Smart 10–80 selection
  const pick1080TimeMins = (port) => {
    const list =
      port?.ChargeTimes?.AverageChargeTimes10To80Percent || [];

    if (!Array.isArray(list) || list.length === 0) return null;

    const maxKw =
      port?.MaxChargePowerKw != null
        ? Number(port.MaxChargePowerKw)
        : null;

    if (maxKw) {
      const candidates = list
        .filter(x =>
          x?.TimeInMinutes != null &&
          Number(x?.ChargePortKw) <= maxKw
        )
        .sort((a, b) =>
          Number(b.ChargePortKw) - Number(a.ChargePortKw)
        );

      if (candidates.length) {
        return Number(candidates[0].TimeInMinutes);
      }
    }

    const times = list
      .map(x =>
        x?.TimeInMinutes != null
          ? Number(x.TimeInMinutes)
          : null
      )
      .filter(v => typeof v === "number" && v > 0);

    return times.length ? Math.min(...times) : null;
  };

  const acKw =
    acPort?.MaxChargePowerKw != null
      ? Number(acPort.MaxChargePowerKw)
      : null;

  const dcKw =
    perf?.MaxChargeInputPowerKw
      ?? (dcPort?.MaxChargePowerKw != null
          ? Number(dcPort.MaxChargePowerKw)
          : null);

  const avg1080 =
    pick1080TimeMins(dcPort)
    ?? pick1080TimeMins(acPort)
    ?? null;

  const teslaSupercharging = tech.TeslaSupercharging || {};

  clean.ev = {
    powertrain_type: tech.PowertrainType ?? "BEV",

    efficiency: {
      wh_per_mile: perf.WhMile ?? null,
      real_range_miles:
        perf.RangeFigures?.RealRangeMiles ?? null,
      real_range_km:
        perf.RangeFigures?.RealRangeKm ?? null,
      zero_emission_miles:
        perf.RangeFigures?.ZeroEmissionMiles ?? null,
      wltp_range_miles:
        wltp?.CombinedRangeMiles ?? null,
      wltp_range_km:
        wltp?.CombinedRangeKm ?? null
    },

    battery: {
      total_kwh: battery.TotalCapacityKwh ?? null,
      usable_kwh:
        battery.UsableCapacityKwh
        ?? battery.UsableKwh
        ?? null,
      chemistry: battery.Chemistry ?? null,
      voltage:
        battery.Voltage != null && Number(battery.Voltage) > 0
          ? Number(battery.Voltage)
          : null,
      location: battery.LocationOnVehicle ?? null,
      warranty_months:
        battery.ManufacturerWarrantyMonths ?? null,
      warranty_miles:
        battery.ManufacturerWarrantyMiles ?? null
    },

    charging: {
      ac_kw: acKw,
      dc_kw: dcKw,
      ac_port_type: acPort?.PortType ?? null,
      dc_port_type: dcPort?.PortType ?? null,
      ac_port_location: acPort?.LocationOnVehicle ?? null,
      dc_port_location: dcPort?.LocationOnVehicle ?? null,
      avg_10_to_80_mins: avg1080
    },

    motor: {
      power_kw: primaryMotor.PowerKw ?? null,
      torque_nm: primaryMotor.MaxTorqueNm ?? null,
      location: primaryMotor.MotorLocation ?? null,
      axle:
        primaryMotor.AxleDrivenByMotor
        ?? transmission?.DrivingAxle
        ?? null,
      regen: primaryMotor.SupportsRegenerativeBraking ?? null,
      motor_type: primaryMotor.MotorType ?? null
    },

    supercharging: {
      is_tesla_compatible:
        tech.IsTeslaSuperchargerCompatible ?? false,
      v2_max_kw:
        teslaSupercharging.Version2?.MaxChargeKw ?? null,
      v2_10_80_min:
        teslaSupercharging.Version2?.AverageChargeTime10To80Percent ?? null,
      v3_max_kw:
        teslaSupercharging.Version3?.MaxChargeKw ?? null,
      v3_10_80_min:
        teslaSupercharging.Version3?.AverageChargeTime10To80Percent ?? null
    },

    supports_ota:
      model?.AdditionalInformation?.Software?.SupportsOverTheAirSoftwareUpdate ?? null
  };

  // ---- Flat fields for UI contract ----

  clean.ev = {
    ...clean.ev,

    battery_chemistry: clean.ev.battery.chemistry,
    battery_total_kwh: clean.ev.battery.total_kwh,
    battery_usable_kwh: clean.ev.battery.usable_kwh,
    battery_warranty_years:
      clean.ev.battery.warranty_months
        ? Math.round(clean.ev.battery.warranty_months / 12)
        : null,
    battery_warranty_miles:
      clean.ev.battery.warranty_miles,

    wltp_range_miles:
      clean.ev.efficiency.wltp_range_miles
      ?? clean.ev.efficiency.real_range_miles
      ?? clean.ev.efficiency.zero_emission_miles
      ?? null,

    wh_per_mile:
      clean.ev.efficiency.wh_per_mile,

    miles_per_kwh:
      clean.ev.efficiency.wh_per_mile
        ? Number(
            (1000 / clean.ev.efficiency.wh_per_mile).toFixed(2)
          )
        : null,

    ac_charge_kw: clean.ev.charging.ac_kw,
    dc_charge_kw: clean.ev.charging.dc_kw,
    charge_10_80_min:
      clean.ev.charging.avg_10_to_80_mins,

    motor_location: clean.ev.motor.location,
    axle_driven_by_motor: clean.ev.motor.axle
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

  // Provider status code (defensive lookup)
  const statusCode =
    data?.StatusCode ??
    data?.statusCode ??
    data?.Header?.StatusCode ??
    data?.Header?.statusCode ??
    null;

  const hasVehicleDetails = !!data?.Results?.VehicleDetails;

  // Build spec ONLY if vehicle details exist
  let cleanSpec = null;

  if (hasVehicleDetails) {
    cleanSpec = buildCleanSpec(data.Results);
    cleanSpec.images = await fetchImagesFromVDG(vrm);
  }

  return {
    spec: cleanSpec,
    statusCode
  };
}


/**
 * POST /api/spec/unlock
 * body: { vehicle_id }
 * auth: required
 */
 
router.get("/spec", optionalAuth, async (req, res) => {
  try {
    const vrm = req.query.vrm?.toUpperCase();
    if (!vrm) {
      return res.status(400).json({ error: "VRM required" });
    }

    const userId = req.user?.id ?? null;
    const guestId =
      req.guestId ??
      req.query.guestId ??
      null;

    if (!userId && !guestId) {
      return res.status(401).json({ error: "Not authorised" });
    }

    // --------------------------------------------------
    // 1️⃣ Load DVLA core identity from cache
    // --------------------------------------------------

    const dvlaRow = await query(
      `
      SELECT dvla_json
      FROM dvla_lookup_cache
      WHERE vrm = $1
      `,
      [vrm]
    );

    if (dvlaRow.rowCount === 0) {
      return res.status(400).json({ error: "DVLA data not found" });
    }

    const dvla = dvlaRow.rows[0].dvla_json;

    const coreIdentity = {
      identity: {
        make: dvla.make ?? null,
        monthOfFirstRegistration: dvla.monthOfFirstRegistration ?? null,
        engineCapacity:
          dvla.engineCapacity !== undefined
            ? Number(dvla.engineCapacity)
            : null,
        fuelType: dvla.fuelType ?? null,
        bodyStyle: dvla.wheelplan ?? null,
      },
    };

    const currentFingerprint = buildFingerprint(coreIdentity);

    // --------------------------------------------------
    // 2️⃣ Fetch unlocked snapshot matching fingerprint
    // --------------------------------------------------

    const result = await query(
      `
      SELECT vss.spec_json, vss.engine_code, vss.tyre_data
      FROM unlocked_specs us
      JOIN vehicle_spec_snapshots vss
        ON vss.id = us.snapshot_id
      WHERE us.vrm = $1
	    AND us.revoked_at IS NULL
        AND vss.fingerprint = $2
        AND (
          ($3::uuid IS NOT NULL AND us.user_id = $3)
          OR
          ($4::text IS NOT NULL AND us.guest_id = $4)
        )
      LIMIT 1
      `,
      [vrm, currentFingerprint, userId, guestId]
    );

    if (result.rowCount === 0) {
      return res.status(403).json({ error: "Spec not unlocked" });
    }

    return res.json({
      ...result.rows[0].spec_json,
      engineCode: result.rows[0].engine_code,
      tyres: result.rows[0].tyre_data,
    });

  } catch (err) {
    console.error("❌ FETCH SPEC ERROR:", err);
    return res.status(500).json({ error: "Failed to fetch spec" });
  }
});



// ------------------------------------------------------------
// RESTORE UNLOCKED SPECS (READ-ONLY)
// ------------------------------------------------------------
router.get("/spec/unlocked", optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    const guestId = req.guestId ?? null;

    // No identity → nothing to restore
    if (!userId && !guestId) {
      return res.json([]);
    }

    const result = await query(
	  `
	  SELECT 
	    us.vrm,
	    us.unlocked_at,
	   vss.created_at,
	    vss.spec_json,
	    vss.engine_code,
	    vss.tyre_data
	  FROM unlocked_specs us
	  JOIN vehicle_spec_snapshots vss
		ON vss.id = us.snapshot_id
	  WHERE
		(
		  ($1::uuid IS NOT NULL AND us.user_id = $1)
		  OR
		  ($2::text IS NOT NULL AND us.guest_id = $2::text)
		)
		AND us.revoked_at IS NULL
	  ORDER BY us.unlocked_at DESC
	  `,
	  [userId, guestId]
	);

	return res.json(
	  result.rows.map(row => ({
		reg: row.vrm,
		unlockedAt: row.unlocked_at,
		spec: {
		  ...row.spec_json,
		  engineCode: row.engine_code,
		  tyres: row.tyre_data,
		},
	  }))
	);
  } catch (err) {
    console.error("❌ SPEC RESTORE ERROR:", err);
    return res.status(500).json({
      error: "Failed to restore unlocked specs",
    });
  }
});


router.get("/spec/status", optionalAuth, async (req, res) => {
  const vrm = req.query.vrm?.toUpperCase();
  if (!vrm) return res.status(400).json({ error: "VRM required" });

  const result = await query(
    `
    SELECT status_code, retry_after
    FROM vrm_provider_status
    WHERE vrm = $1
    `,
    [vrm]
  );

  if (result.rowCount === 0) {
    return res.json({ blocked: false });
  }

  const row = result.rows[0];

  if (
    row.status_code?.toLowerCase().includes("retention") &&
    new Date(row.retry_after) > new Date()
  ) {
    return res.json({
      blocked: true,
      reason: "RETENTION",
      retryAfter: row.retry_after,
    });
  }

  return res.json({ blocked: false });
});



export default router;
