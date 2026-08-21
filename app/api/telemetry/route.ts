import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "../../../lib/db";
import {
  getLiveTelemetry,
  setLiveTelemetry,
} from "../../../lib/live-telemetry";
import { calculateRisk, type Limits } from "../../../lib/risk";

export const dynamic = "force-dynamic";

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function thresholds(row: Record<string, unknown>): Limits {
  return {
    pm25: Number(row.pm25),
    pm10: Number(row.pm10),
    gasPpm: Number(row.gas_ppm),
    minimumBattery: Number(row.minimum_battery),
    heartRateLow: Number(row.heart_rate_low),
    heartRateHigh: Number(row.heart_rate_high),
    spo2Low: Number(row.spo2_low),
  };
}

export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    const deviceId = request.nextUrl.searchParams.get("deviceId");
    const [latestStored, limitResult, deviceResult] = await Promise.all([
      db.query(
        `SELECT t.*, d.worker_name, d.worker_id, d.contractor,
                d.shift_started_at, d.last_seen_at, d.firmware_version
         FROM telemetry t
         JOIN devices d ON d.id = t.device_id
         WHERE t.wear_detected = true
         ${deviceId ? "AND t.device_id=$1" : ""}
         ORDER BY t.recorded_at DESC LIMIT 1`,
        deviceId ? [deviceId] : [],
      ),
      db.query("SELECT * FROM thresholds WHERE id=1"),
      db.query(
        `SELECT * FROM devices ${deviceId ? "WHERE id=$1" : ""}
         ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`,
        deviceId ? [deviceId] : [],
      ),
    ]);

    const device = deviceResult.rows[0] ?? null;
    const live = getLiveTelemetry(deviceId ?? device?.id);
    const connectedAt = live?.receivedAt ?? device?.last_seen_at ?? null;
    const connected = connectedAt
      ? Date.now() - new Date(connectedAt).getTime() < 15_000
      : false;
    const reading = live
      ? {
          ...live.reading,
          worker_name: device?.worker_name ?? null,
          worker_id: device?.worker_id ?? null,
          contractor: device?.contractor ?? null,
          shift_started_at: device?.shift_started_at ?? null,
          last_seen_at: connectedAt,
          firmware_version: device?.firmware_version ?? null,
        }
      : (latestStored.rows[0] ?? null);

    return NextResponse.json({
      reading,
      thresholds: thresholds(limitResult.rows[0]),
      connected,
      recording: connected && Boolean(live ? live.wearing : device?.wearing),
      readingSource: live ? "live" : reading ? "stored" : null,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (
    !process.env.DEVICE_API_KEY ||
    request.headers.get("x-device-key") !== process.env.DEVICE_API_KEY
  )
    return NextResponse.json({ error: "Invalid device key" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body.deviceId !== "string" || !body.deviceId.trim())
    return NextResponse.json(
      { error: "deviceId is required" },
      { status: 422 },
    );
  if (!["normal", "anomaly", "fall", "unavailable"].includes(body.motion))
    return NextResponse.json(
      { error: "motion must be normal, anomaly, fall, or unavailable" },
      { status: 422 },
    );

  try {
    await ensureSchema();
    const limits = thresholds(
      (await db.query("SELECT * FROM thresholds WHERE id=1")).rows[0],
    );
    const input = {
      pm25: numberOrNull(body.pm25),
      pm10: numberOrNull(body.pm10),
      gasPpm: numberOrNull(body.gasPpm),
      batteryPct: numberOrNull(body.batteryPct),
      heartRate: numberOrNull(body.heartRate),
      spo2: numberOrNull(body.spo2),
      motion: body.motion,
    };
    const validHeartRate =
      input.heartRate != null &&
      input.heartRate >= 35 &&
      input.heartRate <= 220;
    // Optical intensity alone can be triggered by nearby objects or ambient
    // light. Persist exposure only after the sensor calculates a valid BPM.
    const wearing = validHeartRate;
    const risk = calculateRisk(input, limits);
    const receivedAt = new Date().toISOString();
    const liveReading = {
      device_id: body.deviceId,
      recorded_at: receivedAt,
      pm25: input.pm25,
      pm10: input.pm10,
      particle_sensor:
        typeof body.particleSensor === "string" ? body.particleSensor : null,
      dust_raw: numberOrNull(body.dustRaw),
      dust_voltage: numberOrNull(body.dustVoltage),
      gas_ppm: input.gasPpm,
      gas_raw: numberOrNull(body.gasRaw),
      heart_rate: input.heartRate,
      spo2: input.spo2,
      latitude: numberOrNull(body.latitude),
      longitude: numberOrNull(body.longitude),
      gps_valid: Boolean(body.gpsValid),
      battery_pct: input.batteryPct,
      battery_voltage: numberOrNull(body.batteryVoltage),
      solar_voltage: numberOrNull(body.solarVoltage),
      motion: input.motion,
      accel_x: numberOrNull(body.accelX),
      accel_y: numberOrNull(body.accelY),
      accel_z: numberOrNull(body.accelZ),
      risk_score: risk.score,
      alert_reasons: risk.reasons,
      pulse_detected: body.pulseDetected === true,
    };

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO devices(id, last_seen_at, firmware_version, wearing)
         VALUES($1, now(), $2, $3)
         ON CONFLICT(id) DO UPDATE SET
           last_seen_at=now(),
           firmware_version=EXCLUDED.firmware_version,
           wearing=EXCLUDED.wearing`,
        [body.deviceId, body.firmwareVersion ?? null, wearing],
      );

      if (!wearing) {
        await client.query("COMMIT");
        setLiveTelemetry(body.deviceId, {
          receivedAt,
          wearing: false,
          reading: liveReading,
        });
        return NextResponse.json(
          {
            accepted: true,
            stored: false,
            wearing: false,
            reason: "No valid heart rate detected",
            receivedAt,
            riskScore: risk.score,
            alertReasons: risk.reasons,
          },
          { status: 202 },
        );
      }

      const result = await client.query(
        `INSERT INTO telemetry(device_id,pm25,pm10,particle_sensor,dust_raw,dust_voltage,gas_ppm,gas_raw,heart_rate,spo2,latitude,longitude,gps_valid,battery_pct,battery_voltage,solar_voltage,motion,accel_x,accel_y,accel_z,risk_score,alert_reasons,wear_detected)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,true)
         RETURNING id,recorded_at`,
        [
          body.deviceId,
          input.pm25,
          input.pm10,
          liveReading.particle_sensor,
          liveReading.dust_raw,
          liveReading.dust_voltage,
          input.gasPpm,
          liveReading.gas_raw,
          input.heartRate,
          input.spo2,
          liveReading.latitude,
          liveReading.longitude,
          liveReading.gps_valid,
          input.batteryPct,
          liveReading.battery_voltage,
          liveReading.solar_voltage,
          input.motion,
          liveReading.accel_x,
          liveReading.accel_y,
          liveReading.accel_z,
          risk.score,
          risk.reasons,
        ],
      );
      if (risk.score >= 75 || input.motion === "fall")
        await client.query(
          "INSERT INTO alerts(device_id,telemetry_id,severity,message) VALUES($1,$2,$3,$4)",
          [
            body.deviceId,
            result.rows[0].id,
            input.motion === "fall" ? "critical" : "high",
            risk.reasons.join(", ") || "High calculated risk",
          ],
        );
      if (risk.score >= 75)
        await client.query(
          `INSERT INTO ngo_cases(device_id, telemetry_id, incident_day)
           VALUES($1, $2, (now() AT TIME ZONE 'Asia/Kolkata')::date)
           ON CONFLICT (device_id, incident_day) DO NOTHING`,
          [body.deviceId, result.rows[0].id],
        );
      await client.query("COMMIT");

      setLiveTelemetry(body.deviceId, {
        receivedAt,
        wearing: true,
        reading: {
          ...liveReading,
          id: result.rows[0].id,
          recorded_at: result.rows[0].recorded_at,
        },
      });
      return NextResponse.json(
        {
          accepted: true,
          stored: true,
          wearing: true,
          id: result.rows[0].id,
          recordedAt: result.rows[0].recorded_at,
          riskScore: risk.score,
          alertReasons: risk.reasons,
        },
        { status: 201 },
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Could not process telemetry" },
      { status: 500 },
    );
  }
}
