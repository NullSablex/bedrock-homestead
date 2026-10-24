#!/usr/bin/env python3
"""
Builds the release packages into dist/.

Three of them, because two different people download this:

    Homestead_v<version>.mcaddon     both packs; opening it installs the lot
    Homestead_BP_v<version>.mcpack   behavior pack alone
    Homestead_RP_v<version>.mcpack   resource pack alone

A player wants the one that just works. A server owner placing each half by
hand wants the halves. Shipping only the combined file forces them to unzip it;
shipping only the halves makes the common case harder than it needs to be.

Python rather than a shell script: Git Bash on Windows has no `zip`, and its
GNU tar cannot produce ZIP archives. `zipfile` is in the standard library and
behaves the same on Windows, Linux and macOS.

Entry names use forward slashes deliberately. PowerShell's Compress-Archive
writes backslashes, which violates the ZIP spec and gets the package rejected
by several clients and by BDS.

Usage:
    python tools/build.py          # the .mcaddon only
    python tools/build.py --all    # all three
"""

import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
DIST = ROOT / "dist"
ADDON = "Homestead"

# (folder on disk, name inside an archive)
BEHAVIOR = (Path("behavior_packs") / "homestead", "homestead_BP")
RESOURCE = (Path("resource_packs") / "homestead", "homestead_RP")


def check_versions_match() -> str:
    """
    Both manifests carry their own version, and the game does not care whether
    they agree. A mismatch only shows up as a dependency the game cannot
    resolve, which reads as "the pack is broken" rather than "you forgot one".
    """
    versions = {}
    for source, _ in (BEHAVIOR, RESOURCE):
        manifest = json.loads((ROOT / source / "manifest.json").read_text(encoding="utf-8"))
        versions[str(source)] = ".".join(str(n) for n in manifest["header"]["version"])

    if len(set(versions.values())) != 1:
        for pack, version in versions.items():
            print(f"  {pack}: {version}", file=sys.stderr)
        raise SystemExit("manifest versions disagree")

    return next(iter(versions.values()))


def write_archive(path: Path, parts) -> int:
    """`parts` is a list of (folder on disk, prefix inside the archive)."""
    path.unlink(missing_ok=True)
    written = 0

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for source, prefix in parts:
            folder = ROOT / source
            if not folder.is_dir():
                raise SystemExit(f"missing pack folder: {source}")

            for file in sorted(folder.rglob("*")):
                if not file.is_file():
                    continue
                # An .mcpack holds one pack at its root; an .mcaddon holds each
                # pack in a folder of its own, so they cannot collide.
                relative = file.relative_to(folder).as_posix()
                archive.write(file, f"{prefix}/{relative}" if prefix else relative)
                written += 1

    return written


def verify(path: Path, expected_manifests) -> None:
    """A manifest that is not at its pack root makes the game ignore the pack."""
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
    missing = set(expected_manifests) - names
    if missing:
        raise SystemExit(f"{path.name}: manifest not at pack root: {', '.join(sorted(missing))}")


def build(all_packages: bool) -> int:
    version = check_versions_match()
    DIST.mkdir(exist_ok=True)

    combined = DIST / f"{ADDON}_v{version}.mcaddon"
    count = write_archive(combined, [BEHAVIOR, RESOURCE])
    verify(combined, [f"{BEHAVIOR[1]}/manifest.json", f"{RESOURCE[1]}/manifest.json"])
    print(f"built: {combined.name}  ({count} files)")

    if all_packages:
        for source, label in ((BEHAVIOR, "BP"), (RESOURCE, "RP")):
            single = DIST / f"{ADDON}_{label}_v{version}.mcpack"
            count = write_archive(single, [(source[0], "")])
            verify(single, ["manifest.json"])
            print(f"built: {single.name}  ({count} files)")

    print(f"\nversion {version} -> {DIST}")
    return 0


if __name__ == "__main__":
    sys.exit(build(all_packages="--all" in sys.argv))
