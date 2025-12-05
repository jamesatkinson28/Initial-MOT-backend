import express from "express";
import fetch from "node-fetch";
import pool from "../db/db.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

// -------------------------------------------
//   Normalize VDG Raw Response
// -------------------------------------------
function normalizeSpec(raw, vrm) {
    const rd = raw?.Results?.VehicleDetails;
    const md = raw?.Results?.ModelDetails;

    return {
        vrm: vrm.toUpperCase(),

        make: md?.ModelIdentification?.Make || rd?.VehicleIdentification?.DvlaMake || null,
        model: md?.ModelIdentification?.Range || rd?.VehicleIdentification?.DvlaModel || null,
        variant: md?.ModelIdentification?.ModelVariant || null,
        year: rd?.VehicleIdentification?.YearOfManufacture || null,

        // New additions
        country_of_origin: md?.ModelIdentification?.CountryOfOrigin || null,
        mark: md?.ModelIdentification?.Mark || null,

        dvla: {
            body_type: rd?.VehicleIdentification?.DvlaBodyType || null,
            fuel_type: rd?.VehicleIdentification?.DvlaFuelType || null,
            co2: rd?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaCo2 || null,
            tax_band: rd?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaBand || null,
            original_colour: raw?.Results?.VehicleHistory?.ColourDetails?.OriginalColour || null
        },

        engine: {
            cylinders: md?.Powertrain?.IceDetails?.NumberOfCylinders || null,
            capacity_cc: md?.Powertrain?.IceDetails?.EngineCapacityCc || null,
            capacity_litres: md?.Powertrain?.IceDetails?.EngineCapacityLitres || null,
            power_kw: md?.DvlaTechnicalDetails?.MaxNetPowerKw || md?.Powertrain?.Power?.Kw || null,
            power_bhp: md?.Powertrain?.Power?.Bhp || null,
            torque_nm: md?.Powertrain?.Performance?.Torque?.Nm || null,
            aspiration: md?.Powertrain?.IceDetails?.Aspiration || null,
            valve_gear: md?.Powertrain?.IceDetails?.ValveGear || null,
            valves_per_cylinder: md?.Powertrain?.IceDetails?.ValvesPerCylinder || null,
            bore_mm: md?.Powertrain?.IceDetails?.BoreMm || null,
            stroke_mm: md?.Powertrain?.IceDetails?.StrokeMm || null,
            cylinder_arrangement: md?.Powertrain?.IceDetails?.CylinderArrangement || null,
            fuel_type: rd?.VehicleIdentification?.DvlaFuelType || null
        },

        transmission: {
            type: md?.Powertrain?.Transmission?.TransmissionType || null,
            drive: md?.Powertrain?.Transmission?.DriveType || null,
            gears: md?.Powertrain?.Transmission?.NumberOfGears || null
        },

        body: {
            axles: md?.BodyDetails?.NumberOfAxles || null,
            doors: md?.BodyDetails?.NumberOfDoors || null,
            seats: md?.BodyDetails?.NumberOfSeats || null,
            fuel_tank_litres: md?.BodyDetails?.FuelTankCapacityLitres || null,
            driving_axle: md?.Powertrain?.Transmission?.DrivingAxle || null
        },

        weights: {
            kerb_weight_kg: md?.Weights?.KerbWeightKg || null,
            gross_vehicle_weight_kg: md?.Weights?.GrossVehicleWeightKg || null,
            payload_kg: md?.Weights?.PayloadWeightKg || null
        },

        dimensions: {
            height_mm: md?.Dimensions?.HeightMm || null,
            width_mm: md?.Dimensions?.WidthMm || null,
            length_mm: md?.Dimensions?.LengthMm || null,
            wheelbase_mm: md?.Dimensions?.WheelbaseLengthMm || null
        },

        performance: {
            top_speed_kph: md?.Performance?.Statistics?.MaxSpeedKph || null,
            top_speed_mph: md?.Performance?.Statistics?.MaxSpeedMph || null,
            zero_to_60_mph: md?.Performance?.Statistics?.ZeroToSixtyMph || null,
            zero_to_100_kph: md?.Performance?.Statistics?.ZeroToOneHundredKph || null
        },

        emissions: {
            euro_status: md?.Emissions?.EuroStatus || null
        },

        safety: {
            ncap_star_rating: md?.Safety?.EuroNcap?.NcapStarRating || null,
            ncap_adult_percent: md?.Safety?.EuroNcap?.NcapAdultPercent || null,
            ncap_child_percent: md?.Safety?.EuroNcap?.NcapChildPercent || null,
            ncap_pedestrian_percent: md?.Safety?.EuroNcap?.NcapPedestrianPercent || null,
            ncap_safety_assist_percent: md?.Safety?.EuroNcap?.NcapSafetyAssistPercent || null
        },

        images: null // reserved for future upgrade (5p additional tier)
    };
}

// -------------------------------------------
//   Unlock & Fetch Spec
// -------------------------------------------
router.get("/:vrm", authMiddleware, async (req, res) => {
    const userId = req.user.id;
    const vrm = req.params.vrm.toUpperCase();

    try {
        // Check if unlocked already
        const existing = await pool.query(
            `SELECT spec_json FROM unlocked_specs WHERE user_id = $1 AND vrm = $2`,
            [userId, vrm]
        );

        if (existing.rows.length > 0) {
            return res.json({
                success: true,
                price: 0,
                alreadyUnlocked: true,
                spec: existing.rows[0].spec_json
            });
        }

        // Fetch fresh data from VDG
        const url = `${process.env.SPEC_API_URL}/r2/lookup?ApiKey=${process.env.SPEC_API_KEY}&PackageName=${process.env.SPEC_PACKAGE_NAME}&Vrm=${vrm}`;

        const response = await fetch(url);
        const raw = await response.json();

        if (!raw?.Results?.VehicleDetails) {
            return res.status(404).json({ error: "Spec not found for this VRM" });
        }

        const spec = normalizeSpec(raw, vrm);

        // Save spec + preview
        await pool.query(
            `INSERT INTO unlocked_specs (user_id, vrm, spec_json, preview_json)
             VALUES ($1, $2, $3, $4)`,
            [
                userId,
                vrm,
                spec,
                {
                    make: spec.make,
                    model: spec.model,
                    year: spec.year
                }
            ]
        );

        return res.json({
            success: true,
            price: 1.49,
            alreadyUnlocked: false,
            spec
        });

    } catch (err) {
        console.error("Error fetching spec:", err);
        return res.status(500).json({ error: "Server error fetching spec" });
    }
});

export default router;
