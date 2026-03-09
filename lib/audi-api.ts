// Audi Connect API Client
// Handles vehicle data fetching and action execution

import {
  ACTION_POLL_INTERVAL,
  ACTION_POLL_MAX_RETRIES,
  BRAND,
  COUNTRY_MAP,
  GRAPHQL_DOMAINS,
  STATUS_JOBS,
  USER_AGENT,
  VW_HOME_REGION_READER,
  X_APP_NAME,
  X_APP_VERSION,
} from './constants';
import { AudiAuth, generateQMAuth } from './audi-auth';
import type {
  ClimateOptions,
  FeatureSupport,
  Region,
  VehicleAction,
  VehicleInfo,
  VehicleStatus,
} from './types';

export class AudiApi {
  private auth: AudiAuth;
  private region: Region;
  private homeRegions: Map<string, string> = new Map();
  private featureSupport: Map<string, FeatureSupport> = new Map();

  constructor(auth: AudiAuth, region: Region) {
    this.auth = auth;
    this.region = region;
  }

  /**
   * Standard request headers
   */
  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.auth.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'X-App-Version': X_APP_VERSION,
      'X-App-Name': X_APP_NAME,
      'X-QMAuth': generateQMAuth(),
    };
  }

  /**
   * MBB request headers for legacy VW API
   */
  private async getMbbHeaders(): Promise<Record<string, string>> {
    const token = await this.auth.getMbbAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
      'X-App-Version': X_APP_VERSION,
      'X-App-Name': X_APP_NAME,
    };
  }

  // ==========================================
  // Vehicle Discovery
  // ==========================================

  /**
   * Get list of vehicles from the GraphQL API
   */
  async getVehicles(): Promise<VehicleInfo[]> {
    const domain = GRAPHQL_DOMAINS[this.region];
    const headers = await this.getHeaders();

    const query = `
      query {
        userVehicles {
          vin
          csid
          commissionNumber
          type
          devicePlatform
          nickname
          specifications {
            title
            modelYear
            body {
              modelFamily
              type
            }
            engine {
              type
            }
          }
          media {
            shortName
            url
          }
        }
      }
    `;

    const response = await fetch(`https://${domain}/vgql/v1/graphql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch vehicles: ${response.status}`);
    }

    const data = await response.json() as any;
    const vehicles = data?.data?.userVehicles || [];

    return vehicles.map((v: any) => ({
      vin: v.vin,
      csid: v.csid || '',
      nickname: v.nickname || '',
      model: v.specifications?.title || '',
      modelYear: v.specifications?.modelYear || '',
      modelFamily: v.specifications?.body?.modelFamily || '',
      carType: v.specifications?.body?.type || '',
      engineType: v.specifications?.engine?.type || '',
      imageUrl: v.media?.[0]?.url,
    }));
  }

  // ==========================================
  // Vehicle Home Region
  // ==========================================

  /**
   * Discover the home region for a specific VIN
   */
  private async getHomeRegion(vin: string): Promise<string> {
    if (this.homeRegions.has(vin)) {
      return this.homeRegions.get(vin)!;
    }

    try {
      const headers = await this.getMbbHeaders();
      const response = await fetch(
        `https://${VW_HOME_REGION_READER}/api/cs/vds/v1/vehicles/${vin}/homeRegion`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json() as any;
        const uri = data?.homeRegion?.baseUri?.content;
        if (uri) {
          const host = new URL(uri).host;
          this.homeRegions.set(vin, host);
          return host;
        }
      }
    } catch {
      // Fall through to default
    }

    this.homeRegions.set(vin, VW_HOME_REGION_READER);
    return VW_HOME_REGION_READER;
  }

  // ==========================================
  // Vehicle Status (Cariad BFF - API Level 1)
  // ==========================================

  /**
   * Fetch selective vehicle status from Cariad BFF
   */
  async getVehicleStatus(vin: string): Promise<VehicleStatus> {
    const status: VehicleStatus = {};
    const support = this.getOrCreateFeatureSupport(vin);

    // Fetch selective status (main data source)
    if (support.statusReport) {
      try {
        const data = await this.fetchSelectiveStatus(vin);
        this.parseSelectiveStatus(data, status);
      } catch (error: any) {
        if (error.status === 403 || error.status === 404) {
          support.statusReport = false;
        }
        // Fall back to legacy API attempted below
      }
    }

    // Fetch parking position
    if (support.position) {
      try {
        const posData = await this.fetchParkingPosition(vin);
        this.parseParkingPosition(posData, status);
      } catch (error: any) {
        if (error.status === 403 || error.status === 404) {
          support.position = false;
        }
        // 204 means vehicle is moving
        if (error.status === 204) {
          status.latitude = undefined;
          status.longitude = undefined;
        }
      }
    }

    return status;
  }

  /**
   * Fetch selective status from Cariad BFF
   */
  private async fetchSelectiveStatus(vin: string): Promise<any> {
    const bffDomain = this.auth.getBffDomain();
    const headers = await this.getHeaders();
    const jobs = STATUS_JOBS.join(',');

    const response = await fetch(
      `https://${bffDomain}/vehicle/v1/vehicles/${vin}/selectivestatus?jobs=${jobs}`,
      { headers }
    );

    if (!response.ok) {
      const error: any = new Error(`Selective status failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  /**
   * Parse selective status response into VehicleStatus
   */
  private parseSelectiveStatus(data: any, status: VehicleStatus): void {
    // Access status (doors, windows, locks)
    const access = data?.access;
    if (access) {
      const accessStatus = access?.accessStatus?.value;
      if (accessStatus) {
        // Doors
        const doors = accessStatus.doors?.value || [];
        status.anyDoorOpen = doors.some((d: any) => d.status?.value?.includes('open'));
        status.anyDoorUnlocked = doors.some((d: any) => d.status?.value?.includes('unlock'));

        for (const door of doors) {
          const name = door.name?.value;
          const isOpen = door.status?.value?.includes('open');
          const isLocked = door.status?.value?.includes('locked');
          switch (name) {
            case 'frontLeft': status.doorLeftFrontOpen = isOpen; break;
            case 'frontRight': status.doorRightFrontOpen = isOpen; break;
            case 'rearLeft': status.doorLeftRearOpen = isOpen; break;
            case 'rearRight': status.doorRightRearOpen = isOpen; break;
            case 'trunk': status.trunkOpen = isOpen; break;
            case 'hood': status.hoodOpen = isOpen; break;
          }
        }

        // Lock overall state
        const overallStatus = accessStatus.overallStatus?.value;
        status.locked = overallStatus === 'safe';

        // Windows
        const windows = accessStatus.windows?.value || [];
        status.anyWindowOpen = windows.some((w: any) => w.status?.value?.includes('open'));
        for (const win of windows) {
          const name = win.name?.value;
          const isOpen = win.status?.value?.includes('open');
          switch (name) {
            case 'frontLeft': status.windowLeftFrontOpen = isOpen; break;
            case 'frontRight': status.windowRightFrontOpen = isOpen; break;
            case 'rearLeft': status.windowLeftRearOpen = isOpen; break;
            case 'rearRight': status.windowRightRearOpen = isOpen; break;
            case 'sunRoof': status.sunRoofOpen = isOpen; break;
          }
        }
      }
    }

    // Charging status
    const charging = data?.charging;
    if (charging) {
      const batteryStatus = charging?.batteryStatus?.value;
      if (batteryStatus) {
        status.stateOfCharge = batteryStatus.currentSOC_pct?.value;
        status.range = batteryStatus.cruisingRangeElectric_km?.value;
      }

      const chargingStatus = charging?.chargingStatus?.value;
      if (chargingStatus) {
        status.chargingState = chargingStatus.chargingState?.value;
        status.chargingPower = chargingStatus.chargePower_kW?.value;
        status.chargingRate = chargingStatus.chargeRate_kmph?.value;
        status.remainingChargingTime = chargingStatus.remainingChargingTimeToComplete_min?.value;
      }

      const plugStatus = charging?.plugStatus?.value;
      if (plugStatus) {
        status.plugState = plugStatus.plugConnectionState?.value;
        status.plugLockState = plugStatus.plugLockState?.value;
      }

      const chargeSettings = charging?.chargingSettings?.value;
      if (chargeSettings) {
        status.targetSoc = chargeSettings.targetSOC_pct?.value;
      }
    }

    // Climatisation
    const climatisation = data?.climatisation;
    if (climatisation) {
      const climaStatus = climatisation?.climatisationStatus?.value;
      if (climaStatus) {
        status.climatisationState = climaStatus.climatisationState?.value;
        status.remainingClimatisationTime = climaStatus.remainingClimatisationTime_min?.value;
      }
    }

    // Fuel status
    const fuel = data?.fuelStatus;
    if (fuel) {
      const rangeStatus = fuel?.rangeStatus?.value;
      if (rangeStatus) {
        const primary = rangeStatus.primaryEngine;
        const secondary = rangeStatus.secondaryEngine;

        if (primary) {
          status.fuelLevel = primary.currentFuelLevel_pct?.value;
          if (!status.range) {
            status.range = primary.remainingRange_km?.value;
          }
        }
        if (secondary) {
          if (!status.stateOfCharge) {
            status.stateOfCharge = secondary.currentSOC_pct?.value;
          }
        }
      }
    }

    // Measurements (odometer, temperature, etc.)
    const measurements = data?.measurements;
    if (measurements) {
      const odometerStatus = measurements?.odometerStatus?.value;
      if (odometerStatus) {
        status.mileage = odometerStatus.odometer?.value;
      }

      const tempStatus = measurements?.temperatureMeasurementStatus?.value;
      if (tempStatus) {
        // API returns Kelvin, convert to Celsius
        const tempK = tempStatus.outdoorTemperature?.value;
        if (tempK !== undefined) {
          status.outdoorTemperature = Math.round((tempK - 273.15) * 10) / 10;
        }
      }
    }

    // Vehicle health
    const health = data?.vehicleHealthInspection;
    if (health) {
      const maintenanceStatus = health?.maintenanceStatus?.value;
      if (maintenanceStatus) {
        status.serviceInspectionDistance = maintenanceStatus.inspectionDue_km?.value;
        status.serviceInspectionTime = maintenanceStatus.inspectionDue_days?.value;
        status.oilChangeDistance = maintenanceStatus.oilServiceDue_km?.value;
        status.oilChangeTime = maintenanceStatus.oilServiceDue_days?.value;
      }
    }

    // Vehicle lights
    const lights = data?.vehicleLights;
    if (lights) {
      const lightStatus = lights?.lightsStatus?.value;
      if (lightStatus) {
        const allLights = lightStatus.lights?.value || [];
        status.parkingLightOn = allLights.some(
          (l: any) => l.name?.value === 'parkingLight' && l.status?.value === 'on'
        );
      }
    }
  }

  /**
   * Fetch parking position
   */
  private async fetchParkingPosition(vin: string): Promise<any> {
    const bffDomain = this.auth.getBffDomain();
    const headers = await this.getHeaders();

    const response = await fetch(
      `https://${bffDomain}/vehicle/v1/vehicles/${vin}/parkingposition`,
      { headers }
    );

    if (!response.ok) {
      const error: any = new Error(`Parking position failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  /**
   * Parse parking position response
   */
  private parseParkingPosition(data: any, status: VehicleStatus): void {
    if (data) {
      status.latitude = data.lat;
      status.longitude = data.lon;
      status.parkingTimestamp = data.carCapturedTimestamp;
    }
  }

  // ==========================================
  // Vehicle Actions
  // ==========================================

  /**
   * Execute a vehicle action
   */
  async executeAction(vin: string, action: VehicleAction): Promise<boolean> {
    const bffDomain = this.auth.getBffDomain();
    const headers = await this.getHeaders();

    let url: string;
    let method = 'POST';
    let body: any = undefined;
    let needsSpin = false;

    switch (action) {
      case 'lock':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/access/lock`;
        needsSpin = true;
        break;
      case 'unlock':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/access/unlock`;
        needsSpin = true;
        break;
      case 'start_climatisation':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/climatisation/start`;
        body = {
          targetTemperature_K: 295.15, // 22°C default
          heaterSource: 'electric',
        };
        break;
      case 'stop_climatisation':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/climatisation/stop`;
        break;
      case 'start_charger':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/charging/start`;
        break;
      case 'stop_charger':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/charging/stop`;
        break;
      case 'start_preheater':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/auxiliaryheating/start`;
        body = { duration_min: 30 };
        needsSpin = true;
        break;
      case 'stop_preheater':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/auxiliaryheating/stop`;
        break;
      case 'start_window_heating':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/climatisation/windowheating/start`;
        break;
      case 'stop_window_heating':
        url = `https://${bffDomain}/vehicle/v1/vehicles/${vin}/climatisation/windowheating/stop`;
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Handle S-PIN challenge if needed
    if (needsSpin) {
      const securityToken = await this.getSecurityToken(vin, action);
      if (securityToken) {
        headers['x-securityToken'] = securityToken;
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Action ${action} failed: ${response.status}`);
    }

    const responseData = await response.json() as any;
    const requestId = responseData?.requestId || responseData?.data?.requestID;

    // Poll for action completion
    if (requestId) {
      return this.pollActionStatus(vin, action, requestId);
    }

    return response.ok;
  }

  /**
   * Start climatisation with options
   */
  async startClimateControl(vin: string, options: ClimateOptions): Promise<boolean> {
    const bffDomain = this.auth.getBffDomain();
    const headers = await this.getHeaders();

    const tempK = options.temperatureC
      ? options.temperatureC + 273.15
      : 295.15;

    const body: any = {
      targetTemperature_K: tempK,
      heaterSource: 'electric',
    };

    if (options.glassHeating !== undefined) {
      body.climatisationWithoutExternalPower = true;
      body.frontWindowHeating = options.glassHeating;
      body.rearWindowHeating = options.glassHeating;
    }

    const response = await fetch(
      `https://${bffDomain}/vehicle/v1/vehicles/${vin}/climatisation/start`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      throw new Error(`Climate control start failed: ${response.status}`);
    }

    return true;
  }

  /**
   * Set target state of charge for EV
   */
  async setTargetSoc(vin: string, targetSoc: number): Promise<boolean> {
    const bffDomain = this.auth.getBffDomain();
    const headers = await this.getHeaders();

    // Clamp to valid range (20-100 in steps of 5)
    targetSoc = Math.max(20, Math.min(100, Math.round(targetSoc / 5) * 5));

    const response = await fetch(
      `https://${bffDomain}/vehicle/v1/vehicles/${vin}/charging/settings`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ targetSOC_pct: targetSoc }),
      }
    );

    if (!response.ok) {
      throw new Error(`Set target SOC failed: ${response.status}`);
    }

    return true;
  }

  /**
   * Request the vehicle to push fresh data to the cloud
   */
  async refreshVehicleData(vin: string): Promise<boolean> {
    const homeRegion = await this.getHomeRegion(vin);
    const headers = await this.getMbbHeaders();
    const country = COUNTRY_MAP[this.region];

    const response = await fetch(
      `https://${homeRegion}/fs-car/bs/vsr/v1/${BRAND}/${country}/vehicles/${vin}/requests`,
      {
        method: 'POST',
        headers,
      }
    );

    return response.ok;
  }

  // ==========================================
  // S-PIN Security
  // ==========================================

  /**
   * Get security token for S-PIN protected actions
   */
  private async getSecurityToken(vin: string, action: string): Promise<string | null> {
    const homeRegion = await this.getHomeRegion(vin);
    const headers = await this.getMbbHeaders();

    // Map action to service name
    const serviceMap: Record<string, string> = {
      lock: 'rlu_v1/operations/LOCK',
      unlock: 'rlu_v1/operations/UNLOCK',
      start_preheater: 'rheating_v1/operations/P_QSACT',
    };

    const service = serviceMap[action];
    if (!service) return null;

    // Request challenge
    const challengeUrl = `https://${homeRegion}/api/rolesrights/authorization/v2/vehicles/${vin}/services/${service}/security-pin-auth-requested`;

    const challengeResponse = await fetch(challengeUrl, {
      method: 'GET',
      headers,
    });

    if (!challengeResponse.ok) return null;

    const challengeData = await challengeResponse.json() as any;
    const challenge = challengeData?.securityPinAuthInfo?.securityPinTransmission?.challenge;
    const retryCounter = challengeData?.securityPinAuthInfo?.securityPinTransmission?.retryCounter;

    if (!challenge) return null;

    // Calculate hash
    const hash = await this.auth.calculateSpinHash(challenge);

    // Submit response
    const completeUrl = `https://${homeRegion}/api/rolesrights/authorization/v2/vehicles/${vin}/services/${service}/security-pin-auth-completed`;

    const completeResponse = await fetch(completeUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        securityPinAuthentication: {
          securityPin: {
            challenge: challenge,
            securityPinHash: hash,
          },
          retryCounter: retryCounter,
        },
      }),
    });

    if (!completeResponse.ok) return null;

    return completeResponse.headers.get('x-securityToken') || null;
  }

  // ==========================================
  // Action Polling
  // ==========================================

  /**
   * Poll for action completion status
   */
  private async pollActionStatus(
    vin: string,
    action: string,
    requestId: string
  ): Promise<boolean> {
    const bffDomain = this.auth.getBffDomain();

    for (let i = 0; i < ACTION_POLL_MAX_RETRIES; i++) {
      await this.sleep(ACTION_POLL_INTERVAL);

      const headers = await this.getHeaders();

      try {
        const response = await fetch(
          `https://${bffDomain}/vehicle/v1/vehicles/${vin}/pendingrequests`,
          { headers }
        );

        if (response.ok) {
          const data = await response.json() as any;
          const requests = data?.data || [];
          const request = requests.find((r: any) => r.id === requestId);

          if (!request) {
            // Request not found in pending = completed
            return true;
          }

          const reqStatus = request.status?.toLowerCase();
          if (reqStatus === 'request_successful' || reqStatus === 'succeeded') {
            return true;
          }
          if (reqStatus === 'request_failed' || reqStatus === 'failed') {
            return false;
          }
        }
      } catch {
        // Continue polling
      }
    }

    return false;
  }

  // ==========================================
  // Helpers
  // ==========================================

  private getOrCreateFeatureSupport(vin: string): FeatureSupport {
    if (!this.featureSupport.has(vin)) {
      this.featureSupport.set(vin, {
        position: true,
        climater: true,
        charger: true,
        preheater: true,
        tripData: true,
        statusReport: true,
        windowHeating: true,
      });
    }
    return this.featureSupport.get(vin)!;
  }

  getFeatureSupport(vin: string): FeatureSupport {
    return this.getOrCreateFeatureSupport(vin);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
