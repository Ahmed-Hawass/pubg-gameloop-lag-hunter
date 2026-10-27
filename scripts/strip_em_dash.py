#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Strip em dashes (U+2014) from a repository.

Scope: files tracked by git, files untracked but not ignored, and the
local-only files listed in .git/info/exclude. Generated and vendored
directories (node_modules, dist, coverage, target) are never touched.

Usage:
    python strip_em_dash.py <repo>            # dry run, report only
    python strip_em_dash.py <repo> --apply    # rewrite the files
"""
import os, subprocess, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

repo = sys.argv[1]
apply = "--apply" in sys.argv

EM = "\u2014".encode("utf-8")          # em dash
EN = "\u2013".encode("utf-8")          # en dash
BAR = "\u2015".encode("utf-8")         # horizontal bar
MINUS = "\u2212".encode("utf-8")       # minus sign


def git(*args):
    return subprocess.run(("git", "-C", repo) + args, capture_output=True, text=True).stdout


def collect():
    files = set()
    for out in (git("ls-files"), git("ls-files", "--others", "--exclude-standard")):
        for line in out.splitlines():
            line = line.strip()
            if line:
                files.add(line)
    # local-only files excluded through .git/info/exclude
    exclude = os.path.join(repo, ".git", "info", "exclude")
    if os.path.exists(exclude):
        for line in open(exclude, encoding="utf-8", errors="replace"):
            line = line.strip()
            if line and not line.startswith("#") and "/" in line:
                rel = line.lstrip("/")
                if os.path.exists(os.path.join(repo, rel)):
                    files.add(rel)
    return sorted(files)


def is_binary(path):
    try:
        with open(path, "rb") as fh:
            return b"\x00" in fh.read(8192)
    except OSError:
        return True


def main():
    files = collect()
    print("scanned files: %d" % len(files))
    hits = []
    skipped = 0
    for rel in files:
        path = os.path.join(repo, rel)
        if not os.path.isfile(path):
            continue
        if is_binary(path):
            skipped += 1
            continue
        with open(path, "rb") as fh:
            data = fh.read()
        n_em = data.count(EM)
        n_en = data.count(EN)
        n_bar = data.count(BAR)
        n_min = data.count(MINUS)
        if n_em or n_en or n_bar or n_min:
            hits.append((rel, n_em, n_en, n_bar, n_min))

    if not hits:
        print("no dash characters found")
        return

    total_em = sum(h[1] for h in hits)
    total_en = sum(h[2] for h in hits)
    total_bar = sum(h[3] for h in hits)
    total_min = sum(h[4] for h in hits)
    print("files with dash characters: %d (binary skipped: %d)" % (len(hits), skipped))
    print("  em dash U+2014      : %d" % total_em)
    print("  en dash U+2013      : %d" % total_en)
    print("  horizontal bar U+2015: %d" % total_bar)
    print("  minus sign U+2212   : %d" % total_min)
    print()
    for rel, n_em, n_en, n_bar, n_min in hits:
        if n_em:
            print("  EM %-4d | en %-3d | bar %-3d | min %-3d | %s" % (n_em, n_en, n_bar, n_min, rel))

    if not apply:
        print("\ndry run, nothing written")
        return

    changed = 0
    replaced = 0
    for rel, n_em, *_ in hits:
        if not n_em:
            continue
        path = os.path.join(repo, rel)
        with open(path, "rb") as fh:
            data = fh.read()
        new = data.replace(EM, b"-")
        with open(path, "wb") as fh:
            fh.write(new)
        changed += 1
        replaced += n_em
    print("\napplied: %d em dashes removed across %d files" % (replaced, changed))

    # verify
    left = 0
    for rel in files:
        path = os.path.join(repo, rel)
        if os.path.isfile(path) and not is_binary(path):
            with open(path, "rb") as fh:
                left += fh.read().count(EM)
    print("em dashes remaining : %d" % left)


if __name__ == "__main__":
    main()
