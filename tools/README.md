# Tools

Scripts that run **outside** the deployed site: discovering employer boards,
verifying them, and dry-running the nightly sweep. None of them is uploaded to
Vercel (`tools/` is in `.vercelignore`).

## Where they run

In a **Vercel Sandbox created from a checkout of this repo at a commit**. The
development container's proxy refuses every job site these tools need; a
sandbox has an unrestricted network.

Create the sandbox with a git source, pinned to the commit you want to run:

```json
{
  "name": "tools-<purpose>",
  "projectId": "prj_DhAdvPln1ZTZgXPqiOk08gWIV1Qe",
  "region": "iad1",
  "timeout": 900000,
  "persistent": false,
  "networkPolicy": { "mode": "allow-all" },
  "source": {
    "type": "git",
    "url": "https://github.com/Singh1608/Singh1608.git",
    "revision": "<commit sha>",
    "depth": 1
  }
}
```

The repo is public, so no credentials are needed. Pin `revision` to a SHA
rather than a branch name so the sandbox runs exactly the code that was
reviewed. Commit and push before creating the sandbox — nothing is copied into
it by hand.

Commands run from the checkout root, which is the sandbox's working directory.
Intermediate files go to `.work/` (git-ignored); set `WORK_DIR` to put them
elsewhere.

## Limits to plan around

- **A sandbox lives about 15 minutes** on this plan, whatever `timeout` says.
  Long jobs run in the background (`nohup … &`) and write checkpoints; take a
  snapshot before the cut-off and create the next sandbox from it with
  `"source": { "type": "snapshot", "snapshotId": "…" }`.
- **Command output returned to the caller is truncated at about 2.5 KB per
  chunk.** Write results to `.work/` and page through them with `sed -n`.

## The scripts

| Script | What it does |
| --- | --- |
| `dry_run.mjs` | Reads every board in `SOURCES` with the production adapters; reports sweep time against the 60 s function limit and how many roles would reach the shortlist. Run it in `iad1` before deploying any change to boards or adapters. |
| `trace_employers.mjs collect` | Gathers employers from NoFluffJobs, LinkedIn's guest search and justjoin.it, with each one's website. → `.work/employers.json` |
| `trace_employers.mjs trace` | Walks each employer's site to its careers page and records the ATS it links to. Resumable. → `.work/traced.jsonl` |
| `trace_employers.mjs report` | Consolidates the trace. → `.work/trace.json` |
| `verify_boards.mjs` | Checks every traced board with the production adapters. |
| `build_sources.mjs` | Turns the trace into candidate `SOURCES` entries, keeping boards with Poland roles and flagging any whose identifier does not resemble the employer. The output is reviewed by hand before it goes into `api/_discovered.js`. |
| `discover_boards.mjs` | The first, slug-guessing approach. Superseded by the trace; kept because its header records why slug guessing alone produces false positives. |

A full rediscovery is `collect`, then `trace` (twice if the first sandbox
expires), then `report`, then `build_sources.mjs`.
