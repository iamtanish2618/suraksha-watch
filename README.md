# Suraksha Watch

End-to-end ESP32 worker-safety telemetry: physical sensors → authenticated HTTP ingestion → PostgreSQL → live Next.js dashboard. There is no generated sensor-data fallback. Until a real packet is received, the UI says **Waiting for the first ESP32 packet**. The GP2Y1014AU is represented as one mixed-particulate signal because its analog optical output does not independently separate PM2.5 and PM10.

The backend records exposure only while the MAX3010x produces a valid heart-rate result (35–220 BPM). Off-wrist packets return HTTP `202`, remain available to the transient live dashboard, and are not inserted into telemetry, alerts, daily averages, or exposure history. Raw optical intensity alone is not accepted as wear proof because objects and ambient light can trigger it.

Firmware 1.5.0 uses the direct ADC voltage for the GP2Y1014AU0F and the Sharp sensitivity of 0.5 V per 100 µg/m³. MQ-135 no longer uses a universal hard-coded R0: it learns and persists this sensor's clean-air resistance baseline, then reports a bounded **mixed-gas ppm equivalent**. It is not a laboratory gas-specific concentration; the MQ-135 is cross-sensitive and requires at least 48 hours of initial heater aging for meaningful repeatability.

## Panels

- `/` — live worker monitoring, thresholds, exposure history, and self-service ESP32 connection recovery.
- `/contractors` — contractor directory, contractor editing, and rag-picker/device registration. Bank fields are never returned by the contractor directory API.
- `/ngo` — authenticated NGO response, affected workers, compensation ledger, and the complete contractor/worker transparency directory.

NGO access uses `NGO_ACCESS_PIN` and `NGO_SESSION_SECRET` from `.env.local` and an HTTP-only eight-hour session cookie.

## Reconnect the ESP32

Open **Monitoring → Configuration → Bring the ESP32 online** for the current backend URL. Hold the ESP32 **BOOT** button while pressing **EN/RESET**, connect a phone or computer to `SurakshaWatch-2048`, then open `http://192.168.4.1` and save the Wi-Fi credentials and displayed backend URL. Firmware 1.4.0 also starts this portal after repeated backend failures.

## Run locally

```bash
docker compose up -d
npm install
npm run dev -- -H 0.0.0.0
```

Dashboard: `http://localhost:3000`. Database health: `GET /api/health`.

## Firmware

Open `firmware/suraksha_watch/suraksha_watch.ino` in Arduino IDE and select **ESP32 Dev Module**. Required libraries are ArduinoJson, TinyGPSPlus, SparkFun MAX3010x Pulse and Proximity Sensor Library, and WiFiManager. The physical module was confirmed as MAX30102 at I²C address `0x57` and initializes successfully with the SparkFun driver. The firmware currently uses:

| Component | ESP32 connection |
|---|---|
| MAX30100/30102 | SDA 21, SCL 22 |
| NEO-6M | GPS TX → GPIO 16, GPS RX → GPIO 17 |
| GP2Y1014AU LED pin 3 | GPIO 27 (active-low pulse) |
| GP2Y1014AU Vo pin 5 | GPIO 33 through a 1:1 voltage divider |
| MQ-135 analog output | GPIO 34 through a voltage divider |
| Battery measurement | GPIO 35 through a voltage divider |
| Solar measurement | GPIO 32 through a voltage divider |
| Active 5 V buzzer | `+` to 5 V; `-` to NPN collector; NPN emitter to GND; GPIO 25 through 1 kΩ to NPN base; 10 kΩ from base to GND |

On first boot, connect a phone/computer to the Wi‑Fi network `SurakshaWatch-2048`; the captive portal opens so the ESP32 can be assigned the same 2.4 GHz Wi‑Fi network as this computer. Credentials are stored on the ESP32, not in source code.

The live I²C probe found only address `0x57` (MAX3010x). No I²C accelerometer appeared at `0x68/0x69`, so firmware reports motion as `unavailable` rather than fabricating a normal state. Add the exact accelerometer driver after verifying its model and wiring.

## API

- `POST /api/telemetry` — ESP32 ingestion; requires `x-device-key`.
- `GET /api/telemetry` — latest PostgreSQL reading and connection state.
- `GET /api/history?hours=1440` — up to 60 days of stored readings.
- `GET/PUT /api/thresholds` — safety policy persisted in PostgreSQL.
- `GET/PUT /api/device` — device-to-worker assignment.
- `GET/POST /api/visits` — persisted health-worker visits.

Risk is calculated by the backend from saved thresholds. Critical readings create immutable alert records and the response tells the ESP32 when to activate its buzzer. Firmware 1.6.0 keeps the buzzer off at boot and during Wi-Fi/backend failures. A valid heart rate must confirm that the watch is being worn; when the risk score first crosses 75, the buzzer sounds for 1.2 seconds and is re-armed only after the score falls below 75.

## Electrical cautions

ESP32 GPIOs are 3.3 V only. The GP2Y1014AU requires 5 V, a 150 Ω LED resistor, a 220 µF capacitor, and a voltage divider on Vo before GPIO33. Its pins are 1 V-LED, 2 LED-GND, 3 LED, 4 S-GND, 5 Vo, 6 Vcc. Drive the 5 V buzzer through a transistor/MOSFET and keep the ESP32 and buzzer-supply grounds common. If it is a magnetic buzzer, add a flyback diode across it (cathode to 5 V, anode to the transistor collector). Never connect the buzzer directly between 5 V and GND or connect 5 V to an ESP32 GPIO. TP4056 is a single-cell charger: two 18650 cells require a correct protected parallel arrangement or a proper 2S BMS/charger if wired in series. ADC voltage-divider ratios, the GP2Y clean-air offset, and the MQ-135 `R0` calibration constant in firmware must match the real circuit before readings are treated as calibrated measurements.
