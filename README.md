# sod-off

Inspect, update, and clean macOS applications from one interactive Bun CLI.

```sh
bun install --ignore-scripts
bun run start --help
bun link

sod-off cursor
sod-off idea update
sod-off claude clean
sod-off claude-code update
sod-off chatgpt update
sod-off codex clean
sod-off all update -y
sod-off all clean
```

Apple Silicon and Intel releases are selected where the vendor offers them.

| App subcommand | Application | Release source |
| --- | --- | --- |
| `cursor` | Cursor | Cursor golden-channel download endpoint |
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

`sod-off all [update|clean]` runs the action sequentially on every app with an existing installation (inspection by default). Missing apps are skipped. Failures are reported while remaining apps continue, with a nonzero exit status if any failed. `--app-path` cannot be combined with `all`.

Confirmations default to **No**. Declining, EOF, or a non-interactive terminal leaves installations and caches alone. Pass `--yes` or `-y` to accept every confirmation, including in non-interactive runs. Previews and safety checks still run.

```sh
sod-off cursor update --app-path "$HOME/Applications/Cursor.app"
sod-off codex --app-path "$HOME/.local/bin/codex"
```

Desktop discovery prefers `/Applications`, then `~/Applications`. CLI discovery uses the first executable on `PATH`, falling back to `~/.local/bin`. `--app-path` selects a specific primary bundle or launcher. Cleanup also discovers matching, identity-checked alternate bundles in those application directories, known vendor caches, native CLI version directories, and versions installed by sod-off. It does not scan arbitrary disks, delete sessions/configuration, or purge shared npm/Homebrew caches.

Updates support standalone desktop bundles and native CLIs. Executables located under npm, Homebrew, or JetBrains Toolbox package directories must be updated with that package manager. Select a standalone installation to manage it with sod-off. Note that in the case of the legacy Codex app, it will be replaced with the modern ChatGPT app. No new apps will be installed; only previously installed apps will be updated.

## Architecture

Each file in `src/apps/` exports an interface-typed `AppModule` object. `name` registers its primary subcommand. `inspect` discovers the installation; optional `update` and `clean` methods return a release descriptor or cleanup targets. Register a new object in `src/apps/index.ts`; omitted methods are reported as unsupported.

```ts
import type { AppModule } from './src/core/types.ts';

const example: AppModule = {
  name: 'example',
  displayName: 'Example',
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
bun test
bun run typecheck
bun run check
```

Tests use temporary fixtures and mocked vendor metadata; they cover routing, cancellation, accounting, active-version protection, revalidation, signature/digest failures, mount cleanup, native launcher switching, and rollback. They do not update the developer's installed applications.

Vendor references: [Claude desktop download](https://claude.com/download), [Claude Code setup](https://code.claude.com/docs/en/setup), [ChatGPT download](https://chatgpt.com/download/), [Codex releases](https://github.com/openai/codex/releases), [IntelliJ downloads](https://www.jetbrains.com/idea/download/).
