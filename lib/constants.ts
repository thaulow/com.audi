// Audi Connect API Constants

import type { Region } from './types';

// Region to BFF domain mapping
export const BFF_DOMAINS: Record<Region, string> = {
  DE: 'emea.bff.cariad.digital',
  US: 'na.bff.cariad.digital',
  CA: 'na.bff.cariad.digital',
  CN: 'emea.bff.cariad.digital',
};

// Region to GraphQL domain mapping
export const GRAPHQL_DOMAINS: Record<Region, string> = {
  DE: 'app-api.live-my.audi.com',
  US: 'app-api.my.aoa.audi.com',
  CA: 'app-api.my.aoa.audi.com',
  CN: 'app-api.live-my.audi.com',
};

// VW Group API defaults
export const VW_HOME_REGION_READER = 'msg.volkswagen.de';
export const VW_HOME_REGION_SETTER = 'mal-1a.prd.ece.vwg-connect.com';
export const VW_API_LEVEL1_HOST = 'mal-3a.prd.eu.dp.vwg-connect.com';

// MBB OAuth
export const MBB_OAUTH_HOST = 'mbboauth-1d.prd.ece.vwg-connect.com';
export const MBB_CLIENT_ID = '09b6cbec-cd19-4589-82fd-363dfa8c24da@apps_vw-dilab_com';

// Identity
export const IDK_HOST = 'identity.vwgroup.io';

// Market config
export const MARKET_CONFIG_URL = 'https://content.app.my.audi.com/service/mobileapp/configurations/market';

// App info (mimics the Android app)
export const APP_VERSION = '4.31.0';
export const APP_NAME = 'myAudi';
export const USER_AGENT = `Android/${APP_VERSION} (Google;Pixel 6;Android/13) mobile`;
export const X_APP_VERSION = APP_VERSION;
export const X_APP_NAME = APP_NAME;

// Client IDs per region
export const CLIENT_IDS: Record<Region, string> = {
  DE: '77869e21-e30a-4a92-b016-48ab7d3db1d8',
  US: 'b7531de0-3571-4b85-af8e-7b54565b7788',
  CA: 'b7531de0-3571-4b85-af8e-7b54565b7788',
  CN: '77869e21-e30a-4a92-b016-48ab7d3db1d8',
};

// PKCE
export const PKCE_CODE_VERIFIER_LENGTH = 64;

// Scopes
export const IDK_SCOPES = 'openid profile birthdate nickname address phone email';
export const AZS_SCOPES = 'sc2:fal';

// Polling
export const ACTION_POLL_INTERVAL = 10000; // 10 seconds
export const ACTION_POLL_MAX_RETRIES = 10;
export const DEFAULT_SCAN_INTERVAL = 15; // minutes
export const MIN_SCAN_INTERVAL = 5; // minutes
export const TOKEN_REFRESH_BUFFER = 300; // 5 minutes before expiry

// X-QMAuth secret (from HA integration)
export const QMAUTH_SECRET = Buffer.from(
  'MjU3MDkxNTcyMjkzODg1NTMwNTQzNDIxMDk4NTY4MjU',
  'base64'
).toString();

// Selective status job names (Cariad BFF)
export const STATUS_JOBS = [
  'access',
  'charging',
  'climatisation',
  'fuelStatus',
  'measurements',
  'vehicleHealthInspection',
  'vehicleLights',
  'departureTimers',
] as const;

// VW Group API brands/countries
export const BRAND = 'audi';
export const COUNTRY_MAP: Record<Region, string> = {
  DE: 'DE',
  US: 'US',
  CA: 'CA',
  CN: 'CN',
};

// Vehicle data field IDs (hex - for legacy VW API)
export const FIELD_IDS = {
  UTC_TIME_AND_KILOMETER_STATUS: '0x0101010002',
  MAINTENANCE_INTERVAL_DISTANCE_TO_OIL_CHANGE: '0x0301010001',
  MAINTENANCE_INTERVAL_TIME_TO_OIL_CHANGE: '0x0301010002',
  MAINTENANCE_INTERVAL_DISTANCE_TO_INSPECTION: '0x0301020001',
  MAINTENANCE_INTERVAL_TIME_TO_INSPECTION: '0x0301020002',
  OIL_LEVEL_DIPSTICKS_PERCENTAGE: '0x0204040003',
  DOOR_STATE_LEFT_FRONT: '0x0301040001',
  DOOR_STATE_LEFT_REAR: '0x0301040004',
  DOOR_STATE_RIGHT_FRONT: '0x0301040002',
  DOOR_STATE_RIGHT_REAR: '0x0301040008',
  DOOR_STATE_TRUNK: '0x030104000E',
  DOOR_STATE_HOOD: '0x0301040011',
  WINDOW_STATE_LEFT_FRONT: '0x0301050001',
  WINDOW_STATE_LEFT_REAR: '0x0301050003',
  WINDOW_STATE_RIGHT_FRONT: '0x0301050002',
  WINDOW_STATE_RIGHT_REAR: '0x0301050004',
  WINDOW_STATE_SUN_ROOF: '0x030105000B',
  LOCK_STATE_LEFT_FRONT: '0x0301040002',
  LOCK_STATE_ANY: '0x0301040001',
  FUEL_LEVEL: '0x030103000A',
  FUEL_RANGE: '0x0301030006',
  ADBLUE_RANGE: '0x02040C0001',
  PARKING_LIGHT: '0x0301010001',
  TANK_LEVEL_PERCENT: '0x030103000A',
} as const;
