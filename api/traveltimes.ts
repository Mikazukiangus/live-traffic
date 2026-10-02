/**
 * LTA DataMall Estimated Travel Times Serverless Endpoint
 * Upstream: https://datamall2.mytransport.sg/ltaodataservice/EstTravelTimes
 * Header: AccountKey: <LTA_ACCOUNT_KEY>
 */
import { handleLtaRequest } from './_client.ts';

const LTA_TRAVEL_TIMES_ENDPOINT = 'https://datamall2.mytransport.sg/ltaodataservice/EstTravelTimes';

export default async function handler(req: any, res?: any) {
  return handleLtaRequest(LTA_TRAVEL_TIMES_ENDPOINT, req, res);
}

export async function GET(request: Request) {
  return handleLtaRequest(LTA_TRAVEL_TIMES_ENDPOINT, request);
}
