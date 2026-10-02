/**
 * LTA DataMall EMAS Variable Message Signs (VMS) Serverless Endpoint
 * Upstream: https://datamall2.mytransport.sg/ltaodataservice/VMS
 * Header: AccountKey: <LTA_ACCOUNT_KEY>
 */
import { handleLtaRequest } from './_client.ts';

const LTA_VMS_ENDPOINT = 'https://datamall2.mytransport.sg/ltaodataservice/VMS';

export default async function handler(req: any, res?: any) {
  return handleLtaRequest(LTA_VMS_ENDPOINT, req, res);
}

export async function GET(request: Request) {
  return handleLtaRequest(LTA_VMS_ENDPOINT, request);
}
