// Where the tools keep their intermediate files.
//
// The tools run inside a Vercel sandbox created from a checkout of this repo
// at a specific commit (see tools/README.md), so the natural place is a
// git-ignored .work/ directory inside that checkout. WORK_DIR overrides it —
// useful when a sandbox is restored from a snapshot whose data lives elsewhere.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const WORK = process.env.WORK_DIR || join(repoRoot, ".work");
mkdirSync(WORK, { recursive: true });

export const workPath = (name) => join(WORK, name);
