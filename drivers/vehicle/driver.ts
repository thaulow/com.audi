import Homey from 'homey';
import { AudiAuth } from '../../lib/audi-auth';
import { AudiApi } from '../../lib/audi-api';
import type { Region } from '../../lib/types';

class AudiVehicleDriver extends Homey.Driver {

  async onInit() {
    this.log('Audi Vehicle driver initialized');
  }

  async onPair(session: any) {
    let username = '';
    let password = '';
    let region: Region = 'DE';
    let auth: AudiAuth | null = null;
    let api: AudiApi | null = null;

    session.setHandler('login', async (data: { username: string; password: string }) => {
      username = data.username;
      password = data.password;

      // Try to get region from app settings, default to DE
      try {
        region = (this.homey.settings.get('region') as Region) || 'DE';
      } catch {
        region = 'DE';
      }

      const spin = this.homey.settings.get('spin') || '';

      auth = new AudiAuth({
        username,
        password,
        spin,
        region,
      });

      try {
        await auth.login();
        api = new AudiApi(auth, region);

        // Store credentials in app settings for later use
        this.homey.settings.set('username', username);
        this.homey.settings.set('password', password);
        this.homey.settings.set('region', region);

        return true;
      } catch (error: any) {
        this.error('Login failed:', error.message);
        throw new Error(this.homey.__('pair.login_failed'));
      }
    });

    session.setHandler('list_devices', async () => {
      if (!api) {
        throw new Error('Not authenticated');
      }

      try {
        const vehicles = await api.getVehicles();

        return vehicles.map(vehicle => ({
          name: vehicle.nickname || `${vehicle.model} (${vehicle.vin.slice(-4)})`,
          data: {
            id: vehicle.vin,
          },
          store: {
            vin: vehicle.vin,
            model: vehicle.model,
            modelYear: vehicle.modelYear,
            modelFamily: vehicle.modelFamily,
            engineType: vehicle.engineType,
          },
          settings: {
            username,
            password,
            spin: this.homey.settings.get('spin') || '',
            region,
            vin: vehicle.vin,
          },
          icon: '/icon.svg',
        }));
      } catch (error: any) {
        this.error('Failed to list vehicles:', error.message);
        throw new Error('Failed to retrieve vehicles from Audi Connect');
      }
    });
  }

  async onRepair(session: any, device: any) {
    session.setHandler('login', async (data: { username: string; password: string }) => {
      const settings = device.getSettings();
      const region: Region = settings.region || 'DE';

      const auth = new AudiAuth({
        username: data.username,
        password: data.password,
        spin: settings.spin || '',
        region,
      });

      try {
        await auth.login();

        // Update device settings
        await device.setSettings({
          username: data.username,
          password: data.password,
        });

        // Reinitialize the device
        device.onInit();

        return true;
      } catch (error: any) {
        this.error('Repair login failed:', error.message);
        throw new Error(this.homey.__('pair.login_failed'));
      }
    });
  }
}

module.exports = AudiVehicleDriver;
