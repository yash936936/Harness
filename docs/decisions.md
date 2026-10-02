# Decisions — Coding Harness

> Append-only log. Newest entries at top. Never edit or delete past entries —
> if a decision is reversed, log a new entry that supersedes it and reference
> the old ID.

## D-060 — Measured on the owner's machine: similarity floor 0.60 for nomic-embed-text; indexing cost; incremental indexing — 2026-10-01
**Windows run (owner, 2026-10-01):** `tsc` clean; `npm test` 478 passed / 4 skipped (the 3
real-Ollama embedding tests ran because `HARNESS_OLLAMA_EMBED_MODEL` was set; the 4
skips are 3 older opt-ins plus the real-chat-model test); the smoke script passed every
check, including the scripted agent over the retrieval tools (2.6).
**Calibration (nomic-embed-text, prefixes `search_document:`/`search_query:`, this repo's `src/`
indexed, 6 questions):** best vector similarity 0.702-0.744 for the four answerable
questions and 0.480 / 0.515 for the two unanswerable ones, a clear gap. A floor of
**0.60** sits in the middle. Caveats: six questions, one model, one repository, questions
written by the same person who wrote the code; a legitimately vague question could score
around 0.55 and be dropped from the VECTOR side (the lexical side still answers it). The
code default stays unset because the right value depends on the model; set 0.60 wherever
nomic is configured (a profile, when one exists). `search()` also accepts `minVectorScore`
per call, and the smoke script now asserts that 0.60 keeps all four answerable questions and
drops both unanswerable ones whenever a real model is configured.
**Does weight help? (eyeballed top-3 at weights 0 / 0.5 / 1, four questions, no labelled
truth):** clearly better at 0.5 and 1 for "store vectors and find the nearest by cosine
similarity" (w=0 returned the ranker's own types; w>=0.5 returned the vector store's
types and implementation); slightly better for the ripgrep question (w=1 surfaced
`retrieval-grep/index.ts`); the same for tree-sitter; mixed for "embeddings in batches"
(w=0 put `Embeddings.embed`, the batching method, first, w=1 preferred the Ollama provider).
Verdict: 0.5 was never clearly worse and sometimes much better, so the default stays 0.5.
This is four questions judged by eye; Phase 6 needs a labelled benchmark. A pattern worth
testing there: interface/type chunks (`types.ts`) often outrank implementations.
**Cost:** indexing `src/` (49 files, 622 chunks) took **357 s** on the owner's CPU, about
0.6 s per chunk, so a 10,000-chunk project would take well over an hour. That is a
one-time cost only if re-indexing is cheap, and it was not: every run embedded everything.
**Decision:** `indexFiles` now opens the collection first and treats a file as unchanged when
the chunk ids stored for it are EXACTLY the ids it would produce now (ids contain the text
hash and the line range, so any edit changes them); unchanged files cost nothing,
changed files are replaced whole. Measured here: an unchanged re-index of 624 chunks embeds 0
and takes 0.5 s. A change that shifts line numbers (an inserted line near the top) changes the
ids of everything below it, so that file is re-embedded; per-chunk reuse inside a changed file
would need the stored vectors back and was not built. `onProgress(done, total)` reports
progress, and the smoke script keeps its index between runs (per embedding model, in the OS
temp folder).
**Not done:** a smaller or faster embedding model, trimming the text that is embedded,
parallel batches. If 6 minutes for a first index is too slow, those are the levers, and the
cost per chunk (not per file) is what to measure.
**Affects:** `src/bundles/retrieval-rank/` (incremental indexing, `onProgress`, per-call
`minVectorScore`), `src/bundles/vectorstore-lancedb/` (`idsForSource`), `scripts/smoke-phase2.ts`,
D-056, D-059.

## D-059 — Similarity floor for the vector side (`minVectorScore`), off by default — 2026-10-01
**Found by the 2.6 tests:** a vector index always returns its nearest neighbours,
even when nothing in the project is relevant. Pointed at a blog with one
gardening post, a question about payment retries returned that post; with the
shop project, a question about a secret returned an unrelated config constant.
Once an index exists the search tool therefore never says "no matches", and a
model handed junk can be misled. RRF makes it worse: a junk vector-only hit at
vector rank 1 outscores the lexical hit at rank 2.
**Decision:** `RetrievalRank` takes `minVectorScore` (cosine, -1 to 1): vector hits
below it are ignored and counted in `stats.belowFloorVectorHits`. **Default off**,
because there is no calibration data: with nomic-embed-text one measured pair gave
0.746 (paraphrase) vs 0.487 (unrelated), and the offline hashing provider shows no
separation at all. `scripts/smoke-phase2.ts` now prints the best vector similarity
for answerable and unanswerable questions so the owner can choose a value between
the two groups. Until one is set and measured, treat vector results as
unvalidated: the characterisation test `without a similarity floor ...` documents
the behaviour on purpose.
**Not decided:** the default value; whether a relative cutoff (against the
collection's score distribution) would be better than an absolute one. Phase 6's
labelled benchmark should settle both.
**Affects:** `src/bundles/retrieval-rank/`, any profile that enables hybrid search.

## D-058 — 2.6 needs a new bundle: `retrieval-tools` (read-only `search_code`, `list_code_files`) — 2026-10-01
**Decision:** The agent loop can only use retrieval through tools on `ctx.tools`,
which no phase listed (2.6 said "no new files"). `ctx.retrievalTools` registers
two tools, both `read-only`: `search_code(query, path?, k?)` and
`list_code_files(path?)`. Nothing here writes. They call the ranker and the grep
service, so root confinement and the secret/`.git`/`node_modules` exclusions hold
for everything the model can see. There is deliberately **no read-file tool**:
reading arbitrary files would bypass the secret exclusions and needs the Phase 5
policy gates first.
**Untrusted data:** a comment in a repo can say "ignore your instructions". Every
snippet is fenced `<<<CODE <nonce> #n file:a-b name via=...>>> ... <<<END <nonce>>>`
with a fresh random nonce per call that file content cannot know (a forged marker
cannot close the block), and the result opens with a line saying the blocks are data.
This is the part that has to live with the producer of the text; the general
input-guardrail hook (`agent/pre-step`) is still Phase 5.
**Model-facing text:** line numbers are printed (`12| code`) so answers can cite
them; output is capped (12000 chars): results that do not fit are dropped whole,
only a first result larger than the whole budget is cut; expected failures
(path outside the project, not found, no searchable terms) are `isError` results
with readable messages; `no matches` is a normal answer that suggests other words;
operator-facing reasons (fingerprint mismatch, etc.) are never shown to the model,
only "keyword ranking only; semantic search is currently unavailable".
`k` (max 20), `path` and `query` are model inputs; `weight` and the floor are not.
**How 2.6 is tested:** the real loop, registry, log, LLM service and the whole
retrieval stack, with a scripted model that decides ONLY from the transcript: it has
no knowledge of the fixture project, searches with words from the task, and answers
from the first code it is shown, citing the file and line as printed. Random 7-digit
values per run (cannot be memorised) must come back with the right file and line;
the first model request must not contain the value and the second must (inside the
tool result, byte-identical to the log). Negative controls: no search tool, a project
without the code, and a wrong-line check each make the same assertions fail.
Also covered: no embeddings, an unindexed project, an answer sharing no words with the
question (vectors only), an edited file (fresh text, never the indexed one), and a secret
in a visible `.pem` and a hidden `.env` that must never reach the transcript or the log.
**Limits, stated:** a scripted model proves the plumbing delivers usable context,
not that a real model uses it well. An opt-in test (`HARNESS_OLLAMA_CHAT_MODEL`) and
the smoke script run a real local chat model through the same pipeline; **that has not
been run by anyone yet**, and it needs a model with tool calling.
**Affects:** `src/bundles/retrieval-tools/`, `tsconfig.json` (now also type-checks
`scripts/`), Phase 2.6, Phase 5 (policy gates must cover these tools' action class),
Phase 6.

## D-057 — nomic-embed-text measured on the owner's machine; model pin still pending — 2026-09-30
**Observed (owner's Windows run, Node 22.18, ripgrep 15.2.0):** `ollama pull
nomic-embed-text` fetched 274 MB (weights layer `970aa74c0a90...`, as printed by
the pull); the embeddings produce 768 dimensions with the prefixes from D-054;
the same string twice gives the same vector; a batch of 20 is one request;
"sorts a list of numbers in ascending order" vs "orders an array from smallest
to largest" scored 0.746 against 0.487 for an unrelated text. The gap is real but
modest (raw cosines are compressed into a narrow band), which is why 2.5 fuses by
rank (D-056) rather than by raw score.
**Still open:** D-027 asks for the model's digest to be pinned; only a layer prefix
from the pull log is known. The owner should paste `ollama list` output.
Quality on code (not prose) has not been measured: Phase 6 needs a labelled
retrieval benchmark (recall@k) before anyone treats this as good.
**Affects:** `docs/decisions.md` D-054 (model choice), Phase 6.

## D-056 — 2.5 ranking: lexical candidates, BM25, optional vectors, weighted rank fusion — 2026-09-30
**Decision:** `ctx.retrievalRank` runs: query -> terms (identifier-aware tokens,
English stopwords removed) -> ripgrep finds files containing any term (2.1) ->
files become chunks (one per tree-sitter symbol, long symbols and code outside
symbols in windows, 2.2) -> BM25 over those chunks (a symbol's name counts extra:
`nameBoost` 2) -> if embeddings and the vector store work and `weight > 0`, the
nearest indexed chunks (2.4) are fetched and the two ranked lists are merged by
**weighted reciprocal-rank fusion**: `(1-w)/(60+rank_bm25) + w/(60+rank_vector)`.
`w = 0` is pure BM25 and never calls the embedding provider; `w = 1` orders by
vectors alone (BM25-only chunks follow); default 0.5; settable per call.
**Why rank fusion:** BM25 scores and cosine similarities live on unrelated scales
(D-057: unrelated text already scores 0.49), so mixing the numbers needs
calibration this project has no data for. Ranks need none. Ties go to the better
lexical rank, then file and line.
**Never fails because of the semantic side:** any embeddings, vector-store or
fingerprint problem returns the BM25 result with `degraded` saying why.
**Freshness:** chunk ids are `file#start-end#hash(text)`. Vector hits carry that
hash; at query time the lines are re-read from disk and a hit whose text changed
(or whose file is gone) is dropped and counted in `stats.staleVectorHits`. Nothing
stale is ever shown. Re-indexing a file is delete-by-source then upsert;
`indexFiles`, `indexProject` (uses the new `retrievalGrep.listFiles`, same
exclusions as search, so secrets are never indexed) and `unindexFiles` exist;
there is no file watcher, so keeping the index current is the caller's job.
**Safety:** it reads only regular files inside the real root, at most 1 MB, not
binary, and re-validates every path it is handed even though grep confines them
(tested against a misbehaving grep stage).
**Found in testing:** the embeddings service only learns its fingerprint after a
first vector, so indexing, clean-up and `unindexFiles` failed right after a
restart; they now embed one throwaway text to learn it.
**Limits, stated:** candidates are found lexically, so a question that shares no
word with the code is answered only through vectors, and only for files that were
indexed; BM25's idf is computed over the candidate chunks only, so scores are
comparable within one result, not across queries; stopwords are English; no
labelled benchmark yet (D-057). Opening the vector store loads a native module:
1-8 s on first use in a process.
**Affects:** `src/bundles/retrieval-rank/`, `src/bundles/retrieval-grep/` (added
`listFiles`), 2.6, the retrieval tool wrappers.

## D-055 — 2.4 vector store: embedded LanceDB pinned to 0.30.0 (not the latest), fingerprint-guarded collections — 2026-09-30
**Decision:** `ctx.vectorstore` (the architecture's name) is backed by embedded
`@lancedb/lancedb` **0.30.0** with `apache-arrow` **18.1.0**, both pinned exactly.
LanceDB loads lazily, so a machine that cannot load the native module only
fails when it uses this bundle. Exact (brute-force) cosine search; no ANN index.
**Why 0.30.0 and not 0.39.0 (verified on npm and by installing both):** from
0.31.0 on, LanceDB lists `@huggingface/transformers` and `openai` as
`optionalDependencies`, which npm installs by default. Measured as incremental
installs into the same tree (Linux): `node_modules` 130 MB -> 696 MB with 0.39.0
versus 130 MB -> 292 MB with 0.30.0, of which ~193 MB is the native binary itself
(the ~360 MB difference is onnxruntime and friends). A fresh `npm ci` of the final
lockfile measures 420 MB in total. 0.38+ also declares `node >= 22` while this repo
supports 20.3+ (the owner runs 22.18). 0.30.0 needs Node >= 18. Trade-off: an
older release without later fixes; revisit when the optional-dependency bloat
is gone. The peer range is `apache-arrow >=15 <=18.1.0` (latest is 21).
The lockfile carries the Windows binary (`@lancedb/lancedb-win32-x64-msvc`) with
its integrity hash. Licenses: LanceDB and Arrow are Apache-2.0.
**Design:** `open(name, {fingerprint, dimensions, reset?})` returns a collection
with `upsert`, `query(vector, k, {source?})`, `deleteIds`, `deleteSource`,
`count`. The fingerprint (from `ctx.embeddings.info()`, D-054) and dimensions are
stored in the table's own Arrow schema metadata (verified to survive reopen,
writes and deletes); opening with a different fingerprint fails with
`fingerprint_mismatch` (data untouched); `reset: true` rebuilds. A table this
store did not create is `corrupt`, never overwritten. `source` is typically a
file path: re-indexing a file is `deleteSource` then `upsert`. Failures are
result values, as in 2.1-2.3. Writes to a collection run one at a time in call
order.
**LanceDB behaviours found by experiment (each was silent; each now validated
and tested):** a double-quoted column in a filter is a string literal, so a
delete matched nothing (use backticks); a wrong-dimension vector is accepted and
stored; duplicate ids inside one merge-insert batch are both inserted (we keep
the last); a zero-vector query silently returns nothing (we reject it); a raw
cosine score can be 1.0000001 (clamped); `select()` without `_distance` prints a
deprecation warning on every query and will drop the column in a future release
(we select it explicitly). Delete filters with 200,000 ids worked, so no
chunking.
**Not covered:** no ANN index (a project's worth of chunks is fine, tens of
thousands of vectors and up will want one); only single-process use was tried;
Windows was not run.
**Affects:** `src/bundles/vectorstore-lancedb/`, `package.json`, 2.5 (hybrid
rank), 2.6.

## D-054 — 2.3 embeddings: local Ollama first; results not throws; remote refused until egress is wired — 2026-09-30
**Decision:** `ctx.embeddings` (flat name) has one active provider. The first,
and only supported, one is local Ollama: `POST /api/embed` with the whole batch
as `input`. `model` is required config with no default. An offline
`HashingEmbeddingProvider` (feature hashing, no semantics) exists so the
retrieval pipeline and its tests run without a model.
**Verified 2026-09-30 (docs/search, not run):** Ollama's `/api/embed` accepts an
array `input` and returns L2-normalised vectors. OpenRouter now serves
`POST /api/v1/embeddings` with free routes (`nvidia/nemotron-3-embed-1b:free`,
`liquid/lfm-2.5-embedding-350m:free`); free models have "low daily limits" (exact
numbers not found; chat is already capped at 50/day, D-023), and the Liquid
route's page says requests and embeddings "may be retained and used to train"
its models. Anthropic still not listed (D-028).
**Why local first:** free, no request quota (batching is for speed, not quota),
no source code leaves the machine, and Ollama is already required for the
reference worker. Amends D-008 ("no local model hosting for v1") as D-028
already allowed for "a small local model".
**Design:** `embed()` returns `{ok:true, vectors: Float32Array[]...} | {ok:false,
error}`; callers (the ranker) fall back to BM25 on any failure, so no failure
is thrown. Identical texts are embedded once; batches are bounded by count (32)
and characters (64000); texts over 8000 chars are cut (surrogate-safe) and
counted; task prefixes (`search_document: `/`search_query: ` for nomic) are
config; vectors are L2-normalised by default. `info().fingerprint` is
`provider:model:dimensions` and a later call with different dimensions fails
`dimension_mismatch`: vectors from different models are not comparable, so the
vector store (2.4) must key its data on the fingerprint. A call fails as a whole,
never with partial vectors.
**Safety:** a provider whose host is not loopback is refused (`consent`) before
any request, because the egress gate (consent, allowlist, redaction, D-029) is
not wired into this bundle. Remote providers (OpenRouter free routes, an
OpenAI-compatible provider) are a follow-up that must go through it.
**Not decided / open:** the embedding model is not pinned. The candidate is
`nomic-embed-text` (768 dims, needs the two prefixes above; a third-party page
gives ~274 MB), unevaluated for code. D-027 requires pinning the digest after
the owner runs `ollama pull`; `embeddinggemma` carries Gemma license terms, so
check them before choosing it given D-049.
**Affects:** `src/bundles/embeddings/`, 2.4 (fingerprint), 2.5 (BM25 fallback).

## D-053 — 2.2 retrieval-treesitter: web-tree-sitter (WASM), 4 languages, pure over source text — 2026-09-30
**Decision:** `ctx.retrievalParse` (flat name, per D-052) parses source text
with `web-tree-sitter@0.25.10` and grammars from `tree-sitter-wasms@0.1.13`
(both pinned exactly). Languages: TypeScript, TSX, JavaScript, Python.
`parse(source, {filename|language})` returns symbols (function, class,
method, interface, type, enum, namespace) with 1-based line ranges, a
one-line signature and an `exported` flag, plus `hasErrors`. It reads no
files: callers pass text, so which files may be read stays the caller's
decision (the tool-wrapper step, before 2.6).
**Why:** The native `tree-sitter` package builds through node-gyp, a real risk
on the owner's 8 GB Windows machine; the WASM build needs no toolchain. 0.25.10
rather than the newest 0.27.0 because the grammar wasms are older builds
(ABI 14, loaded and parsed fine on 0.25.10); 0.27.0 was not tried. Symbols come
from a walk over node types, not tree-sitter queries, which keeps the code
independent of the query API. Function bodies are deliberately not descended
into (nested functions are not retrieval units); classes and namespaces are.
**Limits, stated:** no parse timeout (web-tree-sitter's cancellation option is
not used); the input size cap (default 512K chars) is the only bound, and a
pathologically deep file ends in `parse_failed`, never an exception. WASM
memory is not garbage collected: every tree is deleted after use and every
parser when the plugin is disposed.
**Licenses:** web-tree-sitter MIT; tree-sitter-wasms Unlicense.
**Affects:** `src/bundles/retrieval-treesitter/`, `package.json`, Phase 2.2,
2.5 (consumes symbol line ranges as chunk boundaries).

## D-052 — 2.1 retrieval-grep design — 2026-09-30
**Decision:** `ctx.retrievalGrep` (flat name, same convention as
`ctx.agentLoop`; supersedes the nested `ctx.retrieval.grep` in earlier docs,
and 2.2 follows with `ctx.retrievalParse`). ripgrep runs through
`ctx.subprocess` with argv only: query after `-e`, target after `--`.
`includeSecrets` is config-only and adds `--hidden`; `.git` and `node_modules`
are excluded regardless. The built-in excludes come AFTER `extraArgs` because a
later `--glob` wins in ripgrep. Results carry the true `matchCount` (ranking key)
separately from the capped `matches`. Search paths resolve relative to the root,
are realpath'd and must stay inside it (`path.relative`, not `startsWith`,
so a sibling like `root-evil` is refused).
**Why:** ripgrep skips hidden files by default, so without `--hidden` the
`includeSecrets` switch did nothing; a prefix comparison accepts sibling
directories; ranking by the capped match list ties nearly every file.
**Not covered:** no scan-size limit (only output caps and a 10 s timeout);
only the five secret patterns in the spec are excluded.
**Affects:** `src/bundles/retrieval-grep/`, Phase 2.1.

## D-051 — Roles for Phase 2: reviewer writes the code for now — 2026-09-30
**Decision:** The 2026-09-29 plan (a generator model writes all code, the
reviewer only reviews and prompts) is paused after its first task. 2.1 and 2.2
were written directly by the reviewer and verified against real ripgrep and
real grammars. This supersedes the "opencode/generator does the coding" split in
`workflow.md` for now, the same way the Claude-only note in `context.md` did;
the owner will say when a generator re-enters.
**Why:** The generator's two submissions of 2.1 both failed on first contact
(see DBG-026); the owner chose to continue directly.
**Also recorded:** Phase 1 is treated as closed for Phase 2 purposes, but its
open items are carried, not done: 1B.4 (desktop app; Tauri still provisional,
D-048), 1.2b (live OpenRouter call, the 429 heuristic is unverified), and the
Qwen reference-worker license blocker (D-049).
**Affects:** `docs/workflow.md`, `context.md` role notes.

## D-046 — Needle: real sources found, license resolved for needle2/3, still no pin — 2026-09-29
**Found by searching (not recalled):** Needle's code is `github.com/cactus-compute/needle`
(GitHub's license detector and the PyPI `cactus-needle` page both say
Apache-2.0). Weights live on Hugging Face, not GitHub: `Cactus-Compute/needle2`
(45M) and `Cactus-Compute/needle3` (base checkpoint `needle3.safetensors`, 242 MB)
both carry an `apache-2.0` license tag on their HF pages. There is also
`Cactus-Compute/needle-hf` (30.4M, no model card, so no stated license) and
the original 26M `Cactus-Compute/needle`.
**What this changes in D-026:** its "sources disagree, MIT or Apache 2.0" is
explained: the MIT label I saw was on a *downstream fine-tune* of the 26M
original, not on Cactus-Compute's own repos. For needle2 and needle3 the
authoritative tags say Apache-2.0. The 26M original's own tag I did **not**
verify. D-026 also predates needle3 - there are now at least three
generations, so *which one to pin is a choice for the owner*, not a fact.
**Still no pin:** this sandbox cannot reach huggingface.co, so no digest
could be computed, and I did not read the LICENSE file's raw text (the fetch
tool refused the URL). Registering a pin needs a real download on the owner's
machine. `scripts/pin-from-file.ts` (`npm run pin`) hashes that file and prints
the record.
**Also:** Cactus telemetry (anonymous usage, opt out `NEEDLE_TELEMETRY=0`) is
in the Python package - relevant to D-020's "no telemetry" wording if Needle is
ever run through it. Not evaluated here.

## D-050 — Needle pin registered — 2026-09-29
`NEEDLE_PIN` (`model-store/pins.ts`): `needle2`, source `cactus-compute`, HF
commit `32e9e3a9...9f84579`, sha256 `b43aabfc...ede5ba` of `needle2/needle2.cact`
(hashed by `npm run pin` on the owner's machine), Apache-2.0 (downloaded LICENSE
read). Registered in the wizard's ModelStore; **no binding** until the router
(Phase 4.5). Pinned the `.cact` weights only; the native binaries and Python
wheels in the download are unpinned, and `checkpoints/needle2.pkl` (a pickle)
must never be loaded. Whether `.cact` is the format the Cactus runtime loads is
Claude's assumption, unverified. Cactus's Python package has telemetry (D-046).
**Affects:** Phase 1B.3 (last open criterion closed), Phase 4.5.

## D-049 — Needle generation: needle2; commercial use is in scope — 2026-09-29
**Decision (owner):** pin `Cactus-Compute/needle2` (45M), not needle3 or the 26M
original. Owner also answered **yes** to whether commercial use of the harness
is ever possible (as read by Claude; the answer was a bare "yes").
**Consequences:** (1) The reference worker `qwen2.5-coder:3b-instruct` is under
the Qwen Research License (non-commercial only, D-042), so it is a **release
blocker for any commercial use**: swap it for a permissively licensed model or
obtain a commercial license from Alibaba Cloud. As far as I know some other
Qwen2.5-Coder sizes are Apache-2.0, but that must be checked per model with
`ollama show --license`, not assumed. (2) needle2's Apache-2.0 tag was read from
its Hugging Face page only; the downloaded `LICENSE` file still has to be read
before registering the pin.
**Not yet done:** the needle2 pin itself - needs the weights file's real SHA-256
and the HF commit hash from the owner's download (`npm run pin`).
**Affects:** Phase 1B.3, Phase 4.5, release planning.

## D-048 — Desktop shell: Tauri, provisional pending a Node-sidecar measurement — 2026-09-29
**Measured (owner's 8 GB Windows machine, hello-world shells, valid rerun):**
| | Electron | Tauri |
|---|---|---|
| Installer | 146.4 MB | 1.3 MB |
| Cold start, samples ms | 9878;397;372;336;351 | 2158;1567;837;842;844 |
| Cold start, warm runs | ~365 ms | ~840 ms (marker fires early, true time later) |
| Idle working set, process tree | 530.7 MB (5 procs) | 362.0 MB (7 procs incl. WebView2) |
**Decision:** Tauri, provisionally. Reasons: about 169 MB less idle memory
(32%), a two-orders-of-magnitude smaller installer, and Tauri 2 targets Android
and iOS, which matches the owner's stated laptop-and-mobile goal; Electron
cannot.
**Against, and why it is provisional:** (1) Electron starts about 2.3x faster
warm; both are under a second, so this is minor for a rarely-launched app. (2)
The core is Node/TypeScript: Electron hosts it in-process, Tauri needs it as a
sidecar process, adding its own idle memory and bundling size. That is unmeasured
and could shrink the 169 MB gap materially. (3) Tauri adds Rust to the toolchain
and a second language at the IPC boundary. (4) Working set double-counts shared
pages, so both figures are overstated, probably Tauri's more (WebView2 shares
heavily); private bytes would be fairer. (5) One 5 s sample per shell.
**Revisit if:** the sidecar measurement puts Tauri+core within roughly 50 MB of
Electron+core, or Rust maintenance cost proves too high.
**Note:** the local model, not the shell, is the dominant 8 GB consumer; this
choice is second-order to that budget.
**Affects:** Phase 1B.4, `app/desktop/`.

## D-047 — First bench run: sizes and start times usable, idle memory invalid — 2026-09-29
**Measured (owner's 8 GB machine, hello-world shells only):** Electron installer
146.4 MB, Tauri 1.3 MB. Cold start samples (ms): Electron 14721;576;414;355;328
(median 414), Tauri 2350;1341;868;770;745 (median 868). **Idle memory recorded
0.0 for both - invalid, not a finding.** Cause: D-045 matched processes by image
name and returned 0 on no match; it also could never have counted Tauri's
`msedgewebview2.exe` children. Fixed: sum the launched process tree by PID and
fail loudly on empty (`sumTreeWorkingSetMB`, 3 tests).
**No shell chosen.** D-025 needs idle memory. Reasons the current numbers cannot
decide it alone: (1) the 1.3 MB Tauri figure excludes the Node core, which a
Tauri app must ship as a sidecar while Electron can host it in-process; (2)
Tauri's cold-start marker fires at webview creation, so its true time is later
than 745-2350; (3) sample 1 in both is a first-launch outlier and both series
were still falling, so 5 runs did not converge; (4) WebView2 is a system
dependency not counted in Tauri's size.
**Affects:** `app/desktop/bench/`, Phase 1B.4.

## D-045 — 1B.4 measurement toolkit, unmeasured by design — 2026-09-29
`app/desktop/bench/` scaffolds a minimal Electron app (via `create-electron-app`)
and a minimal Tauri app (via `create-tauri-app`), builds an installer for each,
and records installer size, average cold start over 5 runs, and idle working
set into `results.csv`. **No numbers exist yet** - D-025 requires the choice to
be made from real measurements on the 8 GB machine. Verified here: the file
walking, size, CSV, cold-start timer and `tasklist` parsing (against fakes).
Not verified: the Electron/Tauri builds and both source patches (Electron's
binary download and Rust are unreachable from this sandbox). Caveat: no
long-running core process exists in this codebase, so "idle memory with the
core running" is measured as the shell alone. Tauri's cold-start marker fires
in `setup()`, not on paint, so it may under-count versus Electron.

## D-044 — Blocked budget calls are now audit events — 2026-09-29
Your real run showed a budget-blocked call left no trace, contradicting
`docs/trd.md` (every rejection is a session-log event). `run.ts` now creates
the session *before* the spend check and logs `budget.blocked` (metric, scope,
status) into it; failed results carry the `sessionId`. Consent refusals were
already logged by `LLMService` as `model.blocked`. Test asserts the event exists
on the blocked session and that a `model.request` exists for the successful one;
mutation (remove the append) was caught.

## D-043 — `harness run`, installed-vs-pinned, local connection timeout — 2026-09-29
**Decision:** three changes, prompted by your real runs.
1. **`src/cli/run.ts` (`runTask`, `npm run harness -- run ...`)** - one
   prompt, one call through the real `LLMService`, not an agent loop. Boots
   `SessionLog` + `EgressPolicy` + `LLMService` + `AppCore`; sets the
   binding's `egress.consent` from the project's recorded consent (so both
   D-022/D-029 gates are real); spends one request *before* the call, so a
   refused call never reaches the provider. Every attempt counts against the
   budget, including failed ones (metered providers bill attempts). The day's
   budget persists in `<stateDir>/budget.json` (default `.harness/`). This is
   the call site 1B.2's offline-start and budget-stop tests were waiting on.
2. **Installed-vs-pinned:** `OllamaProvider.listInstalledModels()` (name +
   digest from `/api/tags`), `ModelStore.checkInstalled()` comparing
   `sourceDigest` (not `sha256`, D-042), `doctor`'s optional 5th parameter
   and `report.installed`. Statuses: matches_pin / differs_from_pin /
   not_installed / unchecked. The wizard fills it in for Ollama providers.
3. **Connection timeout:** `defaultConnectionTimeoutMs` - 120 s for a local
   (loopback) provider, 20 s otherwise. Your wizard run took 14.2 s on a cold
   load, so a 20 s cap was one slow start from a false "timeout".
**"Offline" means:** boot makes no network call; the run prints whether the
provider works offline (local) or needs the network (cloud); a network
failure is a clean `provider` error, not a crash. It does not mean the
harness verifies your network is off.
**Not built:** no agent loop, tool use or streaming in `run`; `run` doesn't
persist provider config (flags each time); Needle still has no pin.
**Affects:** `src/cli/run.ts`, `src/cli/index.ts`, `ollama.ts`,
`model-store/{types,index}.ts`, `app-core/{doctor,index,provider-connection}.ts`,
`src/cli/wizard.ts`, `package.json` (`"harness"` script).

## D-042 — First real pin: the reference worker, and its license is non-commercial — 2026-09-28
**Decision:** `REFERENCE_WORKER_PIN` (`model-store/pins.ts`) records
`qwen2.5-coder:3b-instruct` from output the owner pasted after a real
`ollama pull` (2026-09-28): `sha256` = the weights blob hash
`4a188102020e...bba` (from the modelfile's `FROM ...\blobs\sha256-` path; Ollama
printed the same prefix while "verifying sha256 digest"), `sourceDigest` =
`f72c60cabf62...225` (`/api/tags` `digest` = `ollama list` ID). These are
**two different digests**, so `ModelRecord` gained an optional `sourceDigest`;
`verifyDigest`/`verifyFile` only ever check `sha256`. `sha256File` and
`ModelStore.verifyFile` (streamed hash of a blob on disk) were added so the
pin can be re-checked against the real file. The wizard now boots
`ModelStore` with this pin and a `worker` binding and passes it to `doctor`.
**License finding (new, and it matters):** `ollama show --license` printed
the **Qwen RESEARCH LICENSE AGREEMENT** (2024-09-19), not Apache-2.0. Its
grant (s.2a) is for **non-commercial purposes only**; commercial use needs a
separate license from Alibaba Cloud (s.2b). It also has redistribution and
attribution terms (s.3) and a "Built with Qwen" rule if outputs are used to
train a distributed model (s.4b). D-030 picked this model for RAM headroom
and never recorded its license. Fine for personal/research use; a blocker
if this harness or its outputs are ever used commercially - that is the
owner's call, not something this pin resolves.
**Doctor wording:** binding lines now say "pin registered" / "fallback
registered", because `resolve()` only knows what is registered, not what is
installed in Ollama. A real installed-and-matching check would compare
against `/api/tags` (`sourceDigest`) or hash the blob (`verifyFile`) - not built.
**Still open:** Needle (D-026) has no pin - no source or digest supplied.
The tag is mutable, so re-pulling may change the hash.
**Affects:** `model-store/{types,pins,index}.ts`, `src/cli/wizard.ts`,
`docs/phases.md` 1B.3.

## D-041 — Model store: fixed source allowlist, in-memory, no pre-registered models — 2026-09-27
**Decision:** `src/bundles/model-store/` (`ModelStore`, a Cordis Service -
`ctx.modelStore`) implements D-027/D-026: `register()` refuses a source
outside a fixed, closed allowlist (`ollama-library`, `ornith-ai`,
`cactus-compute` - the exact three sources named across D-026/D-027/
`docs/architecture.md`'s dependency table, nothing added beyond what's
already grounded there) and refuses to silently overwrite an existing id.
`verifyDigest(id, actualSha256)` throws `ModelStoreError('digest_mismatch')`
on any mismatch, case-insensitively. Each `Binding` (name, pinned model ID,
ordered fallback IDs) resolves via `resolve()`/`resolveAll()` to: the pin,
if registered; else the first registered fallback in order; else
`unavailable: true`. `doctor` (D-039) gained an optional fourth parameter,
`models: ModelStoreSource` (an interface - `resolveAll(): ModelAvailability[]`
- mirroring `EgressStatusSource`'s existing pattern), and reports a
`models` field only when one is passed; absent, not an empty array, when
it isn't - satisfies 1B.3's "unavailable-pinned-model test in `doctor`"
success criterion without inventing a claim about a binding nothing
configured.
**Why no pre-registered models:** D-030 names `qwen2.5-coder:3b-instruct`
as the reference worker and D-026 names Needle's origin, but neither
decision recorded a checked SHA-256 for a specific pulled revision -
seeding the store with an invented hash under either name would be the
same fabricated-claim failure mode `consent-copy.ts` (D-020, D-037)
already exists to avoid, just for a digest instead of a privacy claim.
This sandbox also has no network access to Ollama's registry or Hugging
Face (the `bash_tool` domain allowlist covers package registries and
GitHub, not model hosts), so there was no way to compute a real one here
even if it seemed worth doing. Real pins get registered once someone runs
`ollama pull` (or equivalent) for real, on a machine that can, and
computes the real digest.
**Why in-memory only:** the same reason - persistence (mirroring
`credentials.ts`/`budgets.ts`'s own file-backed pattern) is a follow-up
once a real caller has real pins worth surviving a restart. Building
persistence now, against no real data, would be persistence with nothing
worth persisting.
**Not wired into the wizard yet:** `src/cli/wizard.ts` doesn't construct a
`ModelStore` or pass one to `doctor()` - `report.models` stays absent on
every real wizard run today. Wiring it in is a later slice, the same
incremental pattern every other 1B.2 piece followed (built and tested
standalone first, wired into the wizard last).
**Affects:** new `src/bundles/model-store/` (`types.ts`, `index.ts`),
`bundle-app-core/doctor.ts` (`ModelStoreSource`, `DoctorReport.models`),
`AppCore.doctor`'s signature, `src/cli/wizard.ts`'s `formatDoctorReport`.

## D-040 — Terminal wizard CLI: setup-only, `WizardIO`-abstracted, TerminalIO doesn't mask secrets yet — 2026-09-26
**Decision:** `src/cli/` is the first real integration point for 1B.2 -
`runWizard` (`wizard.ts`) walks provider setup, credential storage, the
connection test, the consent screen, an optional daily budget, and ends
with a `doctor` report, all against a real `Context` it boots itself
(`EgressPolicy` + `AppCore` - the first place either is booted alongside
the other; `bootProfileMinimal` still doesn't touch `AppCore`, see D-039).
`runWizard` takes a `WizardIO` (`print`/`ask`/`confirm`) rather than
talking to `process.stdin`/`stdout` directly, so the whole flow is
scriptable in tests without a real terminal; `TerminalIO` (`io.ts`) is the
real `node:readline/promises`-backed implementation, and `index.ts` is the
five-line entrypoint that wires `TerminalIO` in and sets `process.exitCode`.
**Why setup-only:** the wizard does not register the provider on `ctx.llm`,
boot `LLMService`, or set `ModelAdapterConfig.egress.consent` (D-022's
separate binding-level flag) - there is no "run a task" command yet for
that provider to serve. It ends at a real, `doctor`-verified project
configuration, not a running session. Extending it to actually run
something is a later, separate decision once that command exists.
**`TerminalIO.secret` does not mask input** - `ask(prompt, { secret: true
})` only prints a one-line "not masked" warning before a normal, visible
prompt. A real masked-input implementation needs raw-mode stdin, which
fights with readline's own stdin listener on the same stream and - more to
the point - isn't exercisable by any automated test (vitest has no real
TTY), so shipping it for a path whose entire job is handling a secret
correctly was judged worse than being honest that it doesn't mask yet.
Logged here rather than left as a silent gap.
**Found by hand, not by a test (real limitation, real bug):**
- A genuine Node `readline/promises` limitation: multiple sequential
  `rl.question()` calls hang after the first one when stdin is piped
  (non-TTY) - confirmed with a 4-line isolated repro and by piping into
  the actual CLI (both stalled after the first question). Confirmed via a
  real pty (Python's `pty` module driving the actual CLI with scripted,
  delayed keystrokes) that this is TTY-input-specific: interactive
  terminal use - the wizard's actual intended use - works correctly
  through all four prompt types. No test in this repo can exercise this
  either way (vitest has no TTY, and a pty-based harness is a bigger
  investment than this slice warrants) - this is a spot-check, not
  something CI verifies, same caveat class as "not tested against a real
  Ollama/OpenRouter host" from D-038.
- A real bug, not a Node limitation: `index.ts`'s first version called
  `process.exit(code)` directly after `runWizard` resolved. When stdout is
  piped rather than a real TTY, writes can be asynchronous, and
  `process.exit()` terminated the process before the buffered output
  actually flushed - the pty smoke test showed output cut off mid-run.
  Fixed by setting `process.exitCode` and letting the event loop drain
  naturally (`rl.close()` inside `io.close()` is what lets the process
  exit on its own) - the standard fix for this class of bug. Re-ran the
  pty smoke test clean afterward, full mock-provider flow end to end,
  exit status 0.
**Affects:** new `src/cli/` (`io.ts`, `wizard.ts`, `index.ts`), `package.json`
(`"wizard"` script).

## D-039 — `doctor` scoped to what's actually built — 2026-09-26
**Decision:** `ctx.appCore.doctor(egress)` reports only budgets remaining,
which credential-store backend is active, current consent state, and the
egress allowlist. It does **not** report an "active binding" (no
`ctx.llm` provider selection concept it can read - a binding is picked per
call, not pinned), remote-sandbox destinations (no sandbox bundle exists),
pinned-model availability (1B.3 doesn't exist yet), or what still works
offline (same reason).
**Why:** The design draft's `doctor` (`docs/phases.md` 1B.2's original
success criteria) describes the full picture once every phase is built.
Reporting on pieces that don't exist would mean inventing data - the same
stance `consent-copy.ts` already takes (D-037) for a provider's data
policy: no checked source, no claim. `doctor` gets extended, not rewritten,
as 1B.3 and Phase 5 land.
**Also decided:** `AppCore.doctor()` takes an `EgressStatusSource`
(anything with a `status(): Promise<EgressStatus>` method) as a parameter
rather than reading `ctx.egress` itself, mirroring `consentScreen`'s
existing egress parameter (D-037) - `bundle-app-core` still isn't wired
into any profile (nothing calls `ctx.plugin(AppCore, ...)` yet; every
piece so far is booted and tested standalone), so it has no Cordis-injected
service to read from. `EgressPolicy` gained a new `status()` method
(read-only: current consent record + allowlist, no mutation) and
`AutoCredentialStore` gained `which()` (`'primary' | 'fallback'`, backed
by the same cached probe verdict `resolve()` already computes) so `doctor`
has something real to report instead of guessing from the outside.
**Affects:** `bundle-app-core` (`doctor.ts`), `bundle-egress`
(`EgressPolicy.status`, `EgressStatus` type), `bundle-app-core/credentials.ts`
(`AutoCredentialStore.which`, `describeCredentialStore`).

## D-038 — Provider connection test: a third, narrower consent gate — 2026-09-26
**Decision:** `testProviderConnection` (`src/bundles/app-core/provider-connection.ts`)
takes an already-constructed `LLMProvider` and runs a best-effort model
listing plus one tiny timed probe call. For a remote provider it refuses
unless the caller passes `acknowledgeRemote: true`, but it does **not**
check `ctx.egress`'s persisted per-project consent (D-029) or go through
`LLMService.complete` at all.
**Why:** The wizard's own screen order is connection test, then the consent
screen (`docs/phases.md` 1B.4) — persisted project consent doesn't exist
yet at the point a connection test needs to run, so the test can't depend
on it. `acknowledgeRemote` is a distinct, narrower, one-off gate: "the user
just typed this key/host and clicked test", not "the project may use this
provider going forward". Testing also has to work before the provider is
registered on `ctx.llm` at all (the point of the test is to decide whether
it's worth registering), so it can't be looked up by name — the caller
passes a provider instance directly.
**Also decided:** the shared timeout deadline covers *both* the model
listing and the probe call, not just the probe — found by hand (a
mutation-checked test, not a design guess) that a hung `/models` endpoint
would otherwise hang the whole test forever, since listing was originally
unbounded. A timed-out listing call is reported inside `models.error`
(best-effort, never fails the overall `ok`) unless the deadline is used up
entirely by listing, in which case the whole result is `ok: false, kind:
'timeout'` rather than silently skipping the probe.
**Not built:** this connection test intentionally does not write to the
session log (no session exists yet at wizard time, same reasoning as
`budgets`/`credentials` not logging) and does not spend budget
(`ctx.appCore.budgets`) — it's a setup-time check, not a task.
**Affects:** `bundle-app-core`, 1B.2, `bundle-model-adapter` (`LLMProvider.listModels?`,
implemented for `OllamaProvider` and `OpenAICompatibleProvider`).

## D-037 — 1B.2 consent copy: dated, sourced claims only, never a fabricated one — 2026-09-24
**Decision:** `ctx.appCore.consentScreen(providerName, egress?)` returns
D-020's general statement (unconditional - no telemetry of our own; local
keeps everything on-machine; cloud sends what the model sees under that
provider's own, unverifiable policy) plus the specific binding's plain-
language destination plus, only when one exists, that provider's data
policy as a paraphrased, dated, sourced claim. `lookupProviderPolicy`
returns `undefined` - not a guess, not a generic "generally considered
safe" placeholder - for any provider not in a small curated registry.
Currently two entries, both checked against a real source before being
written: `ollama` (it is the local runtime, not a hosted service; nothing
leaves via Ollama itself unless pointed at a remote host, which then has
its own separate policy) and `openrouter` (web-searched
openrouter.ai/docs/guides/privacy/provider-logging on 2026-09-24 - no
prompt/response storage or training by default unless logging is
explicitly opted into for a discount; every request still crosses
OpenRouter's own boundary and the underlying routed provider's separate
boundary, which can vary by model/endpoint; an account-level Zero Data
Retention setting exists).
**Why paraphrase instead of quoting the provider's policy text:**
copyright (this project's own constraints elsewhere already treat
verbatim reproduction of another party's text as something to avoid by
default) and also honesty - a paraphrase in our own words, with a source
link and a check date, makes it visibly *our summary of their claim* as
of a point in time, not their legal text presented as if this harness
endorses or guarantees it.
**Why an unknown provider gets an explicit "no checked policy on file"
line rather than silence:** silence could read as "nothing to worry
about here"; the destination text says so directly instead, so the
absence of a claim is itself information the person sees, not a gap they
have to notice on their own.
**Affects:** `src/bundles/app-core/consent-copy.ts`, `index.ts`
(`AppCore.consentScreen`), D-020 (implements its "consent copy" affect
line), `docs/phases.md` 1B.2 (still open: provider connection, `doctor`,
the terminal wizard CLI, offline-start test).

## D-036 — 1B.2 credentials: OS keychain, verified with a probe, not trusted blind — 2026-09-24
**Decision:** `ctx.appCore.credentials` is an `AutoCredentialStore`
wrapping `KeychainCredentialStore` (`@napi-rs/keyring` - Windows
Credential Manager / macOS Keychain / Linux Secret Service, prebuilt
binaries, no native build tooling required) as primary and
`FileCredentialStore` (AES-256-GCM, key in a sibling file) as fallback.
Before trusting the keychain for anything, `AutoCredentialStore` writes a
probe value, reads it back, and only uses the keychain if the read
matches what was written; otherwise every call for the lifetime of the
instance goes to the file store. The verdict is resolved once and cached,
not re-checked per call.
**Why verify with a round-trip instead of just try/catching each call:**
checked the real library by hand rather than assuming its failure mode.
In a headless container with no live secret-service session,
`Entry.getPassword()` on a missing key returned `null` with **no throw**,
while `Entry.setPassword()` threw `"Couldn't access platform storage:
AccessDenied"`. That means a broken backend and a genuinely-empty one are
indistinguishable from a bare `get()` alone - a naive per-call try/catch
would let a broken keychain masquerade as "no credential stored yet" and
the wizard would keep re-prompting for a key it thinks was never saved,
or silently lose one that was. The probe forces a write+read+compare
before anything is trusted, so this failure mode is caught once, up
front, rather than surfacing later as a confusing "credential missing"
report from `doctor`.
**Why `FileCredentialStore` encrypts rather than just writing plain
JSON, and why that encryption's limit is stated rather than
glossed over:** AES-256-GCM with a random key stops a credential from
sitting in plain text - real protection against passive exposure (a
backup tool, a sync client, disk loss without full-disk encryption). It
does **not** protect against another process running as the same OS
user, since the key file sits on the same disk, readable the same way.
That's a real, stated limitation (see the class's own doc comment), not
claimed away - the keychain path is what actually defends against a
same-user attacker; the file store exists for when that path isn't
available.
**New dependency:** `@napi-rs/keyring` (`^2.1.0`). Checked before
adding: ships prebuilt binaries per-platform as optional dependencies
(same pattern as `esbuild`), `@napi-rs/keyring-win32-x64-msvc` is among
them - no Visual Studio build tools needed on the target 8 GB Windows
machine (owner's stated concern, matches D-025's "the shell must fit the
8 GB host budget" reasoning extended to every new dependency, not just
the desktop shell itself).
**Affects:** `src/bundles/app-core/credentials.ts`, `package.json` (new
dependency), `docs/phases.md` 1B.2 (still in progress - `doctor`, consent
copy, provider connection, and the wizard CLI remain).

## D-035 — 1B.2 budgets: all-or-nothing spend, day counter persists like the rate limiter — 2026-09-24
**Decision:** New `bundle-app-core` (`ctx.appCore`) starts 1B.2 with just
`Budgets` (`ctx.appCore.budgets`): requests/tokens tracked at three scopes
(`task`, `session` in-memory and caller-reset; `day` UTC-rolling,
optionally persisted to one JSON file the same way `RateLimiter` persists
its daily counter, D-023). `spend(metric, amount)` checks task, then
session, then day against each one's `hard` limit *before* recording
anything anywhere - if any scope would be pushed over, nothing is
recorded in any scope, and the thrown `BudgetExceededError` carries a
full status snapshot across every scope and metric, not just the number
that tripped it.
**Why all-or-nothing across scopes, not per-scope:** a spend that's fine
for `session` but blown for `day` (say) should not leave `session`
partially incremented while `day` refuses it - that would make the three
counters drift out of sync with each other and with reality (what was
actually spent). Checking every scope first, then applying once, keeps
"used" meaning the same thing everywhere.
**Why the day counter's persistence design copies `RateLimiter`'s rather
than reusing it directly:** same shape (UTC day key, atomic write via
temp-file-then-rename, corrupt/missing file treated as no prior state)
but a different unit of persistence (budget spend, not a request
timestamp window) and a different consumer (the wizard/`doctor`, not
`LLMService`) - copying the pattern was simpler and more honest than
forcing a shared abstraction across two things that happen to rhyme
structurally but serve different bundles.
**Not yet wired to a spender:** nothing calls `Budgets.spend()` yet -
agent-loop and model-adapter are unmodified. This is deliberately staged:
1B.2 is being built as a sliced sequence (budgets → credential storage →
consent copy → connection test/`doctor` → the terminal wizard CLI that
ties it together), same pattern as 1.2b/1.6/1B.1. Reopen this note once a
real call site spends against it - that's also the point the
"budget-stop test" from `docs/phases.md`'s testing list becomes possible
to write (it needs something spending to stop).
**Affects:** `src/bundles/app-core/`, `docs/phases.md` 1B.2 (in progress,
not done), `docs/architecture.md`.

## D-034 — 1B.1 egress controls: a second, independent consent gate, not a replacement — 2026-09-24
**Decision:** New `bundle-egress` (`ctx.egress`) adds per-project consent
(persisted via `FileConsentStore`, in-memory `MemoryConsentStore` for
tests/default), an endpoint allowlist, and payload redaction
(`redact`/`redactValue`). `LLMService` now requires `ctx.egress`
(`static inject`) and checks it *in addition to* the existing D-022
binding flag (`ModelAdapterConfig.egress.consent`) - both must pass for a
remote call to proceed, checked as two separate, independently-testable
conditions (`no_project_consent` vs `no_egress_consent` as distinct
`model.blocked` reasons). Redaction runs on the request body right before
it is logged and right before it is sent, so a redacted payload is what
both the provider and the session log see. `bootProfileMinimal()` boots
`bundle-egress` unconditionally, before `model-adapter`, with no config
flag that skips it.
**Why kept as two gates instead of merging into one:** the binding flag
(D-022) answers "is this specific provider binding configured to attempt
remote calls at all" - a code/config-time fact. The project consent record
(D-029) answers "has this project actually been asked and agreed" - a
persisted, user-decision fact, meant to survive process restarts and be
inspectable independently (e.g. by a future `doctor` command, 1B.2).
Collapsing them into one flag would make it impossible to tell, from the
outside, which one a refusal was actually about — which is exactly the
ambiguity a consent system shouldn't have.
**What "secrets proxy" ended up meaning:** the provider's own API key was
already never part of `CompletionRequest`/`ProviderRequest` — it lives in
each provider's private config, added only at the HTTP header inside
`send()` — so it was already structurally excluded from the session log
and every prompt before this phase (D-022's design, not new). There was no
proxy left to build for that specific case. What 1B.1 actually adds is
`redactValue`: scrubbing *other* secrets that could legitimately ride
along inside message content or tool output (a credential embedded in a
file the agent read, for example) — registered once by name/value, matched
verbatim, and never trusted to a model's own judgment about what to
withhold.
**Known limitations, not closed by this decision:** `FileConsentStore` is
a plain read-modify-write JSON file — correct for one process, not
concurrency-safe. Redaction matches literal registered values only, not
secret-shaped patterns in general (e.g. it will not catch an unregistered
credential it was never told about) — pattern-based detection, if wanted,
is a separate, later addition. Consent-screen copy and the interactive
wizard are 1B.2, not this decision.
**Affects:** `src/bundles/egress/`, `src/bundles/model-adapter/index.ts`
(`LLMService.complete`), `src/profiles/profile-minimal.ts`
(`ProfileMinimalConfig.projectId` is now required), every test file that
boots `LLMService` (`test/model-adapter.test.ts`, `test/agent-loop.test.ts`,
`test/openai-compatible.test.ts`, `test/profile-minimal.test.ts`), D-022,
D-029.

## D-033 — `profile-minimal` boots via a TS composer, not real `cordis.patch.yml` — 2026-09-24
**Decision:** 1.6 (`profile-minimal` end-to-end wiring) is implemented as
`bootProfileMinimal()` (`src/profiles/profile-minimal.ts`), a plain
function that calls `ctx.plugin()` for each 1.1-1.5 bundle in dependency
order behind one config object. `profile-minimal.yml` exists alongside it
as a human-readable config-shape reference only; it is not parsed or
auto-loaded by anything at boot.
**Why:** Checked `node_modules/cordis/package.json` directly — YAML-driven
boot (`cordis.patch.yml`, hot reload, plugin groups) is `@cordisjs/plugin-
loader` + `@cordisjs/plugin-include`, both listed as *optional* peer
dependencies of `cordis`, neither installed (`package.json` only lists bare
`cordis`). Pulling that loader in means adopting its own config schema and
lifecycle machinery for a single, fixed 5-bundle stack that doesn't need
hot reload or multiple named profiles on disk yet. The 1.6 success
criterion ("boots from a single config resolution... no manual wiring
steps") is satisfied by the one-function-call shape; the specific
`cordis.patch.yml` mechanism named in the original design draft was never
verified against what's actually installed until now.
**Affects:** `src/profiles/profile-minimal.ts`, `docs/phases.md` 1.6,
`docs/architecture.md` (file tree / "External dependencies"). Reopen when
`profile-research` or `profile-full` need multiple named, independently
loadable profiles, or hot reload — that's the point where the real loader
earns its complexity.

## D-032 — D-031 resolved: Windows env-injection is a Node platform behavior, not a leak — 2026-09-22
**Decision:** Root cause confirmed. The owner ran
`scripts/diagnose-windows-env.cjs` (independent of this project's code) on
their Windows machine: `env: {}` and `env: { ONE: '1' }` both produced the
identical 11 extra variables (HOMEDRIVE, HOMEPATH, LOGONSERVER, PATH,
SYSTEMDRIVE, SYSTEMROOT, TEMP, USERDOMAIN, USERNAME, USERPROFILE, WINDIR).
This is Node's own `child_process` behavior on Windows — it always injects
this fixed baseline when spawning, regardless of the `env` option, because
Windows needs several of them (`SystemRoot` in particular) to launch a
process at all. There is no flag in Node's public API to suppress it. This
is not a bug in `Subprocess.run`, not specific to the owner's machine, and
not something antivirus or a shell wrapper added — the raw `spawnSync`
repro proved that on its own, with zero involvement from our code.
None of the 11 are secrets — they're standard OS/user-profile names and
paths, not credentials — and the owner's actual test secret did not leak in
either Windows run. `PATH` does disclose installed tool locations, which is
a minor information exposure, not a credential leak.
**What changed:** added `WINDOWS_REQUIRED_ENV_VARS` (`src/bundles/subprocess/types.ts`)
as an explicit, documented, platform-conditional constant (empty on POSIX,
the 11-item list on `win32`). The 1.4 security tests now assert the
achievable property — nothing beyond the caller's allowlist and this fixed,
documented baseline ever reaches a spawned child — instead of literal empty-
object equality, which Node cannot deliver on Windows. A dedicated test
pins the baseline's exact contents so a future Node version changing it
shows up as a specific, readable failure rather than silently weakening the
allowlist's real guarantee.
**What did NOT change:** the "no implicit base set" *design intent* still
holds for anything under the harness's own control — the harness itself
adds nothing beyond what's allowlisted. The revised claim is "no implicit
base set beyond a small, fixed, non-secret Windows platform requirement,"
not "no implicit base set, full stop." `docs/readme.md` and
`docs/code_logic.md` are corrected to say this precisely rather than the
absolute version D-031 showed to be false on Windows.
**Unblocks:** 1.6 (`profile-minimal`), which D-031 had explicitly gated.
**Residual assumption:** the exact 11-item list and casing (`PATH` not
`Path`) was observed on one Node v22.18.0/Windows 11 combination. A
different Node or Windows version could inject a different set; the
dedicated baseline test (not a silent pass-through) is what would catch
that, not an assumption that this list is universal.
**Affects:** `docs/phases.md` (1.4 status, 1.6 un-gated), `docs/readme.md`,
`docs/code_logic.md`, supersedes the "not verified" framing in D-031
without deleting that entry — the investigation and its data stay on record.

## D-031 — Env-allowlist leak on Windows: confirmed, not yet root-caused — 2026-09-22
**Decision:** Do not treat 1.4's env-allowlist promise ("no implicit base
set, not even PATH") as verified on Windows. The owner's own test run on
Windows showed 3 of 5 security tests failing: a child spawned with a
1-key or empty `env` object still received PATH, USERNAME, TEMP,
HOMEDRIVE, HOMEPATH, LOGONSERVER, SYSTEMDRIVE, SYSTEMROOT, USERDOMAIN,
USERPROFILE and WINDIR — 11 vars that should not have been visible. The
named test secret (`HARNESS_TEST_SECRET`) did NOT leak in that run, so
nothing sensitive escaped this time, but the mechanism that stopped it
(the secret's name/value, not the allowlist) is not one we can rely on.
A third test ("per-call env values...") had a real bug that let this hide:
it read back only one env var instead of dumping the whole child
environment, so it passed regardless of whether a full leak occurred —
fixed to do a full dump like the others (see DBG-008).
A Linux self-test of a standalone diagnostic (`scripts/diagnose-windows-env.cjs`,
independent of our bundle) confirms the expected behavior on Linux: `env: {}`
gives the child zero vars, `env: { ONE: '1' }` gives exactly one, `env:
undefined` inherits everything. The bundle's own logic is therefore sound
where it's been verified; something Windows- or machine-specific is adding
vars back in, and the mechanism isn't identified yet.
**Why this decision, not a fix:** I can't run Windows myself to verify a
fix, and shipping a guessed fix I can't confirm would be worse than
flagging the gap honestly. The owner is asked to run the diagnostic script
directly (no project dependencies) and report the output, which will show
whether this is a Node/Windows platform behavior (needs a workaround in
`Subprocess.run`) or something specific to this machine's Node install,
antivirus, or environment.
**Affects:** `docs/phases.md` 1.4 status (downgraded from unqualified
"Done"), `docs/code_logic.md`, `docs/readme.md`; blocks trusting the
env-allowlist promise for anything sensitive on Windows until resolved.

## D-030 — Reference worker: local Ollama, `qwen2.5-coder:3b-instruct` — 2026-09-22
**Decision:** Ornith-1.5 9B is confirmed NOT on OpenRouter (owner's own
search returned "No results found" on OpenRouter's model search, checked
2026-09-22). It is dropped as the reference binding. The owner will run a
model locally through Ollama instead of a cloud provider for now. The
reference model is `qwen2.5-coder:3b-instruct` (about 1.9 GB at Q4_K_M),
picked over the 7B tag because 7B is reported to need "comfortably 8GB of
RAM" on its own, which does not leave headroom for the OS, the harness host,
and Needle on the owner's 8 GB, no-GPU machine (D-024's host-footprint rule).
`qwen2.5-coder:7b-instruct` is recorded as a stretch option if the owner has
headroom to try it, not the default.
Ornith stays in the docs only as a benchmark row for machines with 16 GB or
more (per D-027), and OpenRouter/cloud stays available as a provider but is
not the default while local Ollama is being used.
**Why:** The owner chose to run Ollama's model rather than a cloud provider.
Nothing in the code changes: `OllamaConfig.model` already has no built-in
default and is set by the person configuring the binding (D-018), so this
is a reference-model choice for docs, the model store (1B.3) and `bench-lite`,
not a code change.
**Not verified:** the 8 GB RAM figure for the 7B tag is a secondary source,
not measured on the owner's machine. Actual usable headroom depends on what
else is running at the same time.
**Affects:** `docs/readme.md`, `docs/status.md`, `docs/trd.md`, Phase 1B.3,
benchmark plan.

## D-029 — Egress controls come before the first real cloud run — 2026-09-22
**Decision:** Consent, the egress log, key handling, redaction and the
secrets proxy (Phase 1B.1) are built before the harness sends real code to
a cloud provider, even though `policy-gates` stay last (D-006, Phase 5).
Egress controls cannot be disabled in any profile, including
`profile-minimal`. The "guardrails are disableable in `profile-minimal`"
rule now covers tool gating (`policy-gates`) only.
**Why:** D-006 assumed the model ran locally. With a cloud worker, the first
model call is already an external send, so "test the unguarded path first"
would mean sending code out with no consent and no redaction.
**Known gap:** the consent gate and egress log exist (D-022), but redaction
and the secrets proxy do not yet. Until 1B.1 is done, only send content you
are fine sharing with the provider.
**Affects:** `docs/trd.md` guardrail constraints, `docs/prd.md` success
criteria, `docs/phases.md` (Phase 1B).

## D-028 — Embeddings: start BM25-only, choose a provider later — 2026-09-22
**Decision:** Amends D-008. Phase 2 ranking starts BM25-only. The embeddings
provider is chosen before 2.3, and it must fit the free-tier request limits
(batch many chunks per call, or use a small local model). Anthropic is
removed from the candidate list for now: I could not confirm it offers its
own embeddings API, so verify before listing any provider.
**Why:** Under a 50-requests-a-day free quota (D-023) an API embedding pass
over a repository is not practical, and BM25 needs no requests at all.
**Affects:** `bundle-embeddings`, `bundle-retrieval-rank` (2.3, 2.5).

## D-027 — Pin model IDs, use fallback lists, verify pulls — 2026-09-22
**Decision:** Every provider binding pins an exact model ID and carries an
ordered fallback list of IDs. `doctor` reports a pinned ID that is no longer
available. Ollama pulls (including the curl route) accept the official
`ornith-ai` source only, and record revision, SHA-256 and license. Ornith-1.5
9B is the reference worker as a hypothesis to test in `bench-lite`, not a
settled default. Whether OpenRouter lists it is unverified (owner to check).
**Why:** OpenRouter's free roster changes month to month, and third-party
repositories publish modified builds of popular models, some with safety
alignment removed. Ornith is a reasoning model: it emits think blocks and
needs a reasoning parser and a tool-call parser to return usable tool calls,
so the conformance tests must cover tool calls with thinking on.
**Affects:** Phase 1B.3, benchmark plan, `bundle-model-adapter` config.

## D-026 — Needle is permanent, with a narrowed job — 2026-09-22
**Decision:** Needle ships on every install and never blocks startup. It
owns choosing the sub-agent, choosing the playbook, and choosing a
read-only or allowlisted tool call from the top five retrieved tools, each
only after it matches or beats the worker on the frozen router suite.
Content-bearing calls stay with the worker. Policy decisions stay with the
deterministic gates. The fallback chain is Needle, rules, worker. The
version and license must be pinned in the model store: there is a 26M
original and a 45M "Needle 2", and sources disagree on whether the license
is MIT or Apache 2.0 (both are permissive).
**Why:** On a free cloud tier every decision Needle makes locally is a
request saved, so its first measurable value is requests saved per task.
**Affects:** new bundle `bundle-router` (Phase 4.5), `bench-lite` metrics.

## D-025 — Interface: headless core and terminal wizard first — 2026-09-22
**Decision:** First-run logic (provider connection, credential storage,
consent, budgets, `doctor`) is a headless core with a local API (Phase
1B.2). The terminal wizard is a thin client over it. A desktop app is added
later as another thin client (Phase 1B.4) so the two cannot disagree.
Electron or Tauri stays open until both are measured on the 8 GB machine
(installer size, cold start, idle memory with the core running).
**Why:** The owner asked for a desktop app. Building it before the kernel
exists would put a UI over nothing, and the shell must fit the 8 GB host
budget. Approval prompts for real writes are the most important thing the
desktop app has to show.
**Affects:** new `app-core` and `app-desktop`, Phase 1B.

## D-024 — Sandbox plan: local first, Crabbox free routes, defer the rest — 2026-09-22
**Decision:** `ctx.subprocess` stays the v1 sandbox. At Phase 5, Crabbox is
used in direct, local-container or static-SSH mode. Its hosted broker is
restricted to a GitHub org and is not available to this project, and a
self-hosted broker is optional. Pin the Crabbox version (it is pre-1.0).
CubeSandbox needs a Linux KVM host, so it moves to Phase 8 with Langfuse
export, whose self-hosted stack needs Postgres, ClickHouse, Redis and S3
(Langfuse Cloud would send traces off the machine). Any remote sandbox is a
second data destination and must appear in the consent screen and `doctor`.
**Why:** The test machine is 8 GB with no GPU. Crabbox's laptop prerequisites
include rsync, which Windows does not ship, and the local-container route
needs a Docker-compatible runtime. Measure both before committing.
**Affects:** Phase 5.1, 5.2, 6.3, 8.2, 8.3; `docs/architecture.md`.

## D-023 — Rate limiting and 429 handling — 2026-09-22
**Decision:** A shared `RateLimiter` sits in front of any provider that
takes one: a sliding 60s window (default 16 per minute), an optional daily
ceiling, and one request in flight by default, shared by all sub-agents. Every
attempt counts toward the daily total, failed ones included. The daily
counter can persist to disk. The day boundary is assumed to be UTC (unverified).
The provider maps HTTP 429 to `quota` (daily, not retryable) or
`rate_limit` (retryable, honors `Retry-After`), 402 to `payment`, and
handles gateways that answer 200 with an error body. The adapter still does
not retry (D-017): backoff and fallback belong in the agent loop (1.5).
Budgets on free providers are in requests and tokens, not money.
**Why:** OpenRouter free models are documented (September 2026) at 20
requests per minute and 50 per day until $10 of credit has ever been bought,
then 1,000 per day. The owner chose not to buy credit, so 50 a day is the
working limit and live-model testing has to be sparing.
**Not verified:** the 429 wording heuristic (`per day` / `daily` in the error
text) is a guess from documentation, not checked against the live API.
**Affects:** `bundle-model-adapter` (`rate-limiter.ts`), 1.5 retry policy,
Phase 1B.2 budgets.

## D-022 — Egress consent gate and egress log — 2026-09-22
**Decision:** A provider that reaches a non-loopback host must declare it
(`LLMProvider.egress`). `ctx.llm` refuses the call with `LLMError` kind
`consent` unless config has `egress: { consent: true }`, logs `model.blocked`,
and sends nothing. Allowed remote calls log the destination host and
payload size in `model.request`. LAN addresses count as remote. API keys are
read from config or a named environment variable, sent only in the request
header, and scrubbed from every error message and log entry.
**Why:** With a cloud worker the model call is an external send, so consent
has to be structural, not a habit. This is the smallest slice of the v5
egress policy that could be built and tested now.
**Not built yet:** redaction, the secrets proxy, per-project opt-in and the
consent screen copy (Phase 1B.1, see D-029).
**Affects:** `bundle-model-adapter`, all providers, `docs/trd.md`.

## D-021 — Provider-agnostic worker, cloud path first on this machine — 2026-09-22
**Decision:** The worker is a binding to a provider through `ctx.llm`. A new
`OpenAICompatibleProvider` (`POST {baseUrl}/chat/completions`) covers
OpenRouter and any similar endpoint. OpenRouter is the first cloud target.
Ollama stays as the local provider (D-018 stands for it; its "no API key
anywhere" line applies to Ollama only). Local workers are optional and gated
by hardware. On the 8 GB, no-GPU test machine the worker is a cloud model,
plus Needle and rules. Free launch candidates besides OpenRouter: Ollama
cloud, Groq, Cerebras, Google AI Studio; each is unverified until it passes
the conformance suite and each provider's data policy is shown at consent.
**Why:** The owner's machine cannot run a 9B model next to the OS and the
harness, and wants users without hardware to have a working path.
**Affects:** `bundle-model-adapter`, `docs/trd.md` stack, `docs/prd.md`
goals, Phase 1.2b and 1B.

## D-020 — No blanket claim of offline use or of sending no data — 2026-09-22
**Decision:** The harness collects no telemetry of its own. What leaves the
machine depends on the binding: a cloud binding sends what the model sees to
the provider, under that provider's policy, and a remote sandbox sends the
repository to that sandbox. Only a local binding keeps model traffic on the
machine. No doc, screen or readme may claim otherwise.
**Why:** The owner asked to remove the "completely offline, sends no data"
claim. Provider zero-retention statements are the provider's claims, not
something the harness can verify.
**Affects:** `docs/readme.md`, `docs/prd.md`, `docs/trd.md`, consent copy.

## D-019 — Tool registry is the single call choke point — 2026-09-20
**Decision:** All tool execution goes through `ctx.tools.call()`, which
logs `tool.call` before executing and `tool.result` before returning
(fail-closed on log errors), validates input against the tool's JSON
Schema (ajv, compiled at registration), and emits serial events
`tools/pre-execute` (throw `ToolDeniedError` to block; any hook error also
blocks) and `tools/post-execute` (may redact `ev.result`; a hook error
withholds the output). Hook input is a deep-frozen copy. Tool-level
failures return `{ ok:false, errorKind }` instead of throwing so the model
can recover. `actionClass` is REQUIRED per tool so policy-gates can gate
on it; unclassified tools cannot register. Duplicate names are rejected.
Output is truncated at `maxOutputChars` (default 50,000).
**Why:** A call path that skips logging or hooks bypasses both the audit
trail and policy, so the choke point has to exist from the first version,
not be retrofitted in Phase 5. Model-produced tool input is untrusted, so
it is validated. Small local models mis-format arguments often, and a clear
`invalid_input` message lets the loop retry.
**Alternatives:** hand-rolled schema check (rejected: bug-prone); leaving
hooks to Phase 5 (rejected: retrofit risk). This goes beyond the literal
1.3 criteria and designs the Phase 5 attachment point ahead of use; revisit
when policy-gates are built.
**Affects:** `bundle-tool-registry`, new dependency `ajv`; Phase 5
policy-gates (attach via the events above); 1.5 (map `list()` to
`ToolSpec[]`, feed `ToolResult` back as `tool_result` with `isError`).

## D-018 — Built-in provider is Ollama (local models), not Anthropic — 2026-09-20
**Decision:** `bundle-model-adapter` ships an `OllamaProvider`
(`POST {host}/api/chat`, `stream:false`) as the built-in. Config:
`ollama: { model, baseUrl?, timeoutMs? }`; host falls back to `OLLAMA_HOST`
then `http://localhost:11434`. No API key anywhere. The Anthropic provider
was removed. Supersedes the API-key parts of D-017 (raw fetch, no default
model, and no adapter-level retries still stand).
**Why:** Owner request: run on local Ollama models.
**Consequences to watch:** (1) Small local models often lack reliable
native tool calling, and some models reject `tools` outright (HTTP 400).
1.5's ReAct loop may need a text-format fallback. (2) First request loads
the model, hence the 120s default timeout. (3) Credential/secrets-proxy
guardrails in `trd.md` matter less locally but still apply if a remote
provider is added later. Phase 1.2 success criteria were amended to match.
**Affects:** `bundle-model-adapter`, `phases.md` 1.2, 1.5.

## D-017 — Adapter details: raw fetch, no default model, no retries — 2026-09-20
**Decision:** The Anthropic provider uses `fetch` directly (no SDK). `model`
is required config (no default in code). API key comes from config or
`ANTHROPIC_API_KEY`. The adapter does not retry; `LLMError.retryable` is a
hint for callers.
**Why:** Fewer dependencies and a stable, tiny surface; model choice is
configuration; retry policy belongs where task context exists (agent loop).
**Affects:** `bundle-model-adapter`, 1.5 (retry policy).

## D-016 — Model-adapter owns model-call logging, fail-closed — 2026-09-20
**Decision:** `ctx.llm.complete()` requires a `sessionId`, appends
`model.request` before the provider is called and `model.response` /
`model.error` after. If the log write fails, the model is not called.
**Why:** Puts the "model-visible = logged" invariant at the single choke
point instead of trusting every caller.
**Affects:** 1.5 agent-loop must NOT log model calls itself (it logs its own
steps and tool calls only); 1.6 invariant test.

## D-015 — `ctx.llm` is a thin provider registry — 2026-09-20
**Decision:** `ctx.llm.register(name, provider)` (returns a disposer, used
inside `ctx.effect`) plus `complete({provider?})`. Providers are plain
objects implementing `LLMProvider.complete`. Native tool-use shapes
(`ContentBlock`, `ToolSpec`, `toolCalls`) are in the interface now.
**Why:** `ctx.llm` is a single service key, so multiple providers need a
name->provider map. This refines architecture.md's "no adapter-registry
code" wording: the registry is one `Map`, not a framework. Tool-use shapes
are included now so 1.5 doesn't force a breaking interface change (risk:
designed ahead of use; revisit at 1.5).
**Alternatives:** one Cordis service key per provider (rejected: callers
would need to know provider names at compile time).
**Affects:** `bundle-model-adapter`, 1.5.

## D-014 — Non-harness Python project removed from repo — 2026-09-20
**Decision:** `app.py`, `main.py`, `analyser.py`, `tasks.py`,
`requirements.txt`, `.env.example` (an unrelated "Document Intelligence
Workbench") moved out of the repo (commit `ac8e13d`). Docs moved under `docs/`.
**Why:** Contradicted D-001 (Cordis/TypeScript, not Python) and would
mislead future agents.
**Affects:** repo root layout.

## D-013 — tsconfig uses `moduleResolution: Bundler` — 2026-09-20
**Decision:** `module: ESNext`, `moduleResolution: Bundler`.
**Why:** Cordis's declaration files use extensionless relative imports;
`NodeNext` breaks its types. Runtime is unaffected (tsx/vitest).
**Affects:** all bundles' typechecking. Don't "fix" back to NodeNext.

## D-012 — Pin Cordis to exactly `4.0.0-rc.10` — 2026-09-20
**Decision:** Exact pin, no caret.
**Why:** It is the only published line (`latest` is a release candidate) and
its README says the API may change without notice.
**Affects:** `package.json`. Upgrades are deliberate, logged decisions.
`npm audit` reports dev-only advisories (vitest toolchain); 0 in
production dependencies.

## D-011 — Explicitly out of scope — 2026-09-18
**Decision:** `cloudflare/agentic-inbox`, `langflow-ai/langflow`, and
`Panniantong/Agent-Reach` are explicitly excluded.
**Why:** Agentic-inbox is an email client with no overlap; langflow is a
no-code flow builder for the wrong audience; Agent-Reach is a
social-media/web-scraping capability layer, wrong domain for a coding-only
harness.
**Affects:** scope boundary for the whole project.

## D-010 — Reference-only repos, not runtime dependencies — 2026-09-18
**Decision:** `affaan-m/ECC` and `opendatalab/MinerU` are read for ideas,
not adopted as dependencies.
**Why:** ECC covers nearly every open item simultaneously (68 scoped
sub-agents, hooks-as-events, memory vault with scopes/trust boundaries, an
instinct system with confidence-scored pattern promotion/pruning) — its
hook event model and instinct-confidence design are worth reading, but it's
Claude-Code/Codex-plugin-centric with a Node/Python mix, so not a runtime
dependency. MinerU (PDF/DOCX/PPTX/XLSX-to-markdown, MCP server support) is
an optional add only if sub-agents need to ingest spec/design documents —
not core.
**Affects:** `docs/architecture.md` external dependencies list.

## D-009 — Skills/procedural-memory format: Agent Skills spec — 2026-09-18
**Decision:** Adopt `agentskills/agentskills` (`SKILL.md` folders with
progressive disclosure: name+description always loaded, full instructions
loaded on task match, bundled code/resources loaded on demand).
**Why:** Maps directly onto the Procedural memory tier; use this format
rather than inventing one.
**Affects:** `bundle-skills`, Phase 3.

## D-008 — Embeddings and vector store — 2026-09-18
**Decision:** Embeddings via API providers (OpenAI/Anthropic/Voyage), no
local model hosting for v1. Vector store: LanceDB primary (embedded, no
separate service), Qdrant fallback for multi-user scale.
**Why:** Keeps v1 simple and swappable as a `ctx.llm`-adjacent seam; Qdrant
only brought in once multi-user scale is actually needed.
**Affects:** `bundle-embeddings`, `bundle-vectorstore-lancedb`,
`bundle-vectorstore-qdrant`, Phase 2 and Phase 8.

## D-007 — Eval harness: custom runner + Langfuse fallback — 2026-09-18
**Decision:** Primary eval harness is a custom runner built on Cordis's own
append-only session log (solver/scorer/sandbox concepts borrowed from
Inspect AI's design, not its Python runtime). Langfuse is the
fallback/complement, swapped in for AgentOps.
**Why:** Langfuse is self-hostable, TS-native, and covers tracing + evals +
prompt management + datasets in one tool, matching the adjacent
coding-agent ecosystem's existing integrations.
**Affects:** `bundle-eval-runner`, `bundle-eval-langfuse`, Phase 6.

## D-006 — Policy gate table — 2026-09-18
**Decision:** Five action classes with fixed gates: read-only (autonomous),
sandbox-scoped writes (autonomous, logged), real-fs writes outside sandbox
(approval or confidence-threshold auto-approve), external side-effecting
API calls (always approval), deny-listed actions (hard block, no override).
Implemented via `agent/pre-step` and `tools/pre-execute` — no new mechanism
beyond existing Cordis events.
**Why:** Separates what the model can see from what it's allowed to do,
structurally, rather than relying on prompting alone. Deny-list is
pattern-based (not just command-name-based) so a wrapped/aliased command
can't bypass it; confidence scores are never trusted alone and must be
cross-checked against at least one independent heuristic.
**Affects:** `bundle-policy-gates`, Phase 5.

## D-005 — Browser tool: `vercel-labs/agent-browser` — 2026-09-18
**Decision:** Use `vercel-labs/agent-browser` (native Rust CLI + daemon,
npm-installable, built-in MCP server, tool profiles, domain allowlists,
action-policy JSON, plugin system) instead of the originally-considered
`browser-use/browser-harness`.
**Why:** browser-use/browser-harness is Python-only with no clear advantage
here; agent-browser's plugin system matches the project's own
capability-seam pattern and ships `--content-boundaries` and
`--allowed-domains` directly.
**Affects:** `bundle-browser`, Phase 7, Layer 1/3 guardrails.

## D-004 — Sandbox/execution providers — 2026-09-18
**Decision:** Local subprocess (`ctx.subprocess`) for v1. Remote/isolated
providers: `openclaw/crabbox` (lease-based remote dev/test execution) and
`TencentCloud/CubeSandbox` (sub-60ms VM-isolated boot, E2B-compatible) —
both behind the `ctx.sandbox` seam as separate providers. crabbox for
dev/test leases, CubeSandbox for quick code-execution sandboxes.
**Why:** Separates "real but slower/leased" execution from "fast/frequent
untrusted-code" execution rather than forcing one tool to do both jobs.
**Affects:** `bundle-sandbox-crabbox`, `bundle-sandbox-cubesandbox`, Phase 5.

## D-003 — Awesome-list re-checked against D-001/D-002 — 2026-09-18
**Decision:** Anthropic's multi-agent research writeup, SWE-agent, Citadel,
and `browser-use/browser-harness` flagged as the highest-value remaining
reads from `walkinglabs/awesome-harness-engineering`, not yet pulled in
full. (Note: `browser-use/browser-harness` was superseded by D-005.)
**Why:** Awesome-list itself is a curated list, not a framework — items
worth reading are tracked individually rather than adopting the list
wholesale.
**Affects:** open reading queue, not yet a structural decision.

## D-002 — q-agent-harness treated as design doc only — 2026-09-18
**Decision:** Adopt `kju4q/q-agent-harness`'s memory model and
Map → Guardrails → Feedback-loops framing; do not adopt its code/templates.
**Why:** q-agent-harness is a starter-kit/design doc, not running code — its
ideas are useful, its implementation isn't something to build on.
**Affects:** `bundle-memory`'s 4-tier model, overall guardrail framing
(Layers 1–3 in `docs/trd.md`/architecture).

## D-001 — Stack: Cordis-based, not Python — 2026-09-18
**Decision:** Build on Cordis (TypeScript plugin kernel), not Python.
`deepseek-ai/deepseek-harness`'s own `packages/` are a reference
implementation to study, not necessarily a runtime dependency.
**Why:** deepseek-harness is explicitly labeled developer-preview with
breaking changes expected — safer to take the underlying kernel (Cordis)
as the dependency than the harness built on top of it.
**Affects:** entire stack; every bundle in `docs/architecture.md`.

---
**Next:** Return to [`context.md`](../context.md).
