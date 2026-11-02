import { create } from 'zustand';
import api from '@/lib/api';

export interface LicenseStatus {
  valid: boolean;
  reason?: 'not_activated' | 'hardware_mismatch' | 'license_expired' | 'clock_tamper_detected' | 'invalid_signature' | 'database_tamper' | string;
  hwid: string;
  tier?: string;
  tier_label?: string;
  activated_at?: number;
  expires_at?: number | null;
  remaining_ms?: number | null;
  requires_owner_override?: boolean;
  message?: string;
}

interface LicenseStore {
  status: LicenseStatus | null;
  loading: boolean;
  setStatus: (status: LicenseStatus) => void;
  fetchStatus: () => Promise<LicenseStatus | null>;
}

export const useLicenseStore = create<LicenseStore>((set) => ({
  status: null,
  loading: true,
  setStatus: (status) => set({ status, loading: false }),
  fetchStatus: async () => {
    try {
      const res = await api.get('/license/status');
      if (res.data) {
        set({ status: res.data, loading: false });
        return res.data;
      }
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { licenseStatus?: LicenseStatus } } };
      if (error.response?.data?.licenseStatus) {
        set({ status: error.response.data.licenseStatus, loading: false });
        return error.response.data.licenseStatus;
      }
    }
    return null;
  },
}));
