#!/usr/bin/env python3
"""Copy Ken's Lahe state folder for a preview helper, with every live pid left out.

The preview (plan Task 4.3) runs the feature branch's own helper on another port
against a COPY of the real state folder, never the real one. A copy that still
names the real helper's pid, the real monitors' pids or the login item would let
the preview helper's sweeps stop Ken's real processes, so this script:

  - copies everything under the state folder except service.json (the running
    helper and its pid), install.json (the login item), the menubar folder, the
    logs, and catalog-attach.json (which agent the Library hands requests to);
  - rewrites every agent-sessions/*/monitor.json in the copy to an empty object,
    so no monitor pid is believed live;
  - writes nothing into the real folder and deletes nothing anywhere.

Usage:
  python3 make_state_copy.py [--from ~/.local/state/lahe] [--to ~/Documents/lahe-choice-preview/state]

The destination must not exist yet. Start the preview helper with:
  node bin/lahe.js serve --port 7819 --state-dir <to>   (from the feature worktree, detached)
and serve the page with `lahe review <file> --port 7819 --state-dir <to>`.
"""
import argparse
import os
import shutil
import sys

SKIP_TOP = {"service.json", "install.json", "menubar", "helper.log", "serve.log", "serve.out",
            "menubar.log", "login-item.log", "catalog-attach.json"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", default=os.path.expanduser("~/.local/state/lahe"))
    ap.add_argument("--to", dest="dst", default=os.path.expanduser("~/Documents/lahe-choice-preview/state"))
    a = ap.parse_args()
    if os.path.exists(a.dst):
        print("destination exists, refusing to overwrite:", a.dst, file=sys.stderr)
        return 2
    if ".git" in os.listdir(os.path.dirname(a.dst)) if os.path.isdir(os.path.dirname(a.dst)) else False:
        print("destination sits in a git checkout; the helper refuses that", file=sys.stderr)
        return 2

    def ignore(folder, names):
        if os.path.abspath(folder) == os.path.abspath(a.src):
            return [n for n in names if n in SKIP_TOP]
        return []

    shutil.copytree(a.src, a.dst, ignore=ignore, symlinks=True)
    blanked = 0
    sessions = os.path.join(a.dst, "agent-sessions")
    if os.path.isdir(sessions):
        for sid in os.listdir(sessions):
            mon = os.path.join(sessions, sid, "monitor.json")
            if os.path.isfile(mon):
                with open(mon, "w", encoding="utf-8") as fh:
                    fh.write("{}\n")
                blanked += 1
    print("copied", a.src, "to", a.dst)
    print("left out:", ", ".join(sorted(SKIP_TOP)))
    print("monitor.json files blanked:", blanked)
    return 0


if __name__ == "__main__":
    sys.exit(main())
