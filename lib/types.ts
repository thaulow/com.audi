// Audi Connect API Types

export type Region = 'DE' | 'US' | 'CA' | 'CN';

export interface AudiCredentials {
  username: string;
  password: string;
  spin: string;
  region: Region;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
}

export interface MbbTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthTokens {
  idk: TokenSet;
  azs: TokenSet;
  mbb: MbbTokenSet;
}

export interface VehicleInfo {
  vin: string;
  csid: string;
  nickname: string;
  model: string;
  modelYear: string;
  modelFamily: string;
  carType: string;
  engineType: string;
  imageUrl?: string;
}

export interface VehicleStatus {
  // Odometer & range
  mileage?: number;
  range?: number;
  adblueRange?: number;

  // Fuel & oil
  fuelLevel?: number;
  oilLevel?: number;
  oilLevelWarning?: boolean;

  // Service
  serviceInspectionDistance?: number;
  serviceInspectionTime?: number;
  oilChangeDistance?: number;
  oilChangeTime?: number;

  // Doors
  anyDoorOpen?: boolean;
  anyDoorUnlocked?: boolean;
  doorLeftFrontOpen?: boolean;
  doorRightFrontOpen?: boolean;
  doorLeftRearOpen?: boolean;
  doorRightRearOpen?: boolean;
  trunkOpen?: boolean;
  hoodOpen?: boolean;

  // Windows
  anyWindowOpen?: boolean;
  windowLeftFrontOpen?: boolean;
  windowRightFrontOpen?: boolean;
  windowLeftRearOpen?: boolean;
  windowRightRearOpen?: boolean;
  sunRoofOpen?: boolean;

  // Lock
  locked?: boolean;

  // Charging (EV/PHEV)
  stateOfCharge?: number;
  chargingState?: string;
  chargingPower?: number;
  chargingRate?: number;
  remainingChargingTime?: number;
  targetSoc?: number;
  plugState?: string;
  plugLockState?: string;

  // Climate
  outdoorTemperature?: number;
  climatisationState?: string;
  remainingClimatisationTime?: number;

  // Position
  latitude?: number;
  longitude?: number;
  parkingTimestamp?: string;

  // Lights
  parkingLightOn?: boolean;

  // Preheater
  preheaterActive?: boolean;
  preheaterDuration?: number;
  preheaterRemaining?: number;

  // Misc
  lastUpdateTime?: string;
}

export type VehicleAction =
  | 'lock'
  | 'unlock'
  | 'start_climatisation'
  | 'stop_climatisation'
  | 'start_charger'
  | 'stop_charger'
  | 'start_preheater'
  | 'stop_preheater'
  | 'start_window_heating'
  | 'stop_window_heating';

export interface ClimateOptions {
  temperatureC?: number;
  glassHeating?: boolean;
  seatHeatingFrontLeft?: boolean;
  seatHeatingFrontRight?: boolean;
  seatHeatingRearLeft?: boolean;
  seatHeatingRearRight?: boolean;
}

export interface FeatureSupport {
  position: boolean;
  climater: boolean;
  charger: boolean;
  preheater: boolean;
  tripData: boolean;
  statusReport: boolean;
  windowHeating: boolean;
}

export interface ApiLevel {
  level: 0 | 1;
}
