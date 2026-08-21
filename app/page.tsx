"use client";
import { useCallback, useEffect, useState } from "react";
type Limits = {
  pm25: number;
  pm10: number;
  gasPpm: number;
  minimumBattery: number;
  heartRateLow: number;
  heartRateHigh: number;
  spo2Low: number;
};
type Reading = {
  device_id: string;
  recorded_at: string;
  pm25: number | null;
  pm10: number | null;
  particle_sensor: string | null;
  dust_raw: number | null;
  dust_voltage: number | null;
  gas_ppm: number | null;
  gas_raw: number | null;
  heart_rate: number | null;
  spo2: number | null;
  latitude: number | null;
  longitude: number | null;
  gps_valid: boolean;
  battery_pct: number | null;
  battery_voltage: number | null;
  solar_voltage: number | null;
  motion: "normal" | "anomaly" | "fall" | "unavailable";
  accel_x: number | null;
  accel_y: number | null;
  accel_z: number | null;
  risk_score: number;
  alert_reasons: string[];
  worker_name: string | null;
  worker_id: string | null;
  contractor: string | null;
  shift_started_at: string | null;
  firmware_version: string | null;
};
type History = Pick<
  Reading,
  | "recorded_at"
  | "pm25"
  | "particle_sensor"
  | "dust_raw"
  | "dust_voltage"
  | "gas_ppm"
  | "heart_rate"
  | "spo2"
  | "battery_pct"
  | "battery_voltage"
  | "solar_voltage"
  | "latitude"
  | "longitude"
  | "risk_score"
  | "alert_reasons"
>;
type DailyExposure = {
  day: string;
  sample_count: number;
  average_risk: number;
  minimum_risk: number;
  maximum_risk: number;
  average_particles: number | null;
  average_optical_voltage: number | null;
  average_gas: number | null;
  average_battery_voltage: number | null;
  average_solar_voltage: number | null;
  high_risk_samples: number;
  first_packet_at: string;
  last_packet_at: string;
};
type NetworkSetup = {
  hostname: string;
  lanAddress: string | null;
  telemetryUrl: string | null;
  setupAccessPoint: string;
  setupPortal: string;
};
const emptyLimits: Limits = {
  pm25: 60,
  pm10: 100,
  gasPpm: 200,
  minimumBattery: 20,
  heartRateLow: 50,
  heartRateHigh: 120,
  spo2Low: 94,
};
const level = (n: number) => (n >= 75 ? "danger" : n >= 45 ? "warn" : "safe");
const value = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : n.toFixed(digits);
export default function Home() {
  const [tab, setTab] = useState<"live" | "thresholds" | "history">("live");
  const [reading, setReading] = useState<Reading | null>(null);
  const [limits, setLimits] = useState(emptyLimits);
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [dailyExposure, setDailyExposure] = useState<DailyExposure[]>([]);
  const [networkSetup, setNetworkSetup] = useState<NetworkSetup | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [device, setDevice] = useState({
    deviceId: "ESP32-WRK-2048",
    workerName: "",
    workerId: "",
    contractor: "",
    shiftStartedAt: "",
  });
  const pull = useCallback(async () => {
    try {
      const r = await fetch("/api/telemetry", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setReading(data.reading);
      setLimits(data.thresholds);
      setConnected(data.connected);
      setRecording(data.recording === true);
      setError("");
      if (data.reading)
        setDevice((x) => ({
          ...x,
          deviceId: data.reading.device_id,
          workerName: data.reading.worker_name ?? x.workerName,
          workerId: data.reading.worker_id ?? x.workerId,
          contractor: data.reading.contractor ?? x.contractor,
          shiftStartedAt:
            data.reading.shift_started_at?.slice(0, 16) ?? x.shiftStartedAt,
        }));
    } catch {
      setConnected(false);
      setRecording(false);
      setError("Backend or PostgreSQL is unavailable.");
    }
  }, []);
  useEffect(() => {
    pull();
    const timer = setInterval(pull, 3000);
    return () => clearInterval(timer);
  }, [pull]);
  useEffect(() => {
    fetch("/api/network", { cache: "no-store" })
      .then((response) => response.json())
      .then(setNetworkSetup)
      .catch(() => setNetworkSetup(null));
  }, []);
  useEffect(() => {
    if (tab === "history")
      fetch("/api/exposure?days=60", { cache: "no-store" })
        .then((r) => r.json())
        .then(setDailyExposure)
        .catch(() => setError("Could not load daily exposure averages."));
  }, [tab, reading?.recorded_at]);
  async function saveThresholds() {
    setSaving(true);
    const r = await fetch("/api/thresholds", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(limits),
    });
    setSaving(false);
    setNotice(
      r.ok
        ? "Thresholds saved in PostgreSQL."
        : "Thresholds could not be saved.",
    );
  }
  async function saveDevice() {
    setSaving(true);
    const r = await fetch("/api/device", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(device),
    });
    setSaving(false);
    setNotice(
      r.ok
        ? "Worker and device assignment saved."
        : "Device assignment could not be saved.",
    );
    pull();
  }
  const risk = reading?.risk_score ?? 0;
  return (
    <main>
      <aside>
        <div className="brand">
          <span className="shield">✦</span>
          <span>
            SURAKSHA
            <br />
            <b>WATCH</b>
          </span>
        </div>
        <p className="org">POSTGRES TELEMETRY</p>
        {[
          ["live", "◉", "Live monitoring"],
          ["thresholds", "⚙", "Configuration"],
          ["history", "◌", "Exposure history"],
        ].map(([id, icon, label]) => (
          <button
            key={id}
            className={`nav ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id as typeof tab)}
          >
            <span className="icon">{icon}</span>
            {label}
          </button>
        ))}
        <a className="nav" href="/ngo">
          <span className="icon">✚</span>
          NGO response
        </a>
        <a className="nav" href="/contractors">
          <span className="icon">▣</span>
          Contractors
        </a>
        <div className="sidebar-bottom">
          <b>{reading?.device_id ?? "ESP32 not seen"}</b>
          <small>
            {connected
              ? recording
                ? "Worn · recording exposure"
                : "Off wrist · live only"
              : "Waiting for packets"}
          </small>
        </div>
      </aside>
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">
              LIVE PROTECTION SYSTEM{" "}
              <span className={connected ? "safe-text" : "danger-text"}>
                ● {connected ? "DEVICE ONLINE" : "DEVICE OFFLINE"}
              </span>
            </p>
            <h1>
              {tab === "live"
                ? "Worker Safety Command Center"
                : tab === "thresholds"
                  ? "Device & Safety Configuration"
                  : "Recorded Exposure History"}
            </h1>
          </div>
          <div className="live-time">
            {recording ? "PostgreSQL record" : "Transient live packet"}
            <br />
            <b>
              {reading
                ? new Date(reading.recorded_at).toLocaleTimeString()
                : "No data yet"}
            </b>
          </div>
        </header>
        {error && <div className="notice error">{error}</div>}
        {notice && (
          <div className="notice">
            ✓ {notice}
            <button onClick={() => setNotice("")}>×</button>
          </div>
        )}
        {tab === "live" ? (
          <Live
            reading={reading}
            limits={limits}
            connected={connected}
            recording={recording}
            risk={risk}
          />
        ) : tab === "thresholds" ? (
          <Configuration
            limits={limits}
            setLimits={setLimits}
            device={device}
            setDevice={setDevice}
            saving={saving}
            saveThresholds={saveThresholds}
            saveDevice={saveDevice}
            networkSetup={networkSetup}
          />
        ) : (
          <HistoryPanel days={dailyExposure} />
        )}
      </section>
    </main>
  );
}
function Live({
  reading: r,
  limits,
  connected,
  recording,
  risk,
}: {
  reading: Reading | null;
  limits: Limits;
  connected: boolean;
  recording: boolean;
  risk: number;
}) {
  if (!r)
    return (
      <article className="panel waiting">
        <div className="pulse-dot" />
        <h2>Waiting for the first ESP32 packet</h2>
        <p>
          No sensor values are fabricated. Connect the ESP32 to Wi‑Fi and it
          will begin posting to this backend.
        </p>
        <code>POST /api/telemetry</code>
      </article>
    );
  const solar = r.solar_voltage;
  const solarState =
    solar == null
      ? "Solar ADC unavailable"
      : solar >= 4.2
        ? "Charging voltage available"
        : solar >= 1
          ? "Solar voltage too low to charge"
          : "No solar input detected";
  const batteryValid =
    r.battery_voltage != null &&
    r.battery_voltage >= 2.5 &&
    r.battery_voltage <= 4.5;
  return (
    <>
      <article className={`wear-state ${recording ? "recording" : "paused"}`}>
        <div>
          <small>WEAR DETECTION · MAX3010x</small>
          <h2>
            {recording
              ? "Valid heart rate detected — exposure is being recorded"
              : "No valid heart rate — database recording is paused"}
          </h2>
        </div>
        <b>{recording ? "● RECORDING" : "○ LIVE VIEW ONLY"}</b>
      </article>
      <div className="hero-row">
        <article className="worker-card">
          <div className="worker-top">
            <div className="avatar">
              {r.worker_name
                ? r.worker_name
                    .split(" ")
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join("")
                : "ESP"}
            </div>
            <div>
              <h2>
                {r.worker_name ?? "Unassigned worker"}{" "}
                <em>
                  ●{" "}
                  {connected
                    ? recording
                      ? "Recording"
                      : "Off wrist"
                    : "Last known"}
                </em>
              </h2>
              <p>
                {r.worker_id ?? "Worker ID not configured"} ·{" "}
                {r.contractor ?? "Contractor not configured"}
              </p>
              <p className="muted">
                Device {r.device_id} · Firmware{" "}
                {r.firmware_version ?? "unknown"}
              </p>
            </div>
          </div>
          <div className="metrics">
            <Metric
              label="GP2Y1014AU · MIXED PARTICULATE"
              n={r.pm25}
              unit="µg/m³"
              bad={r.pm25 != null && r.pm25 > limits.pm25}
            />
            <Metric
              label="GP2Y1014AU · OPTICAL OUTPUT"
              n={r.dust_voltage}
              unit="V"
              bad={false}
            />
            <Metric
              label="MQ-135 · CALIBRATED MIXED-GAS EQUIVALENT"
              n={r.gas_ppm}
              unit="ppm eq."
              bad={r.gas_ppm != null && r.gas_ppm > limits.gasPpm}
            />
          </div>
          <p className="muted">
            Optical ADC raw: {value(r.dust_raw, 0)} · One combined particulate
            concentration is reported; PM2.5 and PM10 are not separated.
          </p>
        </article>
        <article className="risk-card">
          <small>{recording ? "DATABASE RISK SCORE" : "LIVE RISK SCORE"}</small>
          <div
            className={`risk-ring ${level(risk)}`}
            style={{ "--risk": `${risk * 3.6}deg` } as React.CSSProperties}
          >
            <div>
              <b>{risk}</b>
              <small>/100</small>
            </div>
          </div>
          <b className={level(risk)}>{level(risk).toUpperCase()} RISK</b>
          <p>
            {r.alert_reasons.length
              ? r.alert_reasons.join(" · ")
              : "No active threshold violations"}
          </p>
        </article>
      </div>
      <div className="two-col">
        <Sensor
          title="MAX3010x · HEART RATE"
          n={r.heart_rate}
          unit="BPM"
          detail={
            r.heart_rate == null
              ? "Finger not detected"
              : r.heart_rate < limits.heartRateLow ||
                  r.heart_rate > limits.heartRateHigh
                ? "Outside threshold"
                : "Within threshold"
          }
        />
        <Sensor
          title="MAX3010x · BLOOD OXYGEN"
          n={r.spo2}
          unit="% SpO₂"
          detail={
            r.spo2 == null
              ? "Finger not detected"
              : r.spo2 < limits.spo2Low
                ? "Below threshold"
                : "Within threshold"
          }
        />
      </div>
      <div className="two-col">
        <article className="panel map-panel">
          <div className="panel-heading">
            <div>
              <small>NEO-6M · GPS</small>
              <h2>
                {r.gps_valid ? "Valid satellite fix" : "Waiting for GPS fix"}
              </h2>
            </div>
            {r.gps_valid && r.latitude != null && r.longitude != null ? (
              <a
                target="_blank"
                rel="noreferrer"
                href={`https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}`}
              >
                Open map ↗
              </a>
            ) : null}
          </div>
          <div className="map">
            <div className="road r1" />
            <div className="road r2" />
            <div className="road r3" />
            {r.gps_valid ? (
              <div className="pin">
                ⌖
                <span>
                  {r.worker_name ?? r.device_id}
                  <br />
                  <b>
                    {value(r.latitude, 5)}, {value(r.longitude, 5)}
                  </b>
                </span>
              </div>
            ) : null}
            <p>
              {r.gps_valid
                ? "Position stored in PostgreSQL"
                : "No coordinates stored"}
            </p>
          </div>
        </article>
        <article className="panel">
          <small>BATTERY & SOLAR POWER</small>
          <h2>Measured power subsystem</h2>
          <div className="power">
            <div>
              <b>{batteryValid ? `${value(r.battery_pct, 0)}%` : "—"}</b>
              <small>{value(r.battery_voltage, 2)} V battery</small>
              <div className="battery big">
                <i
                  style={{
                    width: `${batteryValid ? (r.battery_pct ?? 0) : 0}%`,
                  }}
                />
              </div>
              <p className={batteryValid ? "safe-text" : "warn-text"}>
                {batteryValid
                  ? "Battery voltage in measurable range"
                  : "Check battery divider/wiring"}
              </p>
            </div>
            <div>
              <b>{value(solar, 2)} V</b>
              <small>solar/charger input</small>
              <p
                className={
                  solar != null && solar >= 4.2 ? "safe-text" : "warn-text"
                }
              >
                {solarState}
              </p>
            </div>
          </div>
        </article>
      </div>
    </>
  );
}
function Metric({
  label,
  n,
  unit,
  bad,
}: {
  label: string;
  n: number | null;
  unit: string;
  bad: boolean;
}) {
  return (
    <div>
      <small>{label}</small>
      <strong className={bad ? "danger-text" : ""}>
        {value(n, 1)} <i>{unit}</i>
      </strong>
      <p
        className={n == null ? "warn-text" : bad ? "danger-text" : "safe-text"}
      >
        {n == null
          ? "No sensor value"
          : bad
            ? "Above threshold"
            : "Within threshold"}
      </p>
    </div>
  );
}
function Sensor({
  title,
  n,
  unit,
  detail,
}: {
  title: string;
  n: number | null;
  unit: string;
  detail: string;
}) {
  return (
    <article className="panel sensor">
      <small>{title}</small>
      <b>
        {value(n, 1)} <i>{unit}</i>
      </b>
      <p>{detail}</p>
    </article>
  );
}
function Configuration({
  limits,
  setLimits,
  device,
  setDevice,
  saving,
  saveThresholds,
  saveDevice,
  networkSetup,
}: {
  limits: Limits;
  setLimits: (v: Limits) => void;
  device: {
    deviceId: string;
    workerName: string;
    workerId: string;
    contractor: string;
    shiftStartedAt: string;
  };
  setDevice: (v: typeof device) => void;
  saving: boolean;
  saveThresholds: () => void;
  saveDevice: () => void;
  networkSetup: NetworkSetup | null;
}) {
  return (
    <div className="config-stack">
      <article className="panel settings">
        <small>POSTGRESQL · GLOBAL SAFETY POLICY</small>
        <h2>Threshold settings</h2>
        <div className="setting-grid">
          {(
            [
              ["pm25", "Mixed particulate limit", "µg/m³"],
              ["gasPpm", "MQ-135 equivalent limit", "ppm eq."],
              ["minimumBattery", "Minimum battery", "%"],
              ["heartRateLow", "Heart-rate lower", "BPM"],
              ["heartRateHigh", "Heart-rate upper", "BPM"],
              ["spo2Low", "Minimum SpO₂", "%"],
            ] as [keyof Limits, string, string][]
          ).map(([key, label, unit]) => (
            <label key={key}>
              {label}
              <div>
                <input
                  type="number"
                  value={limits[key]}
                  onChange={(e) =>
                    setLimits({ ...limits, [key]: Number(e.target.value) })
                  }
                />
                <span>{unit}</span>
              </div>
            </label>
          ))}
        </div>
        <button className="primary" disabled={saving} onClick={saveThresholds}>
          Save thresholds
        </button>
      </article>
      <article className="panel connection-guide">
        <small>SELF-SERVICE DEVICE CONNECTION</small>
        <h2>Bring the ESP32 online without changing code</h2>
        <div className="connection-steps">
          <span>
            <b>1</b> Keep this Mac and the ESP32 on the same Wi‑Fi or hotspot.
          </span>
          <span>
            <b>2</b> Hold the ESP32 <strong>BOOT</strong> button while pressing{" "}
            <strong>EN/RESET</strong>.
          </span>
          <span>
            <b>3</b> On your phone or Mac, connect to{" "}
            <code>
              {networkSetup?.setupAccessPoint ?? "SurakshaWatch-2048"}
            </code>
            .
          </span>
          <span>
            <b>4</b> Open{" "}
            <code>{networkSetup?.setupPortal ?? "http://192.168.4.1"}</code>,
            select Wi‑Fi, and enter the backend URL below.
          </span>
        </div>
        <label className="backend-url">
          CURRENT BACKEND URL
          <code>
            {networkSetup?.telemetryUrl ??
              "Connect this Mac to Wi‑Fi to generate the URL"}
          </code>
        </label>
        <p>
          The watch also opens this setup network automatically after repeated
          backend failures. Device status changes to online as soon as a packet
          arrives.
        </p>
      </article>
      <article className="panel settings">
        <small>DEVICE ASSIGNMENT</small>
        <h2>Worker and contractor</h2>
        <div className="setting-grid">
          {(
            [
              ["deviceId", "Device ID"],
              ["workerName", "Worker name"],
              ["workerId", "Worker ID"],
              ["contractor", "Contractor"],
              ["shiftStartedAt", "Shift start"],
            ] as [keyof typeof device, string][]
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <div>
                <input
                  type={key === "shiftStartedAt" ? "datetime-local" : "text"}
                  value={device[key]}
                  onChange={(e) =>
                    setDevice({ ...device, [key]: e.target.value })
                  }
                />
              </div>
            </label>
          ))}
        </div>
        <button className="primary" disabled={saving} onClick={saveDevice}>
          Save assignment
        </button>
      </article>
    </div>
  );
}
function HistoryPanel({ days }: { days: DailyExposure[] }) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [details, setDetails] = useState<
    Record<string, { rows: History[]; total: number }>
  >({});
  const [loadingDay, setLoadingDay] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function loadDay(day: string, append = false) {
    const offset = append ? (details[day]?.rows.length ?? 0) : 0;
    setLoadingDay(day);
    setDetailError(null);
    try {
      const response = await fetch(
        `/api/exposure?date=${encodeURIComponent(day)}&limit=500&offset=${offset}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const payload = await response.json();
      setDetails((current) => ({
        ...current,
        [day]: {
          total: payload.total,
          rows: append
            ? [...(current[day]?.rows ?? []), ...payload.rows]
            : payload.rows,
        },
      }));
    } catch {
      setDetailError(day);
    } finally {
      setLoadingDay(null);
    }
  }

  async function toggleDay(day: string) {
    if (expandedDay === day) {
      setExpandedDay(null);
      return;
    }
    setExpandedDay(day);
    if (!details[day]) await loadDay(day);
  }

  return (
    <div className="daily-stack">
      <article className="panel daily-intro">
        <small>LAST 60 DAYS · ASIA/KOLKATA · POSTGRESQL</small>
        <h2>Daily average risk from every stored 5-second score</h2>
        <p>
          Raw packets remain permanently stored. Today&apos;s average updates as
          new readings arrive; completed days represent the full 24-hour window.
        </p>
      </article>
      {days.length ? (
        days.map((day) => {
          const expanded = expandedDay === day.day;
          const detail = details[day.day];
          return (
            <article className="panel daily-card" key={day.day}>
              <div className="daily-summary">
                <div>
                  <small>CALENDAR DAY</small>
                  <h2>
                    {new Date(`${day.day}T00:00:00+05:30`).toLocaleDateString(
                      "en-IN",
                      {
                        weekday: "long",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      },
                    )}
                  </h2>
                  <p>
                    {day.sample_count.toLocaleString("en-IN")} packets · Range{" "}
                    {day.minimum_risk}–{day.maximum_risk}
                  </p>
                </div>
                <div className="daily-stat">
                  <small>AVERAGE MIXED PARTICULATE</small>
                  <b>
                    {value(day.average_particles, 1)} <i>µg/m³</i>
                  </b>
                </div>
                <div className="daily-stat average-risk">
                  <small>24-HOUR AVERAGE RISK</small>
                  <b className={level(day.average_risk)}>
                    {day.average_risk.toFixed(1)} <i>/100</i>
                  </b>
                </div>
                <button
                  className="day-toggle"
                  aria-expanded={expanded}
                  aria-controls={`packets-${day.day}`}
                  onClick={() => toggleDay(day.day)}
                >
                  {expanded
                    ? "Hide 5-second readings ▲"
                    : "Show 5-second readings ▼"}
                </button>
              </div>
              {expanded ? (
                <div className="day-details" id={`packets-${day.day}`}>
                  {loadingDay === day.day && !detail ? (
                    <p>Loading packets…</p>
                  ) : null}
                  {detailError === day.day ? (
                    <p className="danger-text">
                      Could not load this day&apos;s packets. Try the dropdown
                      again.
                    </p>
                  ) : null}
                  {detail ? (
                    <>
                      <div className="history-table detail-scroll">
                        <div className="history-head">
                          <b>Time</b>
                          <b>Particles</b>
                          <b>Optical V</b>
                          <b>Battery / Solar</b>
                          <b>Gas eq.</b>
                          <b>Risk</b>
                        </div>
                        {detail.rows.map((row) => (
                          <div className="history-row" key={row.recorded_at}>
                            <span>
                              {new Date(row.recorded_at).toLocaleTimeString(
                                "en-IN",
                              )}
                            </span>
                            <span>{value(row.pm25, 1)} µg/m³</span>
                            <span>{value(row.dust_voltage, 3)} V</span>
                            <span>
                              {value(row.battery_voltage, 2)} /{" "}
                              {value(row.solar_voltage, 2)} V
                            </span>
                            <span>{value(row.gas_ppm, 0)}</span>
                            <b className={level(row.risk_score)}>
                              {row.risk_score}
                            </b>
                          </div>
                        ))}
                      </div>
                      <div className="detail-footer">
                        <span>
                          Showing {detail.rows.length.toLocaleString("en-IN")}{" "}
                          of {detail.total.toLocaleString("en-IN")} packets
                        </span>
                        {detail.rows.length < detail.total ? (
                          <button
                            className="outline"
                            disabled={loadingDay === day.day}
                            onClick={() => loadDay(day.day, true)}
                          >
                            {loadingDay === day.day
                              ? "Loading…"
                              : "Load 500 more"}
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })
      ) : (
        <article className="panel">
          <p>No genuine telemetry days have been recorded yet.</p>
        </article>
      )}
    </div>
  );
}
