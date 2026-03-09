import Homey from 'homey';
import { AudiAuth } from '../../lib/audi-auth';
import { AudiApi } from '../../lib/audi-api';
import type { Region, VehicleStatus } from '../../lib/types';
import { MIN_SCAN_INTERVAL } from '../../lib/constants';

class AudiVehicleDevice extends Homey.Device {

  private auth!: AudiAuth;
  private api!: AudiApi;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private vin!: string;

  async onInit() {
    this.log('Audi Vehicle device initializing...');

    const settings = this.getSettings();
    const store = this.getStore();
    this.vin = store.vin || settings.vin;

    if (!settings.username || !settings.password) {
      this.setUnavailable('Please configure credentials in device settings').catch(this.error);
      return;
    }

    // Initialize auth and API
    this.auth = new AudiAuth({
      username: settings.username,
      password: settings.password,
      spin: settings.spin || '',
      region: (settings.region as Region) || 'DE',
    });

    this.api = new AudiApi(this.auth, (settings.region as Region) || 'DE');

    // Register capability listeners for controllable features
    this.registerCapabilityListeners();

    // Initial data fetch
    try {
      await this.auth.login();
      await this.pollVehicleStatus();
      await this.setAvailable();
    } catch (error: any) {
      this.error('Initial login/poll failed:', error.message);
      this.setUnavailable('Login failed. Check credentials in device settings.').catch(this.error);
    }

    // Start polling
    this.startPolling();

    this.log(`Audi Vehicle device initialized: ${this.vin}`);
  }

  /**
   * Register listeners for settable capabilities
   */
  private registerCapabilityListeners() {
    // Lock/Unlock
    if (this.hasCapability('locked')) {
      this.registerCapabilityListener('locked', async (value: boolean) => {
        this.log(`Setting locked: ${value}`);
        const action = value ? 'lock' : 'unlock';
        try {
          const result = await this.api.executeAction(this.vin, action);
          if (!result) {
            throw new Error(`${action} action did not complete successfully`);
          }
          // Refresh status after action
          setTimeout(() => this.pollVehicleStatus().catch(this.error), 5000);
        } catch (error: any) {
          this.error(`${action} failed:`, error.message);
          throw new Error(`Failed to ${action} vehicle`);
        }
      });
    }

    // Climatisation
    if (this.hasCapability('climatisation_active')) {
      this.registerCapabilityListener('climatisation_active', async (value: boolean) => {
        this.log(`Setting climatisation: ${value}`);
        const action = value ? 'start_climatisation' : 'stop_climatisation';
        try {
          await this.api.executeAction(this.vin, action);
          setTimeout(() => this.pollVehicleStatus().catch(this.error), 5000);
        } catch (error: any) {
          this.error(`Climatisation ${action} failed:`, error.message);
          throw new Error(`Failed to ${value ? 'start' : 'stop'} climatisation`);
        }
      });
    }

    // Preheater
    if (this.hasCapability('preheater_active')) {
      this.registerCapabilityListener('preheater_active', async (value: boolean) => {
        this.log(`Setting preheater: ${value}`);
        const action = value ? 'start_preheater' : 'stop_preheater';
        try {
          await this.api.executeAction(this.vin, action);
          setTimeout(() => this.pollVehicleStatus().catch(this.error), 5000);
        } catch (error: any) {
          this.error(`Preheater ${action} failed:`, error.message);
          throw new Error(`Failed to ${value ? 'start' : 'stop'} auxiliary heater`);
        }
      });
    }

    // Window heating
    if (this.hasCapability('window_heating_active')) {
      this.registerCapabilityListener('window_heating_active', async (value: boolean) => {
        this.log(`Setting window heating: ${value}`);
        const action = value ? 'start_window_heating' : 'stop_window_heating';
        try {
          await this.api.executeAction(this.vin, action);
          setTimeout(() => this.pollVehicleStatus().catch(this.error), 5000);
        } catch (error: any) {
          this.error(`Window heating ${action} failed:`, error.message);
          throw new Error(`Failed to ${value ? 'start' : 'stop'} window heating`);
        }
      });
    }

    // Target SOC
    if (this.hasCapability('target_soc')) {
      this.registerCapabilityListener('target_soc', async (value: number) => {
        this.log(`Setting target SOC: ${value}%`);
        try {
          await this.api.setTargetSoc(this.vin, value);
          setTimeout(() => this.pollVehicleStatus().catch(this.error), 5000);
        } catch (error: any) {
          this.error('Set target SOC failed:', error.message);
          throw new Error('Failed to set target charge level');
        }
      });
    }
  }

  /**
   * Start the periodic polling interval
   */
  private startPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    const settings = this.getSettings();
    const intervalMinutes = Math.max(settings.poll_interval || 15, MIN_SCAN_INTERVAL);
    const intervalMs = intervalMinutes * 60 * 1000;

    this.log(`Starting polling every ${intervalMinutes} minutes`);

    this.pollInterval = setInterval(async () => {
      try {
        await this.pollVehicleStatus();
      } catch (error: any) {
        this.error('Poll failed:', error.message);
      }
    }, intervalMs);
  }

  /**
   * Fetch vehicle status and update all capabilities
   */
  async pollVehicleStatus() {
    this.log('Polling vehicle status...');

    try {
      const status = await this.api.getVehicleStatus(this.vin);
      await this.updateCapabilities(status);
      await this.setAvailable();
    } catch (error: any) {
      this.error('Failed to poll vehicle status:', error.message);

      // If auth error, try re-login
      if (error.message?.includes('401') || error.message?.includes('403')) {
        try {
          await this.auth.refreshTokens();
          const status = await this.api.getVehicleStatus(this.vin);
          await this.updateCapabilities(status);
          await this.setAvailable();
        } catch (retryError: any) {
          this.error('Retry after re-auth failed:', retryError.message);
          this.setUnavailable('Authentication failed').catch(this.error);
        }
      }
    }
  }

  /**
   * Update all device capabilities from vehicle status
   */
  private async updateCapabilities(status: VehicleStatus) {
    const updates: Array<[string, any]> = [];

    // Lock state
    if (status.locked !== undefined) updates.push(['locked', status.locked]);

    // Temperature
    if (status.outdoorTemperature !== undefined) updates.push(['measure_temperature', status.outdoorTemperature]);

    // Mileage & range
    if (status.mileage !== undefined) updates.push(['measure_mileage', status.mileage]);
    if (status.range !== undefined) updates.push(['measure_range', status.range]);

    // Fuel
    if (status.fuelLevel !== undefined) updates.push(['measure_fuel_level', status.fuelLevel]);
    if (status.oilLevel !== undefined) updates.push(['measure_oil_level', status.oilLevel]);

    // Charging
    if (status.stateOfCharge !== undefined) updates.push(['measure_soc', status.stateOfCharge]);
    if (status.chargingPower !== undefined) updates.push(['measure_charging_power', status.chargingPower]);
    if (status.chargingState !== undefined) updates.push(['charging_state', status.chargingState]);
    if (status.targetSoc !== undefined) updates.push(['target_soc', status.targetSoc]);

    // Doors & windows
    if (status.anyDoorOpen !== undefined) updates.push(['alarm_doors_open', status.anyDoorOpen]);
    if (status.anyWindowOpen !== undefined) updates.push(['alarm_windows_open', status.anyWindowOpen]);
    if (status.trunkOpen !== undefined) updates.push(['alarm_trunk_open', status.trunkOpen]);
    if (status.hoodOpen !== undefined) updates.push(['alarm_hood_open', status.hoodOpen]);

    // Climate
    if (status.climatisationState !== undefined) {
      const isActive = status.climatisationState === 'on' ||
                       status.climatisationState === 'heating' ||
                       status.climatisationState === 'cooling' ||
                       status.climatisationState === 'ventilation';
      updates.push(['climatisation_active', isActive]);
    }

    // Service
    if (status.serviceInspectionDistance !== undefined) updates.push(['measure_service_distance', status.serviceInspectionDistance]);
    if (status.serviceInspectionTime !== undefined) updates.push(['measure_service_time', status.serviceInspectionTime]);

    // Position
    if (status.latitude !== undefined) updates.push(['latitude', status.latitude]);
    if (status.longitude !== undefined) updates.push(['longitude', status.longitude]);

    // Apply all updates
    for (const [capability, value] of updates) {
      if (this.hasCapability(capability) && value !== null && value !== undefined) {
        try {
          await this.setCapabilityValue(capability, value);
        } catch (error: any) {
          this.error(`Failed to set ${capability}:`, error.message);
        }
      }
    }
  }

  /**
   * Handle settings changes
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: Record<string, any>;
    newSettings: Record<string, any>;
    changedKeys: string[];
  }): Promise<string | void> {
    // If credentials changed, reinitialize
    if (
      changedKeys.includes('username') ||
      changedKeys.includes('password') ||
      changedKeys.includes('region') ||
      changedKeys.includes('spin')
    ) {
      this.auth = new AudiAuth({
        username: newSettings.username,
        password: newSettings.password,
        spin: newSettings.spin || '',
        region: (newSettings.region as Region) || 'DE',
      });
      this.api = new AudiApi(this.auth, (newSettings.region as Region) || 'DE');

      try {
        await this.auth.login();
        await this.pollVehicleStatus();
        await this.setAvailable();
      } catch (error: any) {
        this.error('Re-login after settings change failed:', error.message);
        throw new Error('Login failed with new credentials');
      }
    }

    // If poll interval changed, restart polling
    if (changedKeys.includes('poll_interval')) {
      this.startPolling();
    }
  }

  /**
   * Clean up on device deletion
   */
  async onDeleted() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.log('Audi Vehicle device deleted');
  }

  /**
   * Clean up on uninit
   */
  async onUninit() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

module.exports = AudiVehicleDevice;
