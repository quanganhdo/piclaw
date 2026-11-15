# Useful codemode tools and fetch

The source-default codemode script can call guarded `tools.write`, `tools.edit`,
`tools.read`, `tools.find`, `tools.grep` and `tools.fetch`. The actual factory test
writes and edits a file, reads and searches the result, fetches a synthetic JSON
response and parses `response.body`. It passes 162 assertions, including unchanged
sandbox restrictions: no `process`, global `fetch` or model-access global.

`tools.fetch({url, max_bytes?, timeout_ms?})` returns `{url,status,ok,headers,body}`.
It supports GET over HTTP(S), rejects URL credentials, refuses redirects and sends
no ambient cookies, authentication or arbitrary caller headers. It limits streamed
bytes (256 KiB default, 1 MiB maximum) and duration (10 seconds default, 30 seconds
maximum). Only content type/length, ETag and last-modified headers are returned.

LAN/private URLs are allowed under the existing single-user operator capability,
like guarded bash. This is not a public web proxy or an SSRF isolation boundary.
Source authority and single-user policy are checked before sending and after body
reads. Cancellation and revocation prevent result publication and cancel the body.
All fetch calls are unsafe to replay; GET does not prove the endpoint has no effects.
Custom tool subsets remain unchanged; recognised factory defaults gain fetch.

Five focused tests / 14 assertions, the actual-factory test, three scoped typechecks
and bounded source review pass. Tests inject responses and a redirect-error rejection;
they do not test real external networking or native redirect transport. No SDK pin,
CI run, deployment or migration is included. Native accounting is still incomplete.
