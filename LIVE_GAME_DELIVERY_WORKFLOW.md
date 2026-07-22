# Iron Dominion Task-to-Live Workflow

## Purpose

This is the operating agreement for every Iron Dominion change, whether it is made by Codex, Cursor, or another agent. The goal is simple: Dani can send tasks, see their status, test player-facing work when necessary, and receive verified changes in the live game without tracking every line of code.

No branch is considered finished merely because its code exists or a pull request was opened. A task is finished only after it is merged, deployed, and verified in the live game.

## The delivery path

```text
QUEUED -> ACTIVE -> LOCALLY VERIFIED -> DRAFT PR -> CI PASSED -> REVIEWED
       -> USER CHECK (when required) -> READY -> MERGED -> DEPLOYED -> LIVE VERIFIED
```

GitHub is the source of truth. Every active task must have a branch or pull request, and every completed task must have a merged pull request.

## Responsibilities

### Dani

- Sets priorities and describes the expected player outcome.
- Tests player-visible or high-risk changes at the user-check checkpoint.
- Does not need to review code line by line.

### Implementing agent

- Uses its own worktree/folder and its own branch created from the latest `main`.
- Implements one focused task per branch and pull request.
- Adds or updates tests where practical.
- Runs the local quality checks and supplies clear test instructions.
- Fixes review, CI, and conflict issues on the same branch.

### Merge coordinator

- Reviews scope, behavior, test evidence, and deployment risk.
- Prevents overlapping changes from being merged in an unsafe order.
- Requests fixes from the implementing agent when necessary.
- Marks the pull request ready, merges it, monitors deployment, and verifies production.
- Reports one final result: pull request, deployment status, and live-game verification.

GitHub protects `main`, runs the required checks, and prevents merging work that is outdated or failing.

## Rules for parallel agents

1. Never work directly on `main`.
2. Every agent gets a separate worktree/folder and a separate branch.
3. Branches use an owner and task name, for example `codex/fix-tank-pileup` or `cursor/improve-map-ui`.
4. Never let two agents share or reuse the same branch.
5. Keep one product change per pull request. Do not mix unrelated fixes.
6. If two tasks modify the same gameplay system or core file, sequence them instead of developing them simultaneously.
7. After another pull request merges, update the remaining branch from the new `main` and rerun its tests before merging.
8. Never deploy a feature branch directly to production.

## Step-by-step workflow

### 1. Start and register the task

- Confirm the expected behavior and a short acceptance checklist.
- Create a fresh branch from the latest `origin/main` in an isolated worktree.
- Record any likely overlap with other open pull requests.
- For meaningful work, open a draft pull request as soon as there is a coherent implementation. A draft pull request is safe: it tracks the work but cannot be merged or deployed accidentally.

### 2. Validate locally

Every change must pass the relevant focused tests plus:

```bash
npm test
npm run build
```

The implementing agent also checks the actual behavior, not only whether the build succeeds.

For UI, gameplay, audio, controls, map, or multiplayer changes, the agent must provide:

- A local preview URL or precise local launch instructions.
- Exact steps to reach and test the change.
- The expected result and important edge cases.
- A screenshot or short recording when it makes comparison easier.

### 3. Push a draft pull request

The pull request description must include:

- What changed and why.
- Files or systems affected.
- Automated tests run and their result.
- Manual test steps and evidence.
- Known risks, limitations, and deployment impact.
- Whether Dani's user check is required.

Pushing a draft early is preferred over leaving changes only on one computer. It creates tracking, backup, CI results, and a place for review without sending unfinished work to the live game.

### 4. Pass GitHub checks and review

Every pull request must pass the required GitHub `quality-gate`, which installs clean dependencies, runs the tests, and builds the game. A failing required check blocks the merge.

The merge coordinator then reviews the change. If there are problems, comments are left on the pull request and the same implementing agent fixes them on its existing branch. The pull request must be updated from the latest `main`, with conflicts resolved and checks rerun, before it can merge.

### 5. Apply the correct user checkpoint

| Change type | Dani tests before merge? | Examples |
| --- | --- | --- |
| Player-visible or experiential | Yes | UI, gameplay, controls, audio, animation, map, balance |
| High-risk behavior | Yes | Multiplayer state, authentication, saved data, payments, destructive migrations |
| Low-risk internal change | Usually no | Tests, documentation, isolated refactor, tooling |
| Urgent production hotfix | Only if time permits, but coordinator verification is mandatory | Broken launch, severe regression, production outage |

When a user check is required, the pull request remains a draft until Dani confirms the expected behavior. Dani reviews the product outcome, not the implementation details.

### 6. Merge one at a time

- Only the merge coordinator merges pull requests.
- Merge only when required CI passes, review is complete, conversations are resolved, and the user checkpoint has passed when required.
- Merge one pull request at a time using squash merge.
- Immediately re-check other open pull requests for conflicts or outdated assumptions.

### 7. Deploy only from `main`

Production deployment must use the approved GitHub Actions production workflow and only code already merged into `main`. The production job must:

1. Check out the exact `main` commit.
2. Install dependencies and rerun tests/build.
3. Deploy the Cloudflare Worker.
4. Report the deployed commit and deployment result.

### 8. Verify the live game

After deployment, the coordinator performs a production smoke test at the live URL and checks:

- The site loads and a game can start.
- The changed behavior matches its acceptance checklist.
- The browser console and network requests show no new critical errors.
- Closely related behavior has not regressed.

The final task update must include the pull request link, whether production deployment passed, what was checked live, and any follow-up work. The task status becomes `LIVE VERIFIED` only then.

## Fast hotfix lane

Urgency shortens waiting time, not safeguards:

1. Create a small hotfix branch from the current `main`.
2. Make only the minimum necessary fix.
3. Run focused tests, the full test suite, and the build.
4. Open a pull request, pass required CI, and receive coordinator review.
5. Merge, deploy from `main`, and smoke-test production immediately.

No direct push or direct production deployment is allowed, even for a hotfix. If the fix fails, revert it through a new protected pull request rather than modifying production manually.

## Definition of done

A task is done only when all applicable boxes are checked:

- [ ] Acceptance criteria are clear.
- [ ] Work is isolated on a current task branch.
- [ ] Local tests and build pass.
- [ ] Manual behavior check passes.
- [ ] Draft pull request documents scope, evidence, risk, and test steps.
- [ ] Required GitHub checks pass.
- [ ] Coordinator review is complete and comments are resolved.
- [ ] Dani accepts player-visible or high-risk behavior when required.
- [ ] Pull request is merged into `main`.
- [ ] Production deployment succeeds.
- [ ] The live game is smoke-tested and the result is reported.

## Current activation work

The repository protections and required `quality-gate` are active. Fully automatic task-to-live delivery is not yet active because production deployment was deliberately changed to manual after its required application secrets were found to be missing.

Before automatic deployment on every merge can be enabled safely:

1. Restore `WIX_API_KEY` in GitHub Actions secrets.
2. Restore `IRON_DOMINION_INGEST_SECRET` with the same value expected by the Wix backend.
3. Run and verify one manual production deployment from `main`.
4. Re-enable the production workflow trigger for pushes to `main`.
5. Disable the older Cloudflare Git integration's redundant branch-build check after the GitHub deployment path is confirmed. It currently produces a confusing non-required failure on pull requests.

Until those activation steps are complete, merging a pull request does **not** mean it is live. The coordinator must explicitly report `MERGED, NOT DEPLOYED` or `LIVE VERIFIED`; never assume deployment from the merge alone.
