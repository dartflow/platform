import assert from 'node:assert/strict';

const { SOURCE_SHA, GITHUB_REPOSITORY, DEFAULT_BRANCH, GH_TOKEN } = process.env;
assert.match(SOURCE_SHA ?? '', /^[0-9a-f]{40}$/, 'Full candidate SHA required');
assert.match(GITHUB_REPOSITORY ?? '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Repository required');
assert.ok(DEFAULT_BRANCH && GH_TOKEN, 'Default branch and read-only GitHub token required');

const endpoint = new URL(`https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs`);
endpoint.searchParams.set('head_sha', SOURCE_SHA);
endpoint.searchParams.set('event', 'push');
endpoint.searchParams.set('per_page', '100');
const response = await fetch(endpoint, {
  headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  signal: AbortSignal.timeout(15_000),
});
assert.ok(response.ok, `CI metadata unavailable (${response.status})`);
const data = await response.json();
const success = data.workflow_runs?.find((run) => run.head_sha === SOURCE_SHA
  && run.head_branch === DEFAULT_BRANCH && run.event === 'push'
  && run.status === 'completed' && run.conclusion === 'success'
  && run.head_repository?.full_name === GITHUB_REPOSITORY);
assert.ok(success, 'No successful default-branch push CI run for this exact SHA');
console.log(`Verified CI run ${success.id} for ${SOURCE_SHA}`);
