'use strict';

import Homey from 'homey';

module.exports = class AudiConnectApp extends Homey.App {

  async onInit() {
    this.log('Audi Connect app has been initialized');

    // Register flow action cards
    this.registerFlowActions();

    // Register flow condition cards
    this.registerFlowConditions();
  }

  private registerFlowActions() {
    // Lock vehicle
    const lockAction = this.homey.flow.getActionCard('lock_vehicle');
    lockAction.registerRunListener(async (args: any) => {
      const device = args.device;
      await device.triggerCapabilityListener('locked', true);
    });

    // Unlock vehicle
    const unlockAction = this.homey.flow.getActionCard('unlock_vehicle');
    unlockAction.registerRunListener(async (args: any) => {
      const device = args.device;
      await device.triggerCapabilityListener('locked', false);
    });

    // Start climatisation
    const startClimateAction = this.homey.flow.getActionCard('start_climatisation');
    startClimateAction.registerRunListener(async (args: any) => {
      const device = args.device;
      await device.triggerCapabilityListener('climatisation_active', true);
    });

    // Stop climatisation
    const stopClimateAction = this.homey.flow.getActionCard('stop_climatisation');
    stopClimateAction.registerRunListener(async (args: any) => {
      const device = args.device;
      await device.triggerCapabilityListener('climatisation_active', false);
    });

    // Start charging
    const startChargerAction = this.homey.flow.getActionCard('start_charger');
    startChargerAction.registerRunListener(async (args: any) => {
      const device = args.device;
      // Access the API through the device
      const api = (device as any).api;
      const vin = (device as any).vin;
      if (api && vin) {
        await api.executeAction(vin, 'start_charger');
      }
    });

    // Stop charging
    const stopChargerAction = this.homey.flow.getActionCard('stop_charger');
    stopChargerAction.registerRunListener(async (args: any) => {
      const device = args.device;
      const api = (device as any).api;
      const vin = (device as any).vin;
      if (api && vin) {
        await api.executeAction(vin, 'stop_charger');
      }
    });

    // Start window heating
    const startWindowHeatAction = this.homey.flow.getActionCard('start_window_heating');
    startWindowHeatAction.registerRunListener(async (args: any) => {
      const device = args.device;
      await device.triggerCapabilityListener('window_heating_active', true);
    });

    // Stop window heating
    const stopWindowHeatAction = this.homey.flow.getActionCard('stop_window_heating');
    stopWindowHeatAction.registerRunListener(async (args: any) => {
      const device = args.device;
      await device.triggerCapabilityListener('window_heating_active', false);
    });

    // Start auxiliary heater
    const startHeaterAction = this.homey.flow.getActionCard('start_preheater');
    startHeaterAction.registerRunListener(async (args: any) => {
      const device = args.device;
      await device.triggerCapabilityListener('preheater_active', true);
    });

    // Stop auxiliary heater
    const stopHeaterAction = this.homey.flow.getActionCard('stop_preheater');
    stopHeaterAction.registerRunListener(async (args: any) => {
      const device = args.device;
      await device.triggerCapabilityListener('preheater_active', false);
    });

    // Refresh vehicle data
    const refreshAction = this.homey.flow.getActionCard('refresh_vehicle_data');
    refreshAction.registerRunListener(async (args: any) => {
      const device = args.device;
      const api = (device as any).api;
      const vin = (device as any).vin;
      if (api && vin) {
        await api.refreshVehicleData(vin);
        // Poll after a delay to get fresh data
        setTimeout(() => device.pollVehicleStatus().catch(() => {}), 30000);
      }
    });

    // Set target SOC
    const setTargetSocAction = this.homey.flow.getActionCard('set_target_soc');
    setTargetSocAction.registerRunListener(async (args: any) => {
      const device = args.device;
      await device.triggerCapabilityListener('target_soc', args.target_soc);
    });
  }

  private registerFlowConditions() {
    // Is locked
    const isLockedCondition = this.homey.flow.getConditionCard('is_locked');
    isLockedCondition.registerRunListener(async (args: any) => {
      const device = args.device;
      return device.getCapabilityValue('locked') === true;
    });

    // Is charging
    const isChargingCondition = this.homey.flow.getConditionCard('is_charging');
    isChargingCondition.registerRunListener(async (args: any) => {
      const device = args.device;
      return device.getCapabilityValue('charging_state') === 'charging';
    });

    // Is climatisation active
    const isClimatisationCondition = this.homey.flow.getConditionCard('is_climatisation_active');
    isClimatisationCondition.registerRunListener(async (args: any) => {
      const device = args.device;
      return device.getCapabilityValue('climatisation_active') === true;
    });

    // Any door open
    const doorOpenCondition = this.homey.flow.getConditionCard('is_door_open');
    doorOpenCondition.registerRunListener(async (args: any) => {
      const device = args.device;
      return device.getCapabilityValue('alarm_doors_open') === true;
    });

    // Any window open
    const windowOpenCondition = this.homey.flow.getConditionCard('is_window_open');
    windowOpenCondition.registerRunListener(async (args: any) => {
      const device = args.device;
      return device.getCapabilityValue('alarm_windows_open') === true;
    });

    // SOC below threshold
    const socBelowCondition = this.homey.flow.getConditionCard('soc_below');
    socBelowCondition.registerRunListener(async (args: any) => {
      const device = args.device;
      const currentSoc = device.getCapabilityValue('measure_soc');
      return currentSoc !== null && currentSoc < args.threshold;
    });

    // Fuel level below threshold
    const fuelBelowCondition = this.homey.flow.getConditionCard('fuel_below');
    fuelBelowCondition.registerRunListener(async (args: any) => {
      const device = args.device;
      const currentFuel = device.getCapabilityValue('measure_fuel_level');
      return currentFuel !== null && currentFuel < args.threshold;
    });
  }
};
