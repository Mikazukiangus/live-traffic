import { config } from '../config/server.ts';
// Explicit projection: never serialize the complete server configuration or credentials.
console.log(JSON.stringify(config.tools.overpass));
