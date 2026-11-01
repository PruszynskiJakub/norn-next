# AC1 (B1, B2)
bunfig.toml: pathIgnorePatterns = ["**/integration/**", "test/e2e/**"]; package.json "test": "bun test".
Plain `bun test` on HEAD: 1104 pass / 0 fail, 58 files (unit-run.txt). JUnit file list (AC1-files.txt): 0 files under integration/ or test/e2e/; the only cli files are the 5 in packages/cli/test/unit/.
Repo rule "B1, B2: the root bunfig ignores exactly the integration and e2e tiers, and the test script is exactly bun test" passes (AC1-4-rules.txt).
