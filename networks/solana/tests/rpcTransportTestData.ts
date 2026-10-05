/** Valid success envelopes used to prove transport text reaches the existing parser intact. */
export const successfulResponseTexts = [
  '{"jsonrpc":"2.0","id":1,"result":null}',
  '{"jsonrpc":"2.0","id":1,"result":{"slot":0,"value":null}}',
] as const;

/** JSON media types accepted by the browser transport, including an absent header. */
export const acceptedContentTypes = [
  { name: 'application/json', contentType: 'application/json' },
  {
    name: 'vendor JSON',
    contentType: 'application/vnd.rosen.rpc+json; charset=utf-8',
  },
  { name: 'missing content type', contentType: null },
] as const;

/** Non-JSON media types rejected before response body consumption. */
export const rejectedContentTypes = [
  { name: 'plain text', contentType: 'text/plain' },
  { name: 'HTML', contentType: 'text/html; charset=utf-8' },
  { name: 'other application media', contentType: 'application/octet-stream' },
] as const;
