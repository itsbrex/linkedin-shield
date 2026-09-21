/** Hypothetical requests only: these URLs must never be fetched by the harness. */
export const networkCases = [
  { id: 'apfc-path', url: 'https://www.linkedin.com/apfc/collect', rule: 9 },
  { id: 'telemetry-path', url: 'https://www.linkedin.com/platform-telemetry/li/apfcDf', rule: 8 },
  { id: 'track-path', url: 'https://www.linkedin.com/li/track', rule: 11 },
  { id: 'merchant-script', url: 'https://merchantpool1.linkedin.com/mdt.js', rule: 10, type: 'script' },
  { id: 'human-domain', url: 'https://collector.protechts.net/synthetic', rule: 3 },
  { id: 'sensor-path', url: 'https://www.linkedin.com/sensorCollect', rule: 2 },
  { id: 'path-boundary', url: 'https://www.linkedin.com/apfc/collector', block: false },
  { id: 'host-boundary', url: 'https://linkedin.com.example.com/apfc/collect', block: false, header: false },
  { id: 'normal-api', url: 'https://www.linkedin.com/voyager/api/me', block: false, header: true },
  { id: 'challenge-allowed', url: 'https://www.linkedin.com/checkpoint/challenge', block: false },
  {
    id: 'foreign-initiator',
    url: 'https://www.linkedin.com/apfc/collect',
    initiator: 'https://example.com/',
    block: false,
    header: false,
  },
  { id: 'foreign-header-target', url: 'https://example.com/api', block: false, header: false },
];

export const browserCheckIds = [
  ...networkCases.map(({ id }) => id),
  'wire-control',
  'wire-block',
  'wire-header-removal',
  'wire-cleanup',
  'popup-waiting',
  'popup-evidence',
  'popup-layout',
  'popup-disclosure',
  'popup-no-key',
  'popup-host-boundary',
];
