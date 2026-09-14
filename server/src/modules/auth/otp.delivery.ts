import { env, logger } from '@config';
import { AppError } from '@shared';

import { maskPhone } from './phone';

/**
 * Where a verification code actually goes.
 *
 * No SMS provider is wired up yet, so the only real implementation is the
 * development one. Keeping the seam here means the provider lands as one new
 * file and a branch in {@link getSmsGateway}, and never touches the service.
 */
export interface SmsGateway {
  readonly name: string;
  send(phone: string, code: string): Promise<void>;
}

/**
 * `OTP_DEV_MODE`: write the code to the log instead of sending it.
 *
 * Logging a live credential is normally indefensible; it is safe here only
 * because `env.otpDevMode` is forced off when `NODE_ENV=production`, so this
 * gateway cannot be selected against real users.
 */
const developmentGateway: SmsGateway = {
  name: 'development',
  send(phone, code) {
    logger.warn('OTP_DEV_MODE: code not sent, logged instead', {
      phone: maskPhone(phone),
      code,
    });
    return Promise.resolve();
  },
};

/**
 * Production placeholder. Fails loudly rather than silently accepting a
 * request whose code no one will ever receive.
 */
const unconfiguredGateway: SmsGateway = {
  name: 'unconfigured',
  send() {
    return Promise.reject(
      AppError.serviceUnavailable('SMS delivery is not configured on this server'),
    );
  },
};

export function getSmsGateway(): SmsGateway {
  return env.otpDevMode ? developmentGateway : unconfiguredGateway;
}
