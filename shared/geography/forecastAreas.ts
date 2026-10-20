import type { ReferenceArea } from './coordinates.ts';

// Reference metadata only: no prediction, expiry, network request or browser state.
export const AREA_CATALOG_SOURCE = {
  url: 'https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast',
  verifiedOn: '2026-10-20',
} as const;
export const FORECAST_AREAS: readonly ReferenceArea[] = Object.freeze(
  [
    {
      name: 'Ang Mo Kio',
      lat: 1.375,
      lon: 103.839,
    },
    {
      name: 'Bedok',
      lat: 1.321,
      lon: 103.924,
    },
    {
      name: 'Bishan',
      lat: 1.350772,
      lon: 103.839,
    },
    {
      name: 'Boon Lay',
      lat: 1.304,
      lon: 103.701,
    },
    {
      name: 'Bukit Batok',
      lat: 1.353,
      lon: 103.754,
    },
    {
      name: 'Bukit Merah',
      lat: 1.277,
      lon: 103.819,
    },
    {
      name: 'Bukit Panjang',
      lat: 1.362,
      lon: 103.77195,
    },
    {
      name: 'Bukit Timah',
      lat: 1.325,
      lon: 103.791,
    },
    {
      name: 'Central Water Catchment',
      lat: 1.38,
      lon: 103.805,
    },
    {
      name: 'Changi',
      lat: 1.357,
      lon: 103.987,
    },
    {
      name: 'Choa Chu Kang',
      lat: 1.377,
      lon: 103.745,
    },
    {
      name: 'City',
      lat: 1.292,
      lon: 103.844,
    },
    {
      name: 'Clementi',
      lat: 1.315,
      lon: 103.76,
    },
    {
      name: 'Geylang',
      lat: 1.318,
      lon: 103.884,
    },
    {
      name: 'Hougang',
      lat: 1.361218,
      lon: 103.886,
    },
    {
      name: 'Jalan Bahar',
      lat: 1.347,
      lon: 103.67,
    },
    {
      name: 'Jurong East',
      lat: 1.326,
      lon: 103.737,
    },
    {
      name: 'Jurong Island',
      lat: 1.266,
      lon: 103.699,
    },
    {
      name: 'Jurong West',
      lat: 1.34039,
      lon: 103.705,
    },
    {
      name: 'Kallang',
      lat: 1.312,
      lon: 103.862,
    },
    {
      name: 'Lim Chu Kang',
      lat: 1.423,
      lon: 103.717332,
    },
    {
      name: 'Mandai',
      lat: 1.419,
      lon: 103.812,
    },
    {
      name: 'Marine Parade',
      lat: 1.297,
      lon: 103.891,
    },
    {
      name: 'Novena',
      lat: 1.327,
      lon: 103.826,
    },
    {
      name: 'Pasir Ris',
      lat: 1.37,
      lon: 103.948,
    },
    {
      name: 'Paya Lebar',
      lat: 1.358,
      lon: 103.914,
    },
    {
      name: 'Pioneer',
      lat: 1.315,
      lon: 103.675,
    },
    {
      name: 'Pulau Tekong',
      lat: 1.403,
      lon: 104.053,
    },
    {
      name: 'Pulau Ubin',
      lat: 1.404,
      lon: 103.96,
    },
    {
      name: 'Punggol',
      lat: 1.401,
      lon: 103.904,
    },
    {
      name: 'Queenstown',
      lat: 1.291,
      lon: 103.78576,
    },
    {
      name: 'Seletar',
      lat: 1.404,
      lon: 103.869,
    },
    {
      name: 'Sembawang',
      lat: 1.445,
      lon: 103.818495,
    },
    {
      name: 'Sengkang',
      lat: 1.384,
      lon: 103.891443,
    },
    {
      name: 'Sentosa',
      lat: 1.243,
      lon: 103.832,
    },
    {
      name: 'Serangoon',
      lat: 1.357,
      lon: 103.865,
    },
    {
      name: 'Southern Islands',
      lat: 1.208,
      lon: 103.842,
    },
    {
      name: 'Sungei Kadut',
      lat: 1.413,
      lon: 103.756,
    },
    {
      name: 'Tampines',
      lat: 1.345,
      lon: 103.944,
    },
    {
      name: 'Tanglin',
      lat: 1.308,
      lon: 103.813,
    },
    {
      name: 'Tengah',
      lat: 1.374,
      lon: 103.715,
    },
    {
      name: 'Toa Payoh',
      lat: 1.334304,
      lon: 103.856327,
    },
    {
      name: 'Tuas',
      lat: 1.294947,
      lon: 103.635,
    },
    {
      name: 'Western Islands',
      lat: 1.205926,
      lon: 103.746,
    },
    {
      name: 'Western Water Catchment',
      lat: 1.405,
      lon: 103.689,
    },
    {
      name: 'Woodlands',
      lat: 1.432,
      lon: 103.786528,
    },
    {
      name: 'Yishun',
      lat: 1.418,
      lon: 103.839,
    },
  ].map((area) => Object.freeze(area)),
);
