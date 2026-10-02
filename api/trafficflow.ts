/**
 * LTA DataMall Traffic Flow Serverless Endpoint
 * Upstream: https://datamall2.mytransport.sg/ltaodataservice/Trafficflow
 * Header: AccountKey: <LTA_ACCOUNT_KEY>
 */
import { handleLtaRequest } from './_client.ts';

const LTA_TRAFFIC_FLOW_ENDPOINT = 'https://datamall2.mytransport.sg/ltaodataservice/Trafficflow';

export default async function handler(req: any, res?: any) {
  return handleLtaRequest(LTA_TRAFFIC_FLOW_ENDPOINT, req, res);
}

export async function GET(request: Request) {
  return handleLtaRequest(LTA_TRAFFIC_FLOW_ENDPOINT, request);
}
