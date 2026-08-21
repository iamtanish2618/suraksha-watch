#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <TinyGPS++.h>
#include <MAX30105.h>
#include <spo2_algorithm.h>
#include <Preferences.h>
#include "secrets.h"

// Change only these constants if your wiring differs.
constexpr int I2C_SDA=21,I2C_SCL=22;
constexpr int GPS_RX=16,GPS_TX=17;
constexpr int DUST_LED_PIN=27,DUST_ANALOG_PIN=33;
constexpr int MQ135_PIN=34,BATTERY_PIN=35,SOLAR_PIN=32,BUZZER_PIN=25;
constexpr int CONFIG_BUTTON_PIN=0;
// GPIO25 drives the base of an external NPN low-side switch. Do not connect a
// 5 V buzzer directly to the ESP32 pin.
constexpr bool BUZZER_ENABLED=true;
constexpr uint8_t BUZZER_ACTIVE_LEVEL=HIGH;
constexpr unsigned long BUZZER_BEEP_MS=1200;
constexpr int ALERT_RISK_THRESHOLD=75;
constexpr float ADC_DIVIDER_RATIO=2.0f; // 100k/100k divider; never feed >3.3V into an ESP32 ADC.
constexpr float DUST_ADC_DIVIDER_RATIO=1.0f; // GP2Y Vo is connected directly to GPIO33 in this build.
constexpr float MQ_ADC_DIVIDER_RATIO=1.0f; // MQ module AOUT is connected directly in this build.
constexpr float DUST_CLEAN_AIR_VOLTAGE=0.60f; // Sharp typical Voc; calibrate per individual sensor.
constexpr float DUST_SENSITIVITY=0.50f; // V per 100 ug/m3, Sharp typical value.
constexpr float MQ_LOAD_KOHM=10.0f,MQ_CIRCUIT_VOLTAGE=5.0f;
constexpr float MQ_CURVE_A=116.6020682f,MQ_CURVE_B=-2.769034857f;
constexpr uint8_t MQ_CALIBRATION_SAMPLES=12; // One clean-air minute at the 5-second post interval.
constexpr unsigned long POST_INTERVAL_MS=5000;

HardwareSerial gpsSerial(1); TinyGPSPlus gps; MAX30105* maxSensor=nullptr;
WiFiManager wifiManager; Preferences preferences; WiFiManagerParameter* backendParameter=nullptr;
char backendUrl[160]={0}; unsigned int postFailures=0; bool forceConfigPortal=false;
bool maxReady=false,dustValid=false,pulseDetected=false; float pm25=NAN,dustVoltage=NAN,heartRate=NAN,spo2=NAN,ax=NAN,ay=NAN,az=NAN;
float mqR0=NAN,mqResistanceSum=0;uint8_t mqCalibrationCount=0;
uint16_t dustRaw=0,dustSamples=0;float dustVoltageSum=0;
uint32_t irBuffer[100],redBuffer[100];uint16_t maxSamples=0;unsigned long lastHealthCalc=0;
unsigned long lastPost=0,lastFall=0,lastMotion=0; String motion="unavailable";
unsigned long lastDustSampleMicros=0;
unsigned long buzzerOffAt=0;bool buzzerOn=false,alertActive=false;

void setBuzzer(bool on){
  if(!BUZZER_ENABLED)return;
  buzzerOn=on;
  digitalWrite(BUZZER_PIN,on?BUZZER_ACTIVE_LEVEL:!BUZZER_ACTIVE_LEVEL);
  if(!on)buzzerOffAt=0;
}
void triggerBuzzer(){setBuzzer(true);buzzerOffAt=millis()+BUZZER_BEEP_MS;}
void serviceBuzzer(){if(buzzerOn&&(int32_t)(millis()-buzzerOffAt)>=0)setBuzzer(false);}
void updateBuzzerAlert(bool alertNow){
  if(!BUZZER_ENABLED)return;
  if(alertNow&&!alertActive)triggerBuzzer();
  if(!alertNow)setBuzzer(false);
  alertActive=alertNow;
}
void clearBuzzerAlert(){alertActive=false;setBuzzer(false);}

float readVoltage(int pin,float dividerRatio=ADC_DIVIDER_RATIO){uint32_t millivolts=0;for(int i=0;i<16;i++){millivolts+=analogReadMilliVolts(pin);delayMicroseconds(100);}return millivolts/16.0f/1000.0f*dividerRatio;}
float batteryPercent(float volts){return constrain((volts-3.20f)/(4.20f-3.20f)*100.0f,0.0f,100.0f);}
float mqResistance(float outputVolts){if(outputVolts<0.05f||outputVolts>=MQ_CIRCUIT_VOLTAGE-0.05f)return NAN;return (MQ_CIRCUIT_VOLTAGE/outputVolts-1.0f)*MQ_LOAD_KOHM;}
float calibratedGasEquivalent(float resistance){
  if(isnan(resistance))return NAN;
  if(isnan(mqR0)){
    mqResistanceSum+=resistance;mqCalibrationCount++;
    if(mqCalibrationCount>=MQ_CALIBRATION_SAMPLES){mqR0=mqResistanceSum/mqCalibrationCount;preferences.putFloat("mqR0",mqR0);preferences.putUInt("mqCalVersion",1);Serial.printf("MQ135_CALIBRATED_R0=%.3fkOhm\n",mqR0);}
    return NAN;
  }
  float cleanAirCurve=MQ_CURVE_A;float estimate=MQ_CURVE_A*pow(resistance/mqR0,MQ_CURVE_B)-cleanAirCurve;
  return constrain(estimate,0.0f,1000.0f);
}

void readDust(){
  if((uint32_t)(micros()-lastDustSampleMicros)<10000)return;
  lastDustSampleMicros=micros();digitalWrite(DUST_LED_PIN,LOW);delayMicroseconds(280);
  dustRaw=analogRead(DUST_ANALOG_PIN);float sampleVoltage=analogReadMilliVolts(DUST_ANALOG_PIN)/1000.0f*DUST_ADC_DIVIDER_RATIO;
  delayMicroseconds(40);digitalWrite(DUST_LED_PIN,HIGH);
  if(sampleVoltage>0.03f&&sampleVoltage<4.8f){dustVoltageSum+=sampleVoltage;dustSamples++;}
  if(dustSamples>=64){dustVoltage=dustVoltageSum/dustSamples;pm25=max(0.0f,(dustVoltage-DUST_CLEAN_AIR_VOLTAGE)*100.0f/DUST_SENSITIVITY);dustValid=true;dustVoltageSum=0;dustSamples=0;}
}
void readGps(){while(gpsSerial.available())gps.encode(gpsSerial.read());}
void readHealth(){if(!maxReady||maxSensor==nullptr){pulseDetected=false;return;}maxSensor->check();while(maxSensor->available()){uint32_t red=maxSensor->getRed(),ir=maxSensor->getIR();pulseDetected=ir>50000;maxSensor->nextSample();if(maxSamples<100){redBuffer[maxSamples]=red;irBuffer[maxSamples]=ir;maxSamples++;}else{for(int i=1;i<100;i++){redBuffer[i-1]=redBuffer[i];irBuffer[i-1]=irBuffer[i];}redBuffer[99]=red;irBuffer[99]=ir;}if(maxSamples==100&&millis()-lastHealthCalc>=1000){lastHealthCalc=millis();int32_t calcSpO2=0,calcHeartRate=0;int8_t validSpO2=0,validHeartRate=0;maxim_heart_rate_and_oxygen_saturation(irBuffer,100,redBuffer,&calcSpO2,&validSpO2,&calcHeartRate,&validHeartRate);heartRate=(pulseDetected&&validHeartRate&&calcHeartRate>=35&&calcHeartRate<=220)?calcHeartRate:NAN;spo2=(pulseDetected&&validSpO2&&calcSpO2>=70&&calcSpO2<=100)?calcSpO2:NAN;}}}
void readMotion(){ax=ay=az=NAN;motion="unavailable";}
void addFloatOrNull(JsonDocument& doc,const char* key,float number){if(isnan(number))doc[key]=nullptr;else doc[key]=roundf(number*100.0f)/100.0f;}
void savePortalParameters(){if(backendParameter==nullptr)return;String value=backendParameter->getValue();value.trim();if(value.startsWith("http://")||value.startsWith("https://")){value.toCharArray(backendUrl,sizeof(backendUrl));preferences.putString("backend",value);Serial.printf("BACKEND_SAVED=%s\n",backendUrl);}}

void postTelemetry(){
  if(WiFi.status()!=WL_CONNECTED){clearBuzzerAlert();return;}
  float batteryVoltage=readVoltage(BATTERY_PIN),solarVoltage=readVoltage(SOLAR_PIN),mqVoltage=readVoltage(MQ135_PIN,MQ_ADC_DIVIDER_RATIO);int gasRaw=analogRead(MQ135_PIN);float mqRs=mqResistance(mqVoltage);float gasPpm=calibratedGasEquivalent(mqRs);
  JsonDocument doc;doc["deviceId"]=DEVICE_ID;doc["firmwareVersion"]="1.6.0";doc["particleSensor"]="GP2Y1014AU mixed particulate";doc["pulseDetected"]=pulseDetected;addFloatOrNull(doc,"pm25",dustValid?pm25:NAN);doc["pm10"]=nullptr;doc["dustRaw"]=dustRaw;addFloatOrNull(doc,"dustVoltage",dustValid?dustVoltage:NAN);addFloatOrNull(doc,"gasPpm",gasPpm);doc["gasRaw"]=gasRaw;addFloatOrNull(doc,"heartRate",heartRate);addFloatOrNull(doc,"spo2",spo2);doc["gpsValid"]=gps.location.isValid()&&gps.location.age()<10000;if(doc["gpsValid"]){doc["latitude"]=gps.location.lat();doc["longitude"]=gps.location.lng();}else{doc["latitude"]=nullptr;doc["longitude"]=nullptr;}doc["batteryVoltage"]=batteryVoltage;doc["batteryPct"]=batteryPercent(batteryVoltage);doc["solarVoltage"]=solarVoltage;doc["motion"]="unavailable";doc["accelX"]=nullptr;doc["accelY"]=nullptr;doc["accelZ"]=nullptr;
  Serial.printf("GP2Y1014AU raw=%u Vo=%.3fV mixed=%.1fug/m3 valid=%s\n",dustRaw,dustVoltage,pm25,dustValid?"yes":"no");Serial.printf("MQ135 raw=%d Vo=%.3fV Rs=%.3fk R0=%.3fk equivalent=%.1fppm calibrated=%s\n",gasRaw,mqVoltage,mqRs,mqR0,gasPpm,isnan(mqR0)?"no":"yes");
  String payload;serializeJson(doc,payload);HTTPClient http;http.setTimeout(3000);http.begin(backendUrl);http.addHeader("Content-Type","application/json");http.addHeader("x-device-key",DEVICE_API_KEY);int code=http.POST(payload);String response=http.getString();Serial.printf("POST %d %s\n",code,response.c_str());if(code>=200&&code<300){postFailures=0;JsonDocument reply;if(deserializeJson(reply,response)==DeserializationError::Ok){int risk=reply["riskScore"]|0;bool wearing=reply["wearing"]|false;updateBuzzerAlert(wearing&&(risk>=ALERT_RISK_THRESHOLD||motion=="fall"));}else clearBuzzerAlert();}else{postFailures++;clearBuzzerAlert();}http.end();
  if(postFailures>=6){Serial.println("BACKEND_OFFLINE_STARTING_SETUP_PORTAL");postFailures=0;wifiManager.setConfigPortalTimeout(300);wifiManager.startConfigPortal("SurakshaWatch-2048");}
}

void setup(){
  pinMode(CONFIG_BUTTON_PIN,INPUT_PULLUP);forceConfigPortal=digitalRead(CONFIG_BUTTON_PIN)==LOW;Serial.begin(115200);delay(2000);Serial.println("SURAKSHA_BOOT");Serial.flush();digitalWrite(BUZZER_PIN,!BUZZER_ACTIVE_LEVEL);pinMode(BUZZER_PIN,OUTPUT);setBuzzer(false);pinMode(DUST_LED_PIN,OUTPUT);digitalWrite(DUST_LED_PIN,HIGH);pinMode(DUST_ANALOG_PIN,INPUT);analogReadResolution(12);analogSetPinAttenuation(DUST_ANALOG_PIN,ADC_11db);analogSetPinAttenuation(MQ135_PIN,ADC_11db);analogSetPinAttenuation(BATTERY_PIN,ADC_11db);analogSetPinAttenuation(SOLAR_PIN,ADC_11db);Wire.begin(I2C_SDA,I2C_SCL);Wire.setTimeOut(50);gpsSerial.begin(9600,SERIAL_8N1,GPS_RX,GPS_TX);
  Serial.println("ACCELEROMETER=NOT_FOUND_BY_I2C_SCAN");Serial.println("INIT_MAX30102");Serial.flush();maxSensor=new MAX30105();maxReady=maxSensor->begin(Wire,I2C_SPEED_FAST);if(maxReady){maxSensor->setup(60,4,2,100,411,4096);maxSensor->setPulseAmplitudeGreen(0);}
  Serial.printf("MAX30102=%s\n",maxReady?"OK":"NOT_FOUND");Serial.flush();preferences.begin("suraksha",false);if(preferences.getUInt("mqCalVersion",0)==1)mqR0=preferences.getFloat("mqR0",NAN);uint32_t configVersion=preferences.getUInt("configVersion",0);String storedBackend=configVersion<2?String(API_URL):preferences.getString("backend",API_URL);if(configVersion<2){preferences.putString("backend",storedBackend);preferences.putUInt("configVersion",2);}storedBackend.toCharArray(backendUrl,sizeof(backendUrl));backendParameter=new WiFiManagerParameter("backend","Backend telemetry URL",backendUrl,159);wifiManager.addParameter(backendParameter);wifiManager.setSaveParamsCallback(savePortalParameters);wifiManager.setConfigPortalTimeout(300);WiFi.mode(WIFI_STA);if(forceConfigPortal){Serial.println("BOOT_BUTTON_STARTING_SETUP_PORTAL");wifiManager.startConfigPortal("SurakshaWatch-2048");}else if(!wifiManager.autoConnect("SurakshaWatch-2048")){Serial.println("WiFi setup timed out; restarting");delay(2000);ESP.restart();}savePortalParameters();Serial.print("WiFi connected: ");Serial.println(WiFi.localIP());Serial.printf("Backend: %s\n",backendUrl);
}
void loop(){serviceBuzzer();readGps();readDust();readHealth();if(millis()-lastMotion>100){lastMotion=millis();readMotion();}if(millis()-lastPost>=POST_INTERVAL_MS){lastPost=millis();postTelemetry();}delay(1);}
