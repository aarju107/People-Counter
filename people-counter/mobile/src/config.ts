// Physical phones must use your PC's LAN IP, e.g. http://192.168.1.100:8000,
// not localhost. The Android emulator uses http://10.0.2.2:8000.
// Set EXPO_PUBLIC_API_URL in mobile/.env, then restart Expo after changes.
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000').replace(/\/+$/, '');
