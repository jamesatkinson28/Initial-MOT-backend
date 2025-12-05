import express from "express";
import fetch from "node-fetch";
import pool from "../db/db.js";
import { authRequired } from "../middleware/auth.js";


const router = express.Router();

// Normalize VRM input
function cleanVRM(vrm) {
    return vrm.replace(/\s+/g, "").toUpperCase();
}

// Convert raw API spec into your clean format
function normalizeSpec(raw, vrm) {
    const VD = raw?.Results?.VehicleDetails;
    const MD = raw?.Results?.ModelDetails;

    const engine = MD?.Powertrain?.IceDetails || {};
    const transmission = MD?.Powertrain?.Transmission || {};
    const dvlaTech = VD?.DvlaTechnicalDetails || {};
    const body = MD?.BodyDetails || {};
    const dims = MD?.Dimensions || {};
    const perf = MD?.Performance?.Statistics || {};
    const ncap = MD?.Safety?.EuroNcap || {};
    const emissions = MD?.Emissions || {};
    const historyColours = VD?.VehicleHistory?.ColourDetails || {};

    return {
        vrm,
        make: MD?.ModelIdentification?.Make || VD?.VehicleIdentification?.DvlaMake || null,
        model: MD?.ModelIdentification?.Range || null,
        mark: MD?.ModelIdentification?.Mark || null,
        country_of_origin: MD?.ModelIdentification?.CountryOfOrigin || null,
        year: VD?.VehicleIdentification?.YearOfManufacture || null,
        variant: MD?.ModelIdentification?.ModelVariant || null,

        dvla: {
            co2: VD?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaCo2 || null,
            tax_band: VD?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaCo2Band || null,
            body_type: VD?.VehicleIdentification?.DvlaBodyType || null,
            fuel_type: VD?.VehicleIdentification?.DvlaFuelType || null,
            original_colour: historyColours?.OriginalColour || null
        },

        engine: {
            bore_mm: engine?.BoreMm || null,
            stroke_mm: engine?.StrokeMm || null,
            aspiration: engine?.Aspiration || null,
            valve_gear: engine?.ValveGear || null,
            valves_per_cylinder: engine?.ValvesPerCylinder || null,
            cylinders: engine?.NumberOfCylinders || null,
            capacity_cc: engine?.EngineCapacityCc || null,
            capacity_litres: engine?.EngineCapacityLitres || null,
            cylinder_arrangement: engine?.CylinderArrangement || null,
            power_kw: dvlaTech?.MaxNetPowerKw || null,
            power_bhp: MD?.Performance?.Power?.Bhp || null,
            torque_nm: MD?.Performance?.Torque?.Nm || null,
            fuel_type: engine?.FuelType || VD?.VehicleIdentification?.DvlaFuelType || null
        },

        body: {
            axles: body?.NumberOfAxes || null,
            doors: body?.NumberOfDoors || null,
            seats: body?.NumberOfSeats || null,
            fuel_tank_litres: body?.FuelTankCapacityLitres || null,
            driving_axle: transmission?.DrivingAxle || null
        },

        weights: {
            kerb_weight_kg: MD?.Weights?.KerbWeightKg || null,
            gross_vehicle_weight_kg: MD?.Weights?.GrossVehicleWeightKg || null,
            payload_kg: MD?.Weights?.PayloadWeightKg || null
        },

        dimensions: {
            width_mm: dims?.WidthMm || null,
            height_mm: dims?.HeightMm || null,
            length_mm: dims?.LengthMm || null,
            wheelbase_mm: dims?.WheelbaseLengthMm || null
        },

        performance: {
            top_speed_kph: MD?.Performance?.Statistics?.MaxSpeedKph || null,
            top_speed_mph: MD?.Performance?.Statistics?.MaxSpeedMph || null,
            zero_to_60_mph: MD?.Performance?.Statistics?.ZeroToSixtyMph || null,
            zero_to_100_kph: MD?.Performance?.Statistics?.ZeroToOneHundredKph || null
        },

        emissions: {
            euro_status: emissions?.EuroStatus || null
        },

        safety: {
            ncap_star_rating: ncap?.NcapStarRating || null,
            ncap_adult_percent: ncap?.NcapAdultPercent || null,
            ncap_child_percent: ncap?.NcapChildPercent || null,
            ncap_pedestrian_percent: ncap?.NcapPedestrianPercent || null,
            ncap_safety_assist_percent: ncap?.NcapSafetyAssistPercent || null
        },

        images: null // always null for now (column removed)
    };
}

// -------------------------
// 🔥 SPEC UNLOCK ENDPOINT
// -------------------------
router.post("/unlock", authRequired, async (req, res) => {

    try {
        const userId = req.user.id;
        const { vrm } = req.body;

        if (!vrm) return res.status(400).json({ error: "VRM required" });

        const clean = cleanVRM(vrm);

        // 1️⃣ Has this user unlocked this VRM before?
        const existing = await pool.query(
            "SELECT * FROM unlocked_specs WHERE user_id=$1 AND vrm=$2",
            [userId, clean]
        );

        let alreadyUnlocked = existing.rowCount > 0;

        // 2️⃣ Get cached spec (if exists)
        const cached = await pool.query(
            "SELECT spec_json FROM vehicle_specs WHERE vrm=$1",
            [clean]
        );

        if (alreadyUnlocked && cached.rowCount > 0) {
            return res.json({
                success: true,
                price: 0,
                alreadyUnlocked: true,
                spec: cached.rows[0].spec_json
            });
        }

        // 3️⃣ Fetch fresh spec from UKVD API
        const url = `${process.env.SPEC_API_URL}/r2/lookup?ApiKey=${process.env.SPEC_API_KEY}&PackageName=VehicleDetails&Vrm=${clean}`;
        const response = await fetch(url);
        const raw = await response.json();

        if (!raw.Results) {
            return res.status(404).json({ error: "Spec not found" });
        }

        const spec = normalizeSpec(raw, clean);

        // 4️⃣ Save in cache table (vehicle_specs)
        await pool.query(
            `INSERT INTO vehicle_specs (vrm, spec_json, updated_at)
             VALUES ($1, $2, CURRENT_DATE)
             ON CONFLICT (vrm) DO UPDATE
               SET spec_json = EXCLUDED.spec_json,
                   updated_at = CURRENT_DATE`,
            [clean, spec]
        );

        // 5️⃣ Save unlock (only if not already saved)
        if (!alreadyUnlocked) {
            await pool.query(
                "INSERT INTO unlocked_specs (user_id, vrm) VALUES ($1, $2)",
                [userId, clean]
            );
        }

        res.json({
            success: true,
            price: alreadyUnlocked ? 0 : 0, // user unlocking logic comes later
            alreadyUnlocked,
            spec
        });

    } catch (err) {
        console.error("Spec unlock error:", err);
        res.status(500).json({ error: "Failed to unlock spec" });
    }
});

export default router;
