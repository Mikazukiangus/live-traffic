# Incident and traffic-camera JSON contracts

These are the app's endpoints. Examples are synthetic, shortened snapshots, not current incidents or usable image links. Inspect real camera responses privately: `image` can contain a temporary signed URL, which must never be pasted into logs, issues or examples.

A production shape check on 20 October 2026 returned HTTP 200 for both routes, with three incidents and seven cameras. Counts change; no fixed camera count is enforced.

## GET /api/traffic

Successful LTA DataMall `TrafficIncidents` responses are passed through without rewriting their records or optional OData metadata:

```json
{
  "odata.metadata": "https://datamall2.mytransport.sg/ltaodataservice/$metadata#IncidentSet",
  "value": [
    {
      "Type": "Accident",
      "Latitude": 1.3,
      "Longitude": 103.8,
      "Message": "(20/10)08:15 Accident on PIE (towards Tuas)."
    }
  ]
}
```

- `value` is required and must be an array. `{"value":[]}` means a valid response with no reported incidents.
- Every row requires nonblank string `Type` and `Message`, and finite numeric latitude (−90 to 90) and longitude (−180 to 180). Numeric strings are rejected.
- Unknown nonblank incident types and extra fields remain allowed for forward compatibility. Optional `odata.metadata`, if present, must be a string. Parsing of expressway names and lanes remains separate from transport validation.
- Invalid JSON, missing wrappers or any malformed row reject the entire snapshot. The server and browser use the same contract. A rejected refresh does not replace the browser's last good list or refresh its receipt time; the existing polling failure state is used. A first failed load follows the existing retry policy (loading after one failure, error after two).

## GET /api/trafficimages

The app normalizes either official provider into this shape:

```json
{
  "success": true,
  "source": "lta_datamall_v2",
  "totalCameras": 1,
  "timestamp": "2026-10-20T00:15:00.000Z",
  "cameras": [
    {
      "camera_id": "2701",
      "image": "https://images.data.gov.sg/example-camera.jpg",
      "latitude": 1.44,
      "longitude": 103.77,
      "timestamp": "2026-10-20T00:15:00.000Z"
    }
  ]
}
```

- `success` must be `true`. `source` is `lta_datamall_v2` or `data_gov_sg_lta_live`. `totalCameras` must equal the array length; IDs must be nonblank strings and unique within a snapshot.
- Each camera requires a valid absolute HTTPS image URL without embedded username/password, valid numeric coordinates, and a valid ISO timestamp with an explicit timezone. Signed URL query parameters are preserved exactly. URL validation checks structure; the existing image proxy continues to own its host allowlist. This does not test image availability or pixel freshness.
- Timestamp checks reject impossible calendar dates, invalid time/offset fields and ambiguous local times. A valid old capture is accepted and remains visibly old; validation does not turn it into a current capture.
- DataMall filenames usually encode UTC capture time; those observations are used unchanged. A malformed embedded date rejects the snapshot. If the filename has no embedded timestamp, the existing request-time fallback remains; it is not proof of capture freshness. Public-feed per-camera timestamps take precedence over the provider item timestamp. Missing optional per-camera timestamps inherit that item timestamp; malformed supplied timestamps are rejected.
- A valid empty camera array is accepted by the API. The browser tries the public fallback for an empty internal feed and displays unavailable if both contain no cameras. Missing arrays are errors, never valid empty feeds.
- The API validates the selected raw provider before normalization, then validates its public output. The browser independently validates the internal response and its direct public fallback. A malformed primary response can recover through a valid fallback. If both fail, the refresh rejects and the camera hook preserves its previous cards/time while showing feed failure.

### Raw upstream formats

DataMall `Traffic-Imagesv2` (requires server AccountKey):

```json
{
  "value": [
    {
      "CameraID": 2701,
      "ImageLink": "https://images.data.gov.sg/2701_1120_20261020001500_example.jpg",
      "Latitude": 1.44,
      "Longitude": 103.77
    }
  ]
}
```

Public data.gov.sg traffic images (keyless):

```json
{
  "items": [
    {
      "timestamp": "2026-10-20T08:15:00+08:00",
      "cameras": [
        {
          "camera_id": "2701",
          "image": "https://images.data.gov.sg/example-camera.jpg",
          "location": { "latitude": 1.44, "longitude": 103.77 },
          "timestamp": "2026-10-20T08:14:00+08:00"
        }
      ]
    }
  ]
}
```

Raw IDs accept nonblank strings or nonnegative safe integers and become strings. Duplicate IDs, including mixed string/number duplicates, are rejected. `items` must contain a snapshot; if more than one is present, all must validate and the newest by actual timestamp is selected. Extra provider fields are allowed and public `image_metadata` is not required because the app does not consume it.

## Malformed response

If no valid provider response can be published, HTTP **502**, `Cache-Control: no-store`:

```json
{
  "success": false,
  "code": "UPSTREAM_INVALID_RESPONSE",
  "error": "Traffic provider returned an invalid response"
}
```

The existing missing-key, timeout and HTTP failure classifications remain. Successful responses keep existing CDN behavior. Diagnostics include only fixed service/event/code and optional numeric HTTP status: no rejected fields, response snippets, raw errors, account keys or signed links. Health probes validate incident and selected camera-provider structures as well as HTTP success; a malformed HTTP 200 is `DOWN` with the actual upstream `httpCode: 200`.

## Ownership and checks

- `shared/traffic/incidents.ts`: incident types and runtime contract.
- `shared/traffic/cameras.ts`: both camera-provider contracts, normalized contract and pure normalization.
- `shared/traffic/validation.ts`: safe JSON parsing and primitive field checks; no dependencies or server configuration.
- HTTP/fallback policy remains in the existing server and browser adapters; presentation and retention remain in existing hooks.
- `tests/lta-contracts.test.ts`: malformed/valid snapshots, Node/Web responses, fallback, no-store, safe errors, dates, duplicates and browser validation. Existing configuration, diagnostics and camera offline-provenance tests continue to run.

Validation establishes the structure of provider data. It cannot guarantee completeness, road accuracy, image accessibility or that a timestamp reflects a newly captured image.
