
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
export function buildCleanSpec(apiResults) {
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
  console.log("POWERTRAIN KEYS:", Object.keys(powertrain));
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
	  model_range: mId.Range,
	  series: mId.Series,
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
      engine_code: ice?.EngineCode || vTech?.EngineCode,
	  engine_number: ice?.EngineNumber || vTech?.EngineNumber
    },
	
	transmission: {
	  type: transmission?.TransmissionType,
	  gears: transmission?.NumberOfGears,
	  drive_type: transmission?.DriveType,
	  driving_axle: transmission?.DrivingAxle
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
// ELECTRIC VEHICLE (EV)
// -------------------------
const ev = powertrain?.EvDetails;

if (ev) {
  const tech = ev.TechnicalDetails || {};
  const perf = ev.Performance || {};

  const battery = tech.BatteryDetailsList?.[0] || {};
  const motor = tech.MotorDetailsList?.[0] || {};
  const port = tech.ChargePortDetailsList?.[0] || {};

  clean.ev = {
    powertrain_type: tech.PowertrainType ?? "BEV",

    efficiency: {
      wh_per_mile: perf.WhMile ?? null,
      real_range_miles: perf.RangeFigures?.RealRangeMiles ?? null,
      real_range_km: perf.RangeFigures?.RealRangeKm ?? null
    },

    battery: {
      total_kwh: battery.TotalCapacityKwh ?? null,
      usable_kwh: battery.UsableCapacityKwh ?? null,
      chemistry: battery.Chemistry ?? null,
      voltage: battery.Voltage ?? null,
      location: battery.LocationOnVehicle ?? null,
      warranty_months: battery.ManufacturerWarrantyMonths ?? null,
      warranty_miles: battery.ManufacturerWarrantyMiles ?? null
    },

    charging: {
      ac_kw: port.MaxChargePowerKw ?? null,
      dc_kw: perf.MaxChargeInputPowerKw ?? null,
      port_type: port.PortType ?? null,
      port_location: port.LocationOnVehicle ?? null,
      avg_10_to_80_mins:
        port.ChargePortDetailsList?.[0]?.TimeInMinutes ??
        null
    },

    motor: {
      power_kw: motor.PowerKw ?? null,
      torque_nm: motor.MaxTorqueNm ?? null,
      location: motor.MotorLocation ?? null,
      axle: motor.AxleDrivenByMotor ?? null,
      regen: motor.SupportsRegenerativeBraking ?? null
    }
  };

  // -------------------------
  // FLAT EV FIELDS (UI CONTRACT)
  // -------------------------
  clean.ev = {
    ...clean.ev,

    battery_chemistry: clean.ev.battery.chemistry,
    battery_total_kwh: clean.ev.battery.total_kwh,
    battery_usable_kwh: clean.ev.battery.usable_kwh,
    battery_warranty_years: clean.ev.battery.warranty_months
      ? Math.round(clean.ev.battery.warranty_months / 12)
      : null,
    battery_warranty_miles: clean.ev.battery.warranty_miles,

    wltp_range_miles: clean.ev.efficiency.real_range_miles,
    wltp_range_km: clean.ev.efficiency.real_range_km,
    wh_per_mile: clean.ev.efficiency.wh_per_mile,
	
	miles_per_kwh: clean.ev.efficiency.wh_per_mile
      ? Number((1000 / clean.ev.efficiency.wh_per_mile).toFixed(2))
      : null,

    ac_charge_kw: clean.ev.charging.ac_kw,
    dc_charge_kw: clean.ev.charging.dc_kw,
    charge_10_80_min: clean.ev.charging.avg_10_to_80_mins,

    motor_type: clean.ev.motor.power_kw ? "Electric Motor" : null,
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

