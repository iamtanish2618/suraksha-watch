#include <Wire.h>

void setup() {
  Serial.begin(115200);
  delay(1000);
  Wire.begin(21, 22);
}

void loop() {
  Serial.println("I2C_SCAN_BEGIN");
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.printf("I2C_DEVICE=0x%02X\n", address);
    }
  }
  Serial.println("I2C_SCAN_END");
  delay(3000);
}
