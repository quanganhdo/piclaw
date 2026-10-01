# Synthetic external-provider auth methods on Earendil 0.99.1 (#1458)

Public provider-owned auth methods have synthetic source-resolution coverage for Bedrock, Vertex and Azure OpenAI Responses. The eight tests use explicit in-memory environment/file contexts and do not inspect host credentials, cloud metadata or inference endpoints. This is partial AUTH-06 evidence; provider SDK-chain usability and Piclaw integration are not established here.

## Executed method cases

| Provider | Covered public methods |
|---|---|
| Amazon Bedrock | Stored bearer before ambient bearer; profile recognition; static AWS access-key pair recognition; missing readiness; provider-owned profile select/text prompts |
| Google Vertex AI | Stored API key before environment key; ADC file/project/location requirements; stored provider environment precedence; service-account-file setup prompts and synthetic file readiness |
| Azure OpenAI Responses | Stored key, environment key and missing key; auth method metadata remains distinct from endpoint setup |

The test imports `builtinProviders()` from the public provider subpath of exact `pi-ai@0.99.1`. It calls only `auth.apiKey.login/resolve` with injected `AuthContext` and synthetic interaction callbacks. Unexpected environment/file lookups throw. Provider-specific returned credential/source labels and prompt choices are checked. Reading the installed manifest is a version check; it does not repeat the earlier full tarball-integrity admission.

Bedrock's ambient bearer source returns empty request auth so provider-native code can resolve its environment later. That method result does not establish an authenticated request. Static profile/access-key recognition does not test ECS, IRSA, metadata, SSO or an actual AWS credential chain. Vertex file existence is a synthetic lookup, not a parsed service-account key or token exchange. Azure here is the built-in API-key provider; optional Piclaw managed-identity/bootstrap providers remain unqualified.

## Validation and scope

The external-method suite passed eight tests and 35 assertions; the post-custom-storage-merge method/inventory set passed 12 tests and 114 assertions. Combined custom/local/external/handler regressions passed 39 tests and 313 assertions. Five standard typechecks, strict fixture typechecking and scoped lint passed. Independent reviews found no blocker in the corrected provider-method/keyless scope and narrowed Bedrock readiness wording. At merged custom-storage baseline `c8e349299f18e9dcb5e8eba57e425d8e45c1aea5`, `make ci-fast` passed 5,951 runtime tests with seven existing skips and no failures, 25 feature tests and nine web checks. Pack hygiene passed 24,741 files; final five typechecks and diff checks passed, with the unchanged 95-diagnostic compose baseline. Private Bun caches were used without changing shared-cache permissions.

```sh
bun run test:local --cwd runtime -- bun test test/agent-control/provider-external-auth-0991.test.ts
```

No runtime method is monkeypatched, and no private provider imports or second auth client are used. There is no credential persistence or inference in these cases. Separate SDK storage/logout/precedence, keychain injection and actual cloud-client behavior require additional fixtures.

## Keyless local availability

An offline public runtime seam check found that keyless custom configuration without a stored or configured key yields zero available models. This slice follows the upstream compatible-endpoint dummy-key convention for exact coding-agent 0.99.1: only `ollama` and `llama-cpp` receive a non-secret `piclaw-keyless-local` marker when neither a key nor usable stored credential exists. The marker is returned as request auth by the runtime but never enters the credential store. It is not an endpoint credential or an account approval.

Blank updates retain a usable stored key and omit the marker. The legacy-key guard accepts the marker only for those two allowlisted IDs; unrelated literal keys still fail closed. New configuration backups omit the marker along with all other API-key fields. Real-runtime tests exercise both IDs through setup, available-model enumeration, reopen, update and removal, plus authenticated-local blank-key updates. No local inference request is sent, so endpoint reachability and a backend's acceptance of a dummy header remain unqualified. Existing keyless configs need a setup update; no startup migration runs.

Legacy credentials/backups, cross-process configuration, full provider/device/CLI/UI matrix, Delegate and approved live accounts remain open; #1458 and #1442 are not complete.
