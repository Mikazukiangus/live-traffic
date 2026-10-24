import { next } from '@vercel/functions';
import { userAdmission } from './server/auth/userAdmission.ts';

/** The platform invokes this before its cache, including requests whose origin never runs. */
export default async function proxy(request: Request) {
  return await userAdmission(request) ?? next();
}
