/**
 * Database types for MileKeeper entities
 * These types match the Supabase database schema
 */

// Odometer Entry Types
export interface OdometerEntry {
  id: string;
  user_id: string;
  occurred_at: string; // ISO timestamp
  mileage_km: number;
  note: string | null;
  created_at: string; // ISO timestamp
}

export interface OdometerEntryInput {
  occurredAt: Date;
  mileageKm: number;
  note?: string | null;
}

// Service Item Types
export interface ServiceItem {
  id: string;
  user_id: string;
  title: string;
  interval_km: number | null;
  interval_days: number | null;
  notify_before_days: number;
  notify_before_km: number | null; // Nullable (removed from UI)
  measurement_mode: 'km' | 'calendar';
  note: string | null;
  is_active: boolean;
  created_at: string; // ISO timestamp
}

export interface ServiceItemInput {
  title: string;
  intervalKm?: number | null;
  intervalDays?: number | null;
  notifyBeforeDays: number;
  notifyBeforeKm?: number | null; // Optional (removed from UI, always null)
  measurementMode: 'km' | 'calendar';
  note?: string | null;
}

export interface ServiceItemUpdate {
  title?: string;
  intervalKm?: number | null;
  intervalDays?: number | null;
  notifyBeforeDays?: number;
  notifyBeforeKm?: number | null; // Optional (removed from UI, always null)
  measurementMode?: 'km' | 'calendar';
  note?: string | null;
  isActive?: boolean;
}

// Service Event Types
/**
 * `replacement` starts a new maintenance interval. `check` and `top_up` are history
 * records only and never affect the forecast (see `isReplacementEvent`).
 */
export type ServiceEventKind = 'replacement' | 'check' | 'top_up';

export interface ServiceEvent {
  id: string;
  user_id: string;
  service_item_id: string;
  occurred_at: string; // ISO timestamp
  mileage_km: number;
  note: string | null;
  created_at: string; // ISO timestamp
  kind: ServiceEventKind;
  /** Optional volume of a top-up, litres. Always null for other kinds. */
  amount_liters: number | null;
}

export interface ServiceEventInput {
  serviceItemId: string;
  kind: ServiceEventKind;
  occurredAt: Date;
  mileageKm: number;
  /** Only for `top_up`; optional. */
  amountLiters?: number | null;
  note?: string | null;
}

