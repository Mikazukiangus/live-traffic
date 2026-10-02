/**
 * LTA DataMall Traffic Incidents Serverless Endpoint
 * Upstream: https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents
 * Header: AccountKey: <LTA_ACCOUNT_KEY>
 */
import { handleLtaRequest } from './_client.ts';

const LTA_TRAFFIC_INCIDENTS_ENDPOINT = 'https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents';

export default async function handler(req: any, res?: any) {
  return handleLtaRequest(LTA_TRAFFIC_INCIDENTS_ENDPOINT, req, res);
}

export async function GET(request: Request) {
  return handleLtaRequest(LTA_TRAFFIC_INCIDENTS_ENDPOINT, request);
}
