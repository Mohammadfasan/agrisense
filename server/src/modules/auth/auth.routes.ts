import { Router } from 'express';

import { asyncHandler } from '@shared';

import { me, refresh, requestOtp, verifyOtp } from './auth.controller';
import { authenticate } from './auth.middleware';

export const authRouter: Router = Router();

// Unauthenticated: these are how a caller gets a token in the first place.
authRouter.post('/otp/request', asyncHandler(requestOtp));
authRouter.post('/otp/verify', asyncHandler(verifyOtp));
authRouter.post('/refresh', asyncHandler(refresh));

authRouter.get('/me', authenticate, me);
