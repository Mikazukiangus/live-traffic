/**
 * LTA DataMall Traffic Images Serverless Endpoint
 * Upstream: https://datamall2.mytransport.sg/ltaodataservice/Traffic-Imagesv2
 * Header: AccountKey: <LTA_ACCOUNT_KEY>
 */
import { handleLtaRequest } from './_client.ts';

const LTA_TRAFFIC_IMAGES_ENDPOINT = 'https://datamall2.mytransport.sg/ltaodataservice/Traffic-Imagesv2';

export default async function handler(req: any, res?: any) {
  return handleLtaRequest(LTA_TRAFFIC_IMAGES_ENDPOINT, req, res);
}

export async function GET(request: Request) {
  return handleLtaRequest(LTA_TRAFFIC_IMAGES_ENDPOINT, request);
}
