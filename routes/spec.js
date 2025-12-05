import express from "express";
import fetch from "node-fetch";
import db from "../db/db.js";
import { authenticateToken } from "../middleware/authMiddleware.js";

import fetchSpecFromVDG from "../utils/fetchSpec.js";
import normalizeSpec from "../utils/normalizeSpec.js";


const router = express.Router();

const VDG_API_KEY = process.env.VDG_API_KEY;
const VDG_PACKAGE = process.env.VDG_PACKAGE;
const VDG_BASE_URL = process.env.VDG_BASE_URL || "https://uk.api.vehicledataglobal.com";


// ----------------------------
// Normalize VDG Raw Response
// ----------------------------
function normalizeSpec(raw, vrm) {
    const vehicle = raw?.Results?.VehicleDetails;
    const model = raw?.Results?.ModelDetails;

    return {
        vrm,
        make: model?.ModelIdentification?.Make || vehicle?.VehicleIdentification?.DvlaMake || null,
        model: model?.ModelIdentification?.Range || vehicle?.VehicleIdentification?.DvlaModel || null,
        variant: model?.ModelIdentification?.ModelVariant || null,
        year: vehicle?.VehicleIdentification?.YearOfManufacture || null,

        // NEW FIELDS
        country_of_origin: model?.ModelIdentification?.CountryOfOrigin || null,
        generation_mark: model?.ModelIdentification?.Mark || null,

        dvla: {
            body_type: vehicle?.VehicleIdentification?.DvlaBodyType || null,
            fuel_type: vehicle?.VehicleIdentification?.DvlaFuelType || null,
            co2: vehicle?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaCo2 || null,
            tax_band: vehicle?.VehicleStatus?.VehicleExciseDutyDetails?.DvlaBand || null,
            original_colour: raw?.Results?.VehicleHistory?.ColourDetails?.OriginalColour || null,
        },

        engine: {
            capacity_cc: model?.Powertrain?.IceDetails?.EngineCapacityCc || null,
            capacity_litres: model?.Powertrain?.IceDetails?.EngineCapacityLitres || null,
            cylinders: model?.Powertrain?.IceDetails?.NumberOfCylinders || null,
            cylinder_arrangement: model?.Powertrain?.IceDetails?.CylinderArrangement || null,
            aspiration: model?.Powertrain?.IceDetails?.Aspiration || null,
            valve_gear: model?.Powertrain?.IceDetails?.ValveGear || null,
            valves_per_cylinder: model?.Powertrain?.IceDetails?.ValvesPerCylinder || null,
            bore_mm: model?.Powertrain?.IceDetails?.BoreMm || null,
            stroke_mm: model?.Powertrain?.IceDetails?.StrokeMm || null,
            fuel_type: model?.Powertrain?.FuelType || null,
            power_kw: model?.Performance?.Power?.Kw || null,
            power_bhp: model?.Performance?.Power?.Bhp || null,
            torque_nm: model?.Performance?.Torque?.Nm || null
        },

        body: {
            doors: model?.BodyDetails?.NumberOfDoors || null,
            seats: model?.BodyDetails?.NumberOfSeats || null,
            axles: model?.BodyDetails?.NumberOfAxles || null,
            wheelbase_mm: model?.Dimensions?.WheelbaseLengthMm || null,
            fuel_tank_litres: model?.BodyDetails?.FuelTankCapacityLitres || null,
            driving_axle: model?.Transmission?.DrivingAxle || null
        },

        dimensions: {
            length_mm: model?.Dimensions?.LengthMm || null,
            width_mm: model?.Dimensions?.WidthMm || null,
            height_mm: model?.Dimensions?.HeightMm || null,
            wheelbase_mm: model?.Dimensions?.WheelbaseLengthMm || null,
        },

        weights: {
            kerb_weight_kg: model?.Weights?.KerbWeightKg || null,
            gross_vehicle_weight_kg: model?.Weights?.GrossVehicleWeightKg || null,
            payload_kg: model?.Weights?.PayloadWeightKg || null
        },

        emissions: {
            euro_status: model?.Emissions?.EuroStatus || null,
        },

        performance: {
            top_speed_kph: model?.Performance?.Statistics?.MaxSpeedKph || null,
            top_speed_mph: model?.Performance?.Statistics?.MaxSpeedMph || null,
            zero_to_60_mph: model?.Performance?.Statistics?.ZeroToSixtyMph || null,
            zero_to_100_kph: model?.Performance?.Statistics?.ZeroToOneHundredKph || null,
        },

        safety: {
            ncap_star_rating: model?.Safety?.EuroNcap?.NcapStarRating || null,
            ncap_adult_percent: model?.Safety?.EuroNcap?.NcapAdultPercent || null,
            ncap_child_percent: model?.Safety?.EuroNcap?.NcapChildPercent || null,
            ncap_pedestrian_percent: model?.Safety?.EuroNcap?.NcapPedestrianPercent || null,
            ncap_safety_assist_percent: model?.Safety?.EuroNcap?.NcapSafetyAssistPercent || null,
        },

        transmission: {
            type: model?.Transmission?.TransmissionType || null,
            gears: model?.Transmission?.NumberOfGears || null,
            drive: model?.Transmission?.DriveType || null
        },

        images: null // reserved for future upgrade
    };
}



// ----------------------------
// Fetch from VDG
// ----------------------------
async function fetchSpecFromVDG(vrm) {
    const url = `${VDG_BASE_URL}/r2/lookup?ApiKey=${VDG_API_KEY}&PackageName=${VDG_PACKAGE}&Vrm=${vrm}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error("VDG API error");

    const data = await res.json();
    return data;
}


// ----------------------------
// Unlock Spec Endpoint
// ----------------------------
router.post("/unlock-spec", authenticateToken, async (req, res) => {
    const client = await db.connect();

    try {
        const { vrm } = req.body;
        if (!vrm) return res.status(400).json({ error: "VRM required" });

        const userId = req.user.id;

        await client.query("BEGIN");

        // 1. Load user data
        const userRes = await client.query(
            "SELECT premium, premium_until, monthly_unlocks_remaining, last_unlock_reset FROM users WHERE id = $1",
            [userId]
        );
        const user = userRes.rows[0];

        const now = new Date();
        const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // 2. Reset premium unlock counter at the start of each month
        if (user.premium && new Date(user.last_unlock_reset) < firstOfMonth) {
            await client.query(
                "UPDATE users SET monthly_unlocks_remaining = 3, last_unlock_reset = $2 WHERE id = $1",
                [userId, firstOfMonth]
            );
            user.monthly_unlocks_remaining = 3;
            user.last_unlock_reset = firstOfMonth;
        }

        const isPremiumActive = user.premium && new Date(user.premium_until) > now;

        // 3. Check if already unlocked
        const unlocked = await client.query(
            "SELECT * FROM unlocked_specs WHERE user_id = $1 AND vrm = $2",
            [userId, vrm]
        );

        if (unlocked.rows.length > 0) {
            // Return cached spec immediately
            const cached = await client.query(
                "SELECT spec_json FROM vehicle_specs WHERE vrm = $1",
                [vrm]
            );

            await client.query("COMMIT");

            return res.json({
                success: true,
                unlocked: true,
                cost: 0,
                message: "Already unlocked",
                spec: cached.rows[0]?.spec_json || null
            });
        }

        // 4. Pricing logic
        let cost = 1.49;
        let usedFreeUnlock = false;

        if (isPremiumActive && user.monthly_unlocks_remaining > 0) {
            // Free monthly unlock
            cost = 0;
            usedFreeUnlock = true;
        } else if (isPremiumActive) {
            // Premium discount (25% off)
            cost = parseFloat((1.49 * 0.75).toFixed(2)); // £1.12
        } else {
            // Free user
            cost = 1.49;
        }

        // If free unlock used, deduct
        if (usedFreeUnlock) {
            await client.query(
                "UPDATE users SET monthly_unlocks_remaining = monthly_unlocks_remaining - 1 WHERE id = $1",
                [userId]
            );
        }

        // 5. Fetch live data from VDG
        const raw = await fetchSpecFromVDG(vrm);
        const clean = normalizeSpec(raw);

        if (!clean) throw new Error("Failed to normalize vehicle spec");

        // 6. Store spec
        await client.query(
            `INSERT INTO vehicle_specs (vrm, spec_json)
             VALUES ($1, $2)
             ON CONFLICT (vrm)
             DO UPDATE SET spec_json = $2, updated_at = NOW()`,
            [vrm, clean]
        );

        // 7. Mark VRM as unlocked permanently
        await client.query(
            "INSERT INTO unlocked_specs (user_id, vrm) VALUES ($1, $2)",
            [userId, vrm]
        );

        await client.query("COMMIT");

        return res.json({
            success: true,
            unlocked: false,
            cost,
            usedFreeUnlock,
            isPremium: isPremiumActive,
            remainingFreeUnlocks: isPremiumActive ? user.monthly_unlocks_remaining - (usedFreeUnlock ? 1 : 0) : 0,
            spec: clean
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
