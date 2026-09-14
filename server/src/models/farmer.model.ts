import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { DEFAULT_LOCALE, LOCALES, type LocaleCode } from '@shared/types';

/**
 * `farmers` — the single user identity collection (see `docs/schema.md` §1).
 *
 * Officers and admins live here too, distinguished by `role`: the shared
 * fields dominate, and every scoping rule in the app keys off `district`,
 * which every user has.
 *
 * There is deliberately no password field. Authentication is OTP-only, so
 * there is no credential to leak, reset or reuse across services.
 */

export const FARMER_ROLES = ['farmer', 'officer', 'market_admin', 'admin'] as const;
export type FarmerRole = (typeof FARMER_ROLES)[number];

export interface NotificationPrefs {
  push: boolean;
  sms: boolean;
  outbreakAlerts: boolean;
  priceAlerts: boolean;
}

/** Web Push subscription, stored verbatim as the browser hands it over. */
export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export interface Farmer {
  _id: Types.ObjectId;
  phone: string;
  name: string;
  role: FarmerRole;
  language: LocaleCode;
  district: string;
  dsDivision?: string;
  /** Officers only: districts beyond `district` this user may act in. */
  assignedDistricts: string[];
  department?: string;
  isActive: boolean;
  isVerified: boolean;
  notificationPrefs: NotificationPrefs;
  pushSubscription?: PushSubscription | null;
  lastLoginAt?: Date | null;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type FarmerDocument = HydratedDocument<Farmer>;

const notificationPrefsSchema = new Schema<NotificationPrefs>(
  {
    push: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    outbreakAlerts: { type: Boolean, default: true },
    priceAlerts: { type: Boolean, default: true },
  },
  { _id: false },
);

const pushSubscriptionSchema = new Schema<PushSubscription>(
  {
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    expirationTime: { type: Number, default: null },
  },
  { _id: false },
);

const farmerSchema = new Schema<Farmer>(
  {
    // E.164, and the login identity — normalised before it ever reaches here.
    phone: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: FARMER_ROLES, required: true, default: 'farmer' },
    language: { type: String, enum: LOCALES, required: true, default: DEFAULT_LOCALE },
    district: { type: String, required: true, trim: true },
    dsDivision: { type: String, trim: true },
    assignedDistricts: { type: [String], default: [] },
    department: { type: String, trim: true },
    isActive: { type: Boolean, required: true, default: true },
    isVerified: { type: Boolean, required: true, default: false },
    notificationPrefs: {
      type: notificationPrefsSchema,
      default: (): NotificationPrefs => ({
        push: true,
        sms: true,
        outbreakAlerts: true,
        priceAlerts: true,
      }),
    },
    pushSubscription: { type: pushSubscriptionSchema, default: null },
    lastLoginAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'farmers' },
);

// Declared here rather than as `unique: true`/`index: true` on the paths, so
// every index for this collection is visible in one place.
farmerSchema.index({ phone: 1 }, { unique: true, name: 'phone_unique' });
farmerSchema.index({ role: 1, district: 1 }, { name: 'role_district' });
farmerSchema.index({ district: 1, isActive: 1 }, { name: 'district_active' });

export const FarmerModel: Model<Farmer> = model<Farmer>('Farmer', farmerSchema);
