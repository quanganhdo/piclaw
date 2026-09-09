# Memory bootstrap selection

The built-in `workspaceMemoryBootstrap` hook selects files from the current configured workspace on every invocation. Family and isolated deployment startup remains gated; this boundary is covered by disposable tests, not a live migration or activation.

## Single-user compatibility

With valid single-user configuration, legacy callers without execution identity keep `notes/memory/MEMORY.md`, `notes/index.md` and optional `notes/preferences/agent.md`, including existing missing-file and truncation behaviour. An explicitly supplied single-user default-account identity uses those same paths and retains its runtime identity label. A stale family identity in single-user mode cannot select family files or fall back to legacy memory.

## Family sources and authority

Family mode requires a matching immutable runtime execution identity, provenance and optional preference snapshot. The source chat, live account, role, original root and login or private scheduled-dispatch authority must validate before any memory read. Absent identity, unsupported isolated mode, malformed configuration, wrong chat/root/role and revoked authority reject the hook. Scheduled work uses the existing durable dispatcher checks and does not require its owner's old browser login.

Only these fixed paths are selected:

- `notes/users/<immutable-user-id>/MEMORY.md` — selected owner context;
- `notes/users/<immutable-user-id>/preferences.md` — selected owner preferences;
- `notes/family/MEMORY.md` — separately labelled shared family reference.

The owner ID comes from runtime identity, not username or message text. Missing or unreadable files remain missing; they never select another user or legacy global notes. Each family file retains its 8,000-character output cap. The existing reader reads the full file before truncating; this change does not add file-size or filesystem resource limits. Account response guidance retains its per-run immutable snapshot.

Mode, workspace and identity are rechecked around reads and before returning the assembled system prompt. An observed denial is latched for that invocation, even if configuration changes back inside optional-file handling. Read errors cannot swallow an authority denial. No filesystem writes, shared publication, search-index refresh, model call or timer is added.

## Limits

Memory text is labelled reference data, not identity or permission authority. Family reference is not automatically attributed to the selected owner. The hook does not recursively load linked notes or publish personal context into shared memory. This is automatic prompt-source selection, not filesystem confidentiality: explicit permitted reads, symlinks, writable shared code and privileged installed extensions remain within the shared-machine trust boundary.

The SDK may catch extension-hook errors and continue without this hook's addition. This change guarantees that denied bootstrap text is not returned; it is not a new model-cancellation boundary. The runtime's existing admission and scheduled-scope checks still govern execution. Shared-index selection is described below. Other system-prompt extensions, per-user Dream source/output coordination and explicit shared-memory publication require separate integration before family activation.

## Shared-family index

Trusted internal workspace-index APIs use separate `family_workspace_*` tables in configured family mode. Their only roots are `notes/family` and `.pi/skills`, with `notes` and `skills` scopes selecting the respective root. Configured extra roots, `notes/users`, legacy personal notes and the global single-user index are never searched or imported into the family index. Empty family tables stay empty until an explicit refresh; a ready legacy index cannot satisfy family status or return stale personal snippets. FTS and syntax-error LIKE fallback query only the family tables and fixed-root paths, before pagination. Operational database errors return failure rather than silently changing query semantics.

This profile does not grant a family model or browser a workspace-search capability. Index APIs reject execution identity in family mode; background callers without an execution context remain trusted internal code. Isolated and malformed modes deny. Valid single-user callers keep the existing configured roots, tables and search behaviour. Mode, workspace, identity and database checks prevent a running refresh from continuing into a different profile after an await. The background launcher passes resolved workspace/store/data and its expected mode; a changed-mode child rejects before database initialisation. No timer or automatic family startup is introduced.

Family refresh stages at most 2,000 files and 32 MiB, visits at most 20,000 directory entries to depth 16, and checks a 30-second elapsed-time budget between filesystem operations. It streams directory entries, accepts a fixed text-extension set, and bounds individual files by the requested 16–2,048 KiB limit (512 KiB default). Symlink roots/directories/files and hard-linked files are excluded; opened files must be regular, single-link and unchanged across a bounded read. Missing roots are empty. Other read/decode/limit failures discard staging and preserve the prior snapshot. The elapsed-time budget cannot interrupt an already blocked filesystem operation.

Scope replacement and ready status commit atomically. A persisted generation compare-and-swap rejects staging superseded by a source-change notification or another refresh, including another process. Partial refresh invalidates aggregate freshness without marking the unrelated scope stale. Local refresh coordination is workspace-scoped and released in `finally`; no failed-status write occurs after authority denial. Explicit filesystem changes without a notification still require a fresh refresh; this is not a filesystem-wide atomic snapshot.

The legacy tables are neither erased nor migrated. This separates automatic source selection, not filesystem confidentiality: a privileged process can race ancestor replacement or edit shared source/SQL, and permitted explicit reads still access shared files. Per-user search indexes, Dream integration and deployment acceptance remain separate work.

## Explicit publication ledger

The `db/family-memory.ts` control-plane APIs copy an explicitly confirmed, verbatim message excerpt into a separate SQLite publication ledger. They require configured family mode and a live account login; preview, publication and withdrawal also require authentication within five minutes. Model execution contexts, service grants, absent identity and other modes cannot call these control-plane APIs. The HTTP API below backs the [browser confirmation panel](user-guide.md#family-memory-publication). The attributed user-role prompt consumer reads published copies separately; no filesystem projection or Dream consumer uses this ledger.

Preview requires an exact message row ID, message ID and active owned chat. It returns at most 100 KiB of text with a hash binding content, source metadata, branch, root and owner. Publication requires that unchanged hash, a non-empty verbatim excerpt of at most 16 KiB, a UUID request ID and `confirm: true`. Media, structured blocks and thinking content are never copied. Ownership permits selection; it does not prove the publisher authored the message or that its claims are true.

The transaction records the immutable publisher ID, current username/display-name snapshot, original approving login, source identifiers/hash and copied text/hash. Same-owner exact retries return the original publication ID without relabelling it, even after source editing, archival or deletion. They acknowledge the existing copy and never read or republish the source. Changed request payload or withdrawn publication denies; another account, including an administrator, cannot publish from that source. New request IDs are independent publication requests and require a live unchanged source matching the preview.

Shared reads return the newest 20 non-withdrawn copies, ordered by publication time and ID. They expose only copied text, publication ID/time, publisher attribution and the `message-excerpt` source kind. Private chat/message IDs, source hashes, login/request IDs and unselected text stay outside the shared projection. The owner can inspect the historical receipt, including source identifiers, after source archival or deletion. Name changes do not relabel existing publications; source edits, deletion and publisher disablement do not silently erase already shared copies.

Only a recently authenticated publisher can withdraw a copy, including after source archival or deletion. Withdrawal is append-only and idempotent, removes the copy from future shared reads and prevents publication retry from resurrecting it. It cannot retract earlier downloads, filesystem copies or provider context. Publication and withdrawal records are immutable and retained; this slice has no erasure or retention policy.

Immediate SQLite transactions serialise publication/withdrawal and enforce retained-history limits of 100 copies per publisher and 1,000 globally, including withdrawn copies. Exact retries do not consume another slot; withdrawal does not free a slot. A full ledger rejects new publications until a separately reviewed retention mechanism exists. There are no concurrent shared-file edits because these APIs write no files. Legacy memory, transcripts, cursors, search indexes, timers and startup gates are unchanged. Shared filesystem/SQL-capable processes remain privileged. Per-user Dream coordination, file projection and deployment activation need separate implementation and review.

## Publication HTTP API

The family-only dispatcher recognises these exact routes. All require a live family cookie and matching `x-piclaw-account-id` and `x-piclaw-login-id`. They accept no query parameters, including owner, chat, limit or pagination selectors. GET requires a live login; every POST also requires recent factor authentication, a matching Origin and `application/json`.

| Method and path | Request / response |
|---|---|
| `POST /agent/family-memory/preview` | Exact `{chat_jid,message_rowid,message_id}`; returns those identifiers, owned source text and source hash without writing a record |
| `POST /agent/family-memory` | Exact `{chat_jid,message_rowid,message_id,source_hash,text,request_id,confirm:true}`; returns publication ID, echoed request ID and `created`; 201 first publication, 200 exact receipt retry |
| `GET /agent/family-memory/own` | Newest-first complete owner history, at most 100 entries: publication ID, request ID, time and withdrawn flag; no text/source/login metadata |
| `GET /agent/family-memory/<publication-id>` | Owner-only copied text and historical source receipt; includes withdrawn copies and inaccessible original sources |
| `GET /agent/family-memory/shared` | Newest 20 non-withdrawn copies with publisher attribution, without private source/login/request identifiers |
| `POST /agent/family-memory/<publication-id>/withdraw` | Exact `{confirm:true}`; returns publication ID, `withdrawn:true` and `created`; 201 first withdrawal, 200 repeat |

Preview, publication and withdrawal each have independent limits of 20 requests per minute per account, so preview/publication cannot exhaust withdrawal's allowance. The three GET routes share 60 reads per minute per account. Account limits cover all its login sessions. Rate rejection returns 429; no automatic retry is added.

Body limits are 4 KiB for preview, 128 KiB for publication and 1 KiB for withdrawal, measured as encoded UTF-8 JSON. The larger publication envelope permits JSON escaping but does not increase the ledger's 16 KiB excerpt limit. Body reading has a 10-second deadline, rejects malformed UTF-8, invalid JSON, wrong shapes, overflow and aborts, and releases the reader. Account/role/login, configured mode, workspace/store/data paths and database connection are checked around every body read and before the ledger operation. An observed denial is permanent for that request; a replacement login/database cannot become its authority. Changes that occur and revert entirely between checks are not observable.

The router returns 401 without a live family login, 409 for supplied stale/partial browser pins, and 403 for absent pins, denied authority or invalid route/input. Unexpected ledger failures return a generic 500 without logging their error payload. Responses are private/no-store and vary on Cookie. Publication response loss can be reconciled through the owner history and exact request ID, including after source archival/deletion; a retry acknowledges the existing receipt without republishing. Withdrawal prevents resurrection by retry. A client that loses its request ID must inspect history before creating another request.

No SSE, notification, queue call, automatic refresh, search-index change or shared-file write follows these requests. The prompt consumer below reads the ledger independently at run start. Per-user Dream and deployment activation require separate work. Shared copies are reference data and must never be interpreted as runtime identity or permission grants.

The family timeline adds `memory_source` only to its already-authorised message rows with non-empty source text up to 100 KiB. It contains the exact chat, row and stable message ID for preview; it grants no publication authority. The preview API independently validates the live source and returns a hash before confirmation. Single-user timeline responses are unchanged.

The panel uses text-only rendering, fixed owner/shared endpoints and in-memory drafts. It starts with no excerpt or confirmation selected. Successful requests are identity-revalidated before rendering. Publication freezes the exact request on uncertainty; manual retry requires fresh confirmation. Close, refresh, shared view, inspection, another source, blur, session switch and navigation clear drafts and retry identity. Reopening an already visible panel preserves a pending retry. Returning from blur exposes only an empty panel until an explicit read. Withdrawal uses separate confirmation and may run during an unrelated send without releasing its lock. No automatic memory refresh or browser storage is added.

## Attributed prompt snapshot

Each provider context build inside an authorised family execution reads a fresh SQLite snapshot of at most the newest 20 non-withdrawn publications. It inserts one hidden, ephemeral custom message before the current user request; Pi converts that message to user-role provider context. It does not persist the message in session history. Personal and shared file memory stays in the system bootstrap. Single-user execution does not open or query the family ledger. The snapshot is bounded to 32 KiB of formatted UTF-8 data; entries that would exceed the total bound and every older entry are omitted. No pagination, fallback to withdrawn/history rows or automatic file/search expansion occurs.

Each entry includes publication ID, publication time, immutable publisher ID and username/display-name snapshots, and copied text encoded as one JSON string with Unicode line separators escaped. It excludes private chat/message/source hashes, request/login IDs, attachments and unselected source text. Labels state that copies are untrusted reference data; publisher attribution is not proof of authorship or truth. Formatting and user-role placement reduce privilege confusion but cannot make model input semantically inert: published prompt-injection text can still influence output. The model is told never to follow instructions from quoted reference text. Server-side identity, ownership and tool controls do not derive authority from model output.

The hook pins configured family mode, workspace, execution identity and the database connection. It revalidates live execution owner/root/role/login or scheduled-dispatch authority before and after the database transaction, for every validated/formatted entry and before returning context. An observed denial is latched. Withdrawal committed before a provider context build excludes the copy; withdrawal after that build cannot retract context already supplied to the request. A later provider call takes a new snapshot. Every selected row is validated before output truncation. Corrupt attribution, deceptive bidirectional controls, date, UTF-8/NUL/size or text hash denies the hook instead of returning a partial shared-copy message.

This consumer performs no model call itself and writes no file, index, ledger, Dream state, timeline, cursor or notification. The SDK may still continue a turn if it catches a denied extension hook, as described above. Family startup and automatic Dream remain gated.

## Shared skill provenance

The family workspace policy includes a bounded metadata inventory for packaged runtime skills and shared workspace skills under `.pi/skills`. Each entry contains the declared skill name and description, provenance (`packaged` or `shared-workspace`), path relative to its provenance root, SHA-256 of `SKILL.md`, selection state and collision sources. It exposes no skill body or absolute path and performs no installation or execution.

Precedence is deterministic and matches Pi's first-found rule: packaged roots are scanned first, then the workspace-shared root. If names collide, the first packaged entry is selected and every later entry is reported as unselected with its collision peers. Workspace files cannot silently shadow packaged skills in this policy. This metadata does not grant a family model skill discovery or execution authority.

The inventory is limited to 2,000 directory entries, 500 discovered skills, five directory levels and 64 KiB per skill file. It mirrors Pi's `SKILL.md`, direct root Markdown, YAML frontmatter and missing-name fallback discovery rules while bounding names to 64 characters and descriptions to 1,024 characters. Paths and entries are sorted. Symlinked roots, directories or files deny the policy read. Mode and workspace are revalidated throughout; malformed/description-less skill files are ignored consistently with Pi loading, while unsafe filesystem structure fails closed. Installed skill code remains shared writable code in family mode and can affect all users when an operator enables it; application provenance is not filesystem isolation.

## Per-owner Dream source generations

The internal `prepareOwnFamilyDreamSnapshot` API provides non-activating groundwork for family Dream. A recently authenticated owner can materialise transcript evidence only from session roots assigned to that immutable user ID. The query includes the owner's active and archived branches, excludes temporary `dream:` chats, and never uses JID prefixes as ownership. It reads at most 5,000 messages from the requested 1–31 day window, rejects individual content over 100 KiB and rejects a generation above 8 MiB of message text.

Outputs are under `notes/users/<immutable-user-id>/dream/`. Each run writes a new immutable `generations/<timestamp>-<UUID>/` containing `daily/YYYY-MM-DD.md`, `MEMORY.md` as a source index and `manifest.json`. Daily evidence quotes sender, chat/message identity and message text as JSON. It does not generate summaries or copy another owner's notes, personal memory, shared family files or legacy `notes/daily` and `notes/memory` trees.

An owner-specific `.lock` serialises preparation across that account's trees while different owners retain separate locks. Files are written with restrictive modes into a staging directory. The complete directory is renamed into `generations/`, then `current.json` is atomically replaced as the sole current-generation pointer. Failure before pointer replacement preserves the prior generation. Historical generations are retained; no pruning/retention operation is added. A stale lock requires separate operator recovery and cannot be silently stolen.

The API pins configured family mode, workspace/store/data, singleton database and live account/role/home/login before source selection, throughout validation/writes and before pointer publication. It rejects model execution contexts, old/non-factor logins, malformed IDs and path/symlink mismatches. Shared-filesystem privileged writers can still race or edit these files, so this coordination is not hostile-user confinement.

No route, command, model pass, scheduler or startup path calls this API yet. Existing `/dream`, AutoDream, global daily-note refresh and deterministic legacy maintenance continue to reject family mode. The proposal/promotion gate below supplies a private output boundary, but an owner-scoped model runner and operational activation checks still need separate work.

## Dream proposal and promotion gate

The internal proposal API issues a 15-minute, 256-bit capability bound to one owner and the current source generation. Only its SHA-256 hash stays in process memory; no capability or hash is written to the database, generation, proposal or logs. The exact capability can stage one non-empty UTF-8 Markdown proposal of at most 64 KiB under `notes/users/<user-id>/dream/proposals/<proposal-id>/`. Invalid output does not consume the capability; successful staging deletes it, and process restart loses every unused capability.

Staging revalidates family mode, singleton database and the unchanged current generation. It writes `proposal.md` and an immutable-style metadata record containing owner ID, generation, personal-memory base hash, proposal hash and creation time. It does not edit personal memory or source generations. Tokens cannot be replayed, widened to a new generation or used for another proposal.

A recently authenticated owner explicitly promotes a staged proposal. The target is fixed to `notes/users/<immutable-user-id>/MEMORY.md`; callers cannot select another path. Promotion requires the current source generation and current personal-memory hash to equal the base captured when the capability was issued. The write uses atomic replacement. A promotion receipt is then written beside the proposal with base/output hashes and time.

If the process writes personal memory but fails before recording the receipt, an exact retry recognises the proposal hash already at the target and records the receipt. Once a receipt exists, retries succeed only while the target still has that exact proposal hash. A later owner edit, different current generation, changed proposal/metadata or foreign account fails closed. Promotion cannot merge content or overwrite a concurrent owner change.

This is still an internal gate. No browser, HTTP, command, scheduler or startup path receives the capability. There is no automatic retry, promotion, rollback, retention or deletion. Shared-filesystem privileged processes remain trusted. Family Dream execution and activation remain disabled.

## Internal no-tool Dream runner

`runOwnFamilyDreamProposal` is a dependency-injected orchestration boundary for testing and later controlled admission. It accepts a server-supplied text-model callback only. The callback receives an immutable system string, one owner-labelled user string and an `AbortSignal`; it receives no tool registry, shell, session runtime, database, capability or promotion function. No production route or scheduler supplies a callback yet.

The runner requires a recent owner login, exact current generation, fixed workspace/store/data and database, and no ambient model execution context. It reads only that generation's manifest, source index and date-named daily files, rejecting symlinks, malformed UTF-8/NULs and more than 8 MiB. The model timeout is 1–300 seconds (120 seconds by default); output must be non-empty Markdown up to 64 KiB. Authority and generation are checked after the model await before staging through the private proposal capability.

Each owner request ID first claims a durable `runs/<request-id>/` directory. Source validation then writes `start.json` before the callback. A completed run adds `complete.json` containing only owner, generation, proposal ID, source hash and timestamps. Errors after a valid start, invalid output, timeout or authority loss add a similarly redacted `failed.json`. A failure before `start.json` leaves only the claimed directory for future operator inspection; it never fabricates an unbound terminal receipt. Neither receipt stores source text, prompt, output, provider errors or capability material. A complete receipt is idempotently readable without another model call; claimed/started/failed requests never replay automatically, including after process restart.

The runner stages a proposal but never promotes it. Recent-owner promotion remains the separate hash-CAS operation above. Model output is untrusted and can contain false or malicious text; owner confirmation is the only path to personal memory. Retention and production admission require separate review before activation.

## Internal production-model admission

`admitOwnFamilyDreamRun` creates a durable owner-local admission bound to one request ID, the current Dream source generation and the owner's exact model-default revision, provider/model and thinking level. It requires recent authentication and selects only one model from the current scoped, locally available catalogue. A null, unavailable or incompatible default denies; admission never silently falls back to another model.

First admission returns one private 256-bit dispatch capability. Only its hash is stored in the owner admission record. An exact retry returns the original metadata without the capability, so a lost first response cannot create a second provider call. Changes to request binding or model defaults deny.

`dispatchOwnFamilyDreamRun` validates the private capability, current account/model revision and scoped model availability, then writes a durable consumed receipt before any provider request. Consumed authority is never replayed, including provider failure or a crash after consumption. It calls the existing process model runtime once with the no-tool runner's system/user context, selected thinking level, no cache retention and its AbortSignal. Text output is passed to the reviewed private proposal sink; promotion remains separate.

This is an internal admission/dispatch pair. No route, browser control, command, scheduler or startup path can create or dispatch an admission. It does not activate family Dream. Provider credential/budget use, concurrency limits and operator controls still require integrated acceptance before a public caller is added.

## Stale-run recovery

`recoverOwnFamilyDreamRun` is an internal recent-owner operation for nonreplayable runs. Start receipts persist a fixed recovery deadline one minute beyond the requested model timeout and the expected proposal ID. Before that deadline, while the same process still marks the request active, or while the owner-wide lock is held, recovery denies.

After the deadline, recovery takes the owner lock and checks terminal state again. A fully staged proposal completes the run only when its owner, generation, proposal ID, exact request ID and proposal hash match the start receipt. Otherwise an unfinished run receives a redacted `failed.json`. Recovery never calls the model, reconstructs a capability, stages output or promotes personal memory. Completed and failed retries are idempotent; malformed or mismatched receipts fail closed.

A model callback that returns late cannot stage after recovery: proposal publication runs under the same owner lock and checks that no failure receipt exists immediately before its directory rename. Recovery can reconcile the commit gap after proposal rename but before completion receipt. Process-killed or otherwise orphaned runs therefore have an explicit terminal path without replay. No route, scheduler or automatic timer invokes recovery yet.

## Run inspection and failed-run retention

The internal owner run directory returns metadata for at most 100 request directories. States are derived as `claimed`, `started`, `failed` or `completed` from strict receipts. It returns request ID, generation, state, public timestamps and completed proposal ID only. It excludes source hashes, transcript/prompt/output, provider errors, capabilities and filesystem paths. Foreign owners see only their own empty or populated directory.

An explicit recent-owner retention operation deletes at most 100 strict failed runs older than both a supplied canonical cutoff and seven days. It takes the shared owner lock, validates start/failure binding and deletes oldest first. It never deletes claimed or started runs, completed evidence, a run whose expected proposal directory still exists, source generations, proposals, promotion receipts or personal memory. Corrupt/mixed terminal state fails closed before deletion.

Deletion is permanent and has no automatic schedule or retry. The operation fsyncs the runs directory after each removal. Current operational policy therefore retains all evidence unless an owner explicitly invokes this internal API; no route or UI exposes it yet.
