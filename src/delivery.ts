import * as SecureStore from 'expo-secure-store';

export type DeliverySettings = {
  baseUrl: string;
  appToken: string;
  serviceId: string;
};

const KEY = 'darb-assabil-settings';

export async function loadDeliverySettings(): Promise<DeliverySettings> {
  const saved = await SecureStore.getItemAsync(KEY);
  return saved ? JSON.parse(saved) as DeliverySettings : { baseUrl: 'https://daftar-orders-personal.netlify.app', appToken: '', serviceId: '' };
}

export async function saveDeliverySettings(settings: DeliverySettings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(settings));
}

// Documented Darb Assabil endpoints. The API key stays in the Netlify function.
export const darbEndpoints = {
  packages: '/api/local/service/rates/public/',
  contacts: '/api/contacts/',
  calculate: '/api/local/shipments/calculate/shipping/',
  shipments: '/api/local/shipments/',
  timeline: (reference: string) => `/api/local/shipments/timeline/${encodeURIComponent(reference)}`,
};
