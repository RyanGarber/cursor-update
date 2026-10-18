# sod-off

Inspect, update, and clean applications from one interactive Bun CLI.

sod-off runs on macOS, Linux and Windows; each app declares the operating systems it supports, and only those are offered. Every app currently supports macOS only, so on Linux and Windows sod-off reports that no apps are available.

Download the build for your system (`sod-off-darwin-arm64`, `sod-off-darwin-x64`, `sod-off-linux-arm64`, `sod-off-linux-x64` or `sod-off-win32-x64.exe`) from the [latest release](https://github.com/ryangarber/sod-off/releases/latest), save it as `~/.local/bin/sod-off` and `chmod +x` it. Or build it from source:

```sh
bun install --ignore-scripts
bun run install   # compiles to ~/.local/bin/sod-off

sod-off cursor
sod-off idea update
sod-off claude clean
sod-off claude-code update
sod-off chatgpt update
sod-off codex clean
sod-off all update -y
sod-off cursor-agent update --clean
sod-off all clean
```

Apple Silicon and Intel releases are selected where the vendor offers them.

| App subcommand | Application | Release source |
| --- | --- | --- |
| `cursor` | Cursor | Cursor golden-channel download endpoint |
| `cursor-agent` | Cursor Agent CLI (`agent`) | Version pinned by Cursor's official installer script |
| `idea` | IntelliJ IDEA | JetBrains releases API; retains the installed edition |
| `claude` | Claude.app | Anthropic's official universal desktop DMG |
| `claude-code` | Claude Code | Anthropic native release channel and SHA-256 manifest |
| `chatgpt` | ChatGPT.app | OpenAI's current desktop appcast, filtered by architecture |
| `codex` | Codex CLI | Official GitHub releases; full native package with companion binaries |

## Commands

`sod-off <app>` reports the primary installation path, resolved CLI payload, version, and tracked space before/after inspection. Inspection does not download releases or modify installations.

`sod-off <app> update` discovers the latest release. When an update is needed, it downloads into a private temporary directory and inspects the actual payload. Before asking for confirmation it shows:

- Old and new version.
- Actual download size and unpacked bundle/package size, including allocated disk space.
- Exact path being overwritten; for CLIs, the new payload path and launcher destination.

Preparation can download a large installer before confirmation; it does not change your installed app. Downloaded code must pass vendor code-signature verification, plus a SHA-256 check when published. Bundle identity and the staged version are checked. Already-current/newer versions are left alone. Apps using an unversioned DMG endpoint must download it to determine its version.

`sod-off <app> clean` lists every discovered cache directory and inactive version, its full recursive file size, disk allocation, and the exact path to delete. It then asks for confirmation. Updates and cleanup are separate operations.

`sod-off <app> update --clean` updates, then runs `clean`, so the version it replaced can be removed right away. Each step is previewed and confirmed separately; a failed update skips the clean.

`sod-off all [update|clean]` runs the action sequentially on every app with an existing installation (inspection by default). Missing apps are skipped. Failures are reported while remaining apps continue, with a nonzero exit status if any failed. `--app-path` cannot be combined with `all`.

Confirmations default to **No**. Declining, EOF, or a non-interactive terminal leaves installations and caches alone. Pass `--yes` or `-y` to accept every confirmation, including in non-interactive runs. Previews and safety checks still run.

On start, a compiled `sod-off` checks the latest release's `latest.json`. If a newer version is out, it asks to update; on yes, it downloads the build for your architecture, verifies its SHA-256 and replaces itself, then exits so you can run the command again. Only interactive terminals are asked, `--yes` does not answer it, and a failed check is silent. Runs from source never update themselves.

```sh
sod-off cursor update --app-path "$HOME/Applications/Cursor.app"
sod-off codex --app-path "$HOME/.local/bin/codex"
```

Desktop discovery prefers `/Applications`, then `~/Applications`. CLI discovery uses the first executable on `PATH`, falling back to `~/.local/bin`. `--app-path` selects a specific primary bundle or launcher. Cleanup also discovers matching, identity-checked alternate bundles in those application directories, known vendor caches, native CLI version directories (including the `agent` versions bundled with Cursor, keeping the newest, and the standalone `agent` CLI's, keeping the active one, any its `agent`/`cursor-agent` launchers point to, any a live process runs from, and removing interrupted installs), IntelliJ settings folders in `~/Library/Application Support/JetBrains` from major versions older than the installed one, and versions installed by sod-off. It does not scan arbitrary disks, delete sessions/configuration, or purge shared npm/Homebrew caches.

Updates support standalone desktop bundles and native CLIs. Executables located under npm, Homebrew, or JetBrains Toolbox package directories must be updated with that package manager. Select a standalone installation to manage it with sod-off. Note that in the case of the legacy Codex app, it will be replaced with the modern ChatGPT app. No new apps will be installed; only previously installed apps will be updated.

## Architecture

Each file in `src/apps/` exports an interface-typed `AppModule` object. `name` registers its primary subcommand; `platforms` lists the operating systems (`darwin`, `linux`, `win32`) it supports, and it is hidden everywhere else. `inspect` discovers the installation; optional `update` and `clean` methods return a release descriptor or cleanup targets. Register a new object in `src/apps/index.ts`; omitted methods are reported as unsupported.

```ts
import type { AppModule } from './src/core/types.ts';

const example: AppModule = {
  name: 'example',
  displayName: 'Example',
  platforms: ['darwin'],
  async inspect(ctx) { /* discover location and version */ return null; },
  async update(ctx, installed) {
    return {
      url: 'https://vendor.example/latest.dmg',
      format: 'dmg',
      entry: 'Example.app',
      teamId: 'VENDORTEAM',
      bundleIds: ['com.vendor.example'],
    };
  },
  async clean(ctx, installed) {
    return [{ path: `${ctx.home}/Library/Caches/com.vendor.example`, label: 'Example cache', kind: 'cache' }];
  },
};
```

Return existing cleanup paths, and exclude active vendor versions. App modules describe paths and release metadata; they never measure space, prompt, download, install, or delete anything. `src/core/` handles those operations uniformly:

- Measures logical bytes and allocated blocks, deduplicating overlapping paths and hard links without following symlinks. Unreadable paths fail visibly rather than being counted as zero.
- Reports before/after allocation and the actual change, including partial failures. Scope is the discovered install, caches, inactive versions, and sod-off's managed versions—not all vendor data or whole-volume free space. APFS clones/compression and concurrent app writes can affect actual free space reclaimed.
- Stages desktop replacements on the destination filesystem, retains a recovery copy until post-install verification succeeds, and rolls back ordinary failures.
- Installs native CLI payloads under `~/.local/share/sod-off/<name>/versions/<version>` and switches the existing launcher. The Codex vendor `current` pointer is also protected during cleanup. Vendor-native old payloads stay available for a later `clean`; arbitrary custom binaries overwritten at the launcher path are not retained. Vendor auto-updaters may subsequently repoint their launchers.
- Rejects symlinked cleanup roots/parents and paths overlapping the primary install. Only previewed paths may be deleted.
- Serializes mutations per app with a temporary lock, disposes downloads/mounts on normal exit and handled interruption, and preserves recovery files if rollback fails. A hard kill or power loss may leave staging, backup, or lock files requiring manual recovery; the swap consists of recoverable renames, not a crash-atomic filesystem transaction.

## Development

```sh
bun run test
bun run typecheck
bun run check
```

The source uses only Node APIs, so it runs on Node (`bun run start` runs `node ./src/main.ts`; Node 22.18+ runs TypeScript directly) as well as compiled by Bun. Tests use Vitest; those needing macOS tools skip themselves elsewhere. CI (`.github/workflows/check.yml`) runs these and builds every OS's binary on every push, on Ubuntu, and smoke-tests a build on Linux and Windows. After it passes on `main`, `release.yml` runs the release as a dry run: rylease's `conventional` preset reports the next version and notes, and the binaries and `latest.json` are built and kept as workflow artifacts. Dispatching `release` from `main` releases for real: rylease bumps `package.json`, prepends `CHANGELOG.md`, commits, tags `v<version>` and creates the GitHub release; `release-cli.yml` then uploads the binaries, followed by `latest.json`.

Tests use temporary fixtures and mocked vendor metadata; they cover routing, cancellation, accounting, active-version protection, revalidation, signature/digest failures, mount cleanup, native launcher switching, and rollback. They do not update the developer's installed applications.

Vendor references: [Claude desktop download](https://claude.com/download), [Claude Code setup](https://code.claude.com/docs/en/setup), [ChatGPT download](https://chatgpt.com/download/), [Codex releases](https://github.com/openai/codex/releases), [IntelliJ downloads](https://www.jetbrains.com/idea/download/).
