import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "../../../lib/db";

export async function GET(request: NextRequest) {
  await ensureSchema();
  const id = request.nextUrl.searchParams.get("deviceId");
  const hours = Math.min(
    1440,
    Math.max(1, Number(request.nextUrl.searchParams.get("hours") || 24)),
  );
  const result = await db.query(
    `SELECT recorded_at,pm25,particle_sensor,dust_raw,dust_voltage,gas_ppm,
            heart_rate,spo2,battery_pct,battery_voltage,solar_voltage,latitude,
            longitude,risk_score,alert_reasons
     FROM telemetry
     WHERE wear_detected = true
       AND ($1::text IS NULL OR device_id=$1)
       AND recorded_at > now()-($2||' hours')::interval
     ORDER BY recorded_at ASC LIMIT 10000`,
    [id, hours],
  );
  return NextResponse.json(result.rows);
}
