#!/usr/bin/env python3
"""Count the Library's Opens from the LAHE helper log.

LAHE Library plan, Task 3.3. Python standard library only, like the rest of
the tool, which has no dependencies.

Reads the helper log (helper.log in the state dir) and:

  * writes one CSV row per Open: review id, time, age in days, and whether
    the review was older than the Library's default view (DEFAULT_VIEW_DAYS)
  * prints Opens per working day (Monday to Friday in --tz), the weekend
    Opens, and how many Opens were older than the default view

The log line and the default view are read from src/shared/protocol.js, where
they are spelled once (CATALOG_LOG, catalogLogLine, CATALOG.DEFAULT_VIEW_DAYS).
A helper log line is "<ISO time> <text>"; a Library action's text is

    catalog <open|star|unstar|pickup|launch> review=<id> age_days=<n>

age_days is whole days from the review's last activity to the action, so an
Open is older than the default view when age_days > DEFAULT_VIEW_DAYS.

Usage:
    python3 scripts/catalog_opens.py [LOG] [--tz ZONE] [--csv PATH]

LOG defaults to the helper log in the state dir: $LAHE_STATE_DIR, else
$XDG_STATE_HOME/lahe, else ~/.local/state/lahe. --tz defaults to the system's
zone. --csv defaults to catalog_opens.csv in the current directory.
"""

import argparse
import csv
import datetime
import os
import re
import sys

try:
    import zoneinfo
except ImportError:  # Python before 3.9
    zoneinfo = None

HERE = os.path.dirname(os.path.abspath(__file__))
PROTOCOL = os.path.join(HERE, "..", "src", "shared", "protocol.js")

WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def fail(message):
    sys.stderr.write("catalog_opens: " + message + "\n")
    sys.exit(2)


def read_protocol():
    """The log prefix, the Open action and DEFAULT_VIEW_DAYS, from protocol.js."""
    try:
        with open(PROTOCOL, encoding="utf-8") as f:
            text = f.read()
    except OSError as err:
        fail("cannot read " + PROTOCOL + ": " + str(err))
    prefix = re.search(r'CATALOG_LOG\s*=\s*\{\s*PREFIX:\s*"([^"]+)"', text)
    action = re.search(r'ACTION:\s*\{[^}]*OPEN:\s*"([^"]+)"', text)
    days = re.search(r"DEFAULT_VIEW_DAYS:\s*(\d+)", text)
    if not (prefix and action and days):
        fail("protocol.js no longer spells CATALOG_LOG or DEFAULT_VIEW_DAYS the way this script reads them")
    return prefix.group(1), action.group(1), int(days.group(1))


def default_log_path():
    if os.environ.get("LAHE_STATE_DIR"):
        base = os.environ["LAHE_STATE_DIR"]
    elif os.environ.get("XDG_STATE_HOME"):
        base = os.path.join(os.environ["XDG_STATE_HOME"], "lahe")
    else:
        base = os.path.join(os.path.expanduser("~"), ".local", "state", "lahe")
    return os.path.join(base, "helper.log")


def time_zone(name):
    if name is None:
        return datetime.datetime.now().astimezone().tzinfo
    if name.upper() == "UTC":
        return datetime.timezone.utc
    if zoneinfo is None:
        fail("--tz needs Python 3.9 or later (zoneinfo)")
    try:
        return zoneinfo.ZoneInfo(name)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        fail("unknown time zone: " + name)


def parse_time(stamp):
    # The helper writes Date.toISOString(): 2026-09-21T14:00:00.000Z.
    if stamp.endswith("Z"):
        stamp = stamp[:-1] + "+00:00"
    try:
        when = datetime.datetime.fromisoformat(stamp)
    except ValueError:
        return None
    if when.tzinfo is None:
        return None
    return when


def read_opens(path, prefix, open_action):
    """Every well-formed Open line, in log order, as (review, utc time, age_days)."""
    line_re = re.compile(
        r"^(\S+) " + re.escape(prefix) + " " + re.escape(open_action)
        + r" review=(\S+) age_days=(\d+)$"
    )
    opens = []
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError as err:
        fail("cannot read the log " + path + ": " + str(err))
    with f:
        for raw in f:
            match = line_re.match(raw.rstrip("\r\n"))
            if not match:
                continue
            when = parse_time(match.group(1))
            if when is None:
                continue
            opens.append((match.group(2), when, int(match.group(3))))
    return opens


def main(argv):
    parser = argparse.ArgumentParser(description="Count the Library's Opens from the LAHE helper log.")
    parser.add_argument("log", nargs="?", help="the helper log (default: helper.log in the state dir)")
    parser.add_argument("--tz", help="time zone for working days, e.g. America/New_York (default: the system's)")
    parser.add_argument("--csv", default="catalog_opens.csv", help="where to write one row per Open")
    args = parser.parse_args(argv)

    prefix, open_action, view_days = read_protocol()
    zone = time_zone(args.tz)
    log_path = args.log or default_log_path()
    opens = read_opens(log_path, prefix, open_action)

    rows = []
    for review, when, age in opens:
        local = when.astimezone(zone)
        rows.append({
            "review": review,
            "time": local.isoformat(),
            "age_days": age,
            "older": age > view_days,
            "date": local.date(),
        })

    with open(args.csv, "w", newline="", encoding="utf-8") as out:
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(["review", "time", "age_days", "older_than_default_view"])
        for row in rows:
            writer.writerow([row["review"], row["time"], row["age_days"], "yes" if row["older"] else "no"])

    print("Log: " + log_path)
    print("CSV: " + args.csv)
    print("Time zone: " + (args.tz or str(zone)))
    print("Opens: " + str(len(rows)))
    if not rows:
        return 0

    per_date = {}
    for row in rows:
        per_date[row["date"]] = per_date.get(row["date"], 0) + 1

    # Every working day from the first Open's date to the last, zeros included,
    # so a quiet day counts toward the average.
    first = min(per_date)
    last = max(per_date)
    working_days = []
    day = first
    while day <= last:
        if day.weekday() < 5:
            working_days.append(day)
        day += datetime.timedelta(days=1)

    working_opens = sum(per_date.get(d, 0) for d in working_days)
    weekend_opens = sum(n for d, n in per_date.items() if d.weekday() >= 5)
    older = sum(1 for row in rows if row["older"])

    print("Opens per working day:")
    for d in working_days:
        print("  " + d.isoformat() + " " + WEEKDAYS[d.weekday()] + "  " + str(per_date.get(d, 0)))
    if working_days:
        average = working_opens / len(working_days)
        print("Opens on working days: %d over %d working days, %.2f per working day"
              % (working_opens, len(working_days), average))
    else:
        print("Opens on working days: 0 over 0 working days")
    print("Opens on weekends: " + str(weekend_opens))
    print("Opens older than the default view (%d days): %d of %d" % (view_days, older, len(rows)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
