# cursor-update

A fast, robust Bun CLI written in TypeScript to inspect, download, update, and clean Cursor installations on macOS.

## Features

- **Manual Redirection Inspection**: Queries `https://api2.cursor.sh/updates/download/golden/darwin-arm64/cursor/latest` with `redirect: "manual"` to extract the redirect location and commit hash without pre-downloading the ~300MB DMG.
- **Installed Version Check**: Reads local commit hash and version from `/Applications/Cursor.app/Contents/Resources/app/product.json`.
- **Atomic App Replacement**: Uses macOS `/usr/bin/ditto` to stage the application copy, atomically swaps the bundle, and handles rollbacks if interrupted.
- **Previous Version Cache Cleanup**: Automatically detects and deletes old commit caches in `~/Library/Application Support/Cursor/CachedData`, previous `~/Library/Caches/cursor-compile-cache` builds, and stale updater caches.
- **Guaranteed Cleanup**: Uses strict `try...finally` guards to ensure the disk image is always unmounted (`hdiutil detach`) and the temporary DMG is deleted from disk.
- **Biome Linting & Formatting**: Strict linting, formatting, and import organization via `@biomejs/biome`.
- **TypeScript**: Written with strict TypeScript.

## Requirements

- macOS (Apple Silicon `darwin-arm64`)
- [Bun](https://bun.sh) (v1.2+)

## Installation

```bash
bun install
```

To link the `cursor-update` CLI binary globally:

```bash
bun link
```

## Usage

### Run update check and upgrade

```bash
bun run start
# or directly:
./src/index.ts
```

If an update is available:
1. Downloads the DMG with a terminal progress bar.
2. Mounts the DMG via `hdiutil attach -nobrowse -readonly`.
3. Quits running Cursor instances gracefully and replaces `/Applications/Cursor.app`.
4. Deletes previous version cache folders.
5. Unmounts the DMG and deletes the installer file.

### CLI Options

| Flag | Description |
| --- | --- |
| `-c`, `--check` | Check for updates without downloading or installing |
| `-f`, `--force` | Force download and re-install even if already at latest commit |
| `-d`, `--dry-run` | Simulate the entire update process without modifying system files |
| `--app-path <path>` | Custom path to `Cursor.app` (default: `/Applications/Cursor.app`) |
| `--no-cache-clean` | Skip deleting previous version caches |
| `-v`, `--version` | Show CLI version |
| `-h`, `--help` | Show usage help |

### Examples

Check for updates without downloading:
```bash
bun run start --check
```

Simulate the update process (dry run):
```bash
bun run start --dry-run
```

Force reinstall:
```bash
bun run start --force
```

## Development

- **Run Tests**: `bun test`
- **Lint & Format Check**: `bun run check`
- **Auto-format**: `bun run format`
- **Typecheck**: `bun run typecheck`
