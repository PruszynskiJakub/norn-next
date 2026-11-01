## AC5
$ cat .github/workflows/ci.yml
# Every PR and every push to main: the unit tier and the type check first, then the integration
# tier, the e2e tier in shards, and the distributables built and smoke-tested as a user would
# install them, side by side (gh-118 B11, B12).
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  # The unit tier spawns nothing (gh-118 B1, B4) and fails in seconds; every other job waits for it (B11).
  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.13
      - run: bun install --frozen-lockfile
      - run: bun run test
      - run: bun run typecheck

  integration:
    needs: unit
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.13
      - run: bun install --frozen-lockfile
      - name: Integration tier
        run: |
          git config --global user.name "norn ci"
          git config --global user.email "ci@norn.invalid"
          git config --global init.defaultBranch main
          bun run test:integration

  # bun shards by file (B12); a red shard cancels the others.
  e2e:
    needs: unit
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      fail-fast: true
      matrix:
        shard: [1, 2, 3]
    name: e2e (shard ${{ matrix.shard }}/3)
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.13
      - run: bun install --frozen-lockfile
      - name: e2e tier, one shard
        run: |
          git config --global user.name "norn ci"
          git config --global user.email "ci@norn.invalid"
          git config --global init.defaultBranch main
          bun run test:e2e --shard=${{ matrix.shard }}/3

  package:
    needs: unit
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.13
      - run: bun install --frozen-lockfile
      - name: Build
        run: |
          bun scripts/build.ts
          bun scripts/build.ts --bin linux-x64
      - name: Smoke-test the npm package installed from its tarball
        run: |
          git config --global user.name "norn ci"
          git config --global user.email "ci@norn.invalid"
          version=$(jq -r .version packages/cli/package.json)
          (cd dist/npm && npm pack --pack-destination "$RUNNER_TEMP")
          mkdir "$RUNNER_TEMP/app" && cd "$RUNNER_TEMP/app"
          echo '{"name":"app","private":true}' > package.json
          bun add "$RUNNER_TEMP"/norn-cli-*.tgz
          "$GITHUB_WORKSPACE/scripts/smoke.sh" node_modules/.bin/norn "$version"
      - name: Smoke-test the linux-x64 binary
        run: scripts/smoke.sh dist/bin/norn-linux-x64 "$(jq -r .version packages/cli/package.json)"
unit: needs=nil strategy=nil
integration: needs="unit" strategy=nil
e2e: needs="unit" strategy={"fail-fast" => true, "matrix" => {"shard" => [1, 2, 3]}}
package: needs="unit" strategy=nil
