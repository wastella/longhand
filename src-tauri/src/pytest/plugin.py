"""Longhand's pytest reporter.

Loaded with `-p longhand_pytest`, it writes one JSON object per line to the file named by
$LONGHAND_PYTEST_REPORT as the run happens, so the editor can show live progress and structured
results without scraping pytest's terminal output. It only observes the run and changes nothing
about it; without the variable it does nothing.
"""

import json
import os

_out = None


def _clean(value):
    """Makes text safe to encode: undecodable bytes in captured output become U+FFFD."""
    if isinstance(value, str):
        try:
            return value.encode("utf-8", "surrogateescape").decode("utf-8", "replace")
        except UnicodeError:
            return value.encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, dict):
        return {key: _clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(item) for item in value]
    return value


def _write(record):
    if _out is not None:
        _out.write(json.dumps(_clean(record), ensure_ascii=False) + "\n")


def _frames(longrepr):
    if hasattr(longrepr, "chain"):
        chain = longrepr.chain
    elif hasattr(longrepr, "reprtraceback"):
        chain = [(longrepr.reprtraceback, None, None)]
    else:
        return []
    frames = []
    for traceback, _crash, description in chain:
        for entry in getattr(traceback, "reprentries", []):
            location = getattr(entry, "reprfileloc", None)
            frames.append(
                {
                    "path": getattr(location, "path", None),
                    "lineno": getattr(location, "lineno", None),
                    "where": getattr(location, "message", ""),
                    "lines": [str(line) for line in getattr(entry, "lines", [])],
                }
            )
        if description:
            frames.append({"note": description})
    return frames


def _failure(report):
    failure = {"longrepr": report.longreprtext, "frames": _frames(report.longrepr)}
    crash = getattr(report.longrepr, "reprcrash", None)
    if crash is not None:
        failure["crash"] = {"path": str(crash.path), "lineno": crash.lineno, "message": crash.message}
    return failure


def pytest_configure(config):
    global _out
    path = os.environ.get("LONGHAND_PYTEST_REPORT")
    # Workers of pytest-xdist load plugins too; only the main process reports.
    if path and _out is None and not hasattr(config, "workerinput"):
        _out = open(path, "w", encoding="utf-8", buffering=1)
        _write({"event": "start"})


def pytest_collection_finish(session):
    _write({"event": "collected", "count": len(session.items)})


def pytest_collectreport(report):
    if report.failed:
        _write({"event": "collect-error", "nodeid": report.nodeid, **_failure(report)})


def pytest_runtest_logstart(nodeid, location):
    _write({"event": "begin", "nodeid": nodeid})


def pytest_runtest_logreport(report):
    path, lineno, _domain = report.location
    record = {
        "event": "report",
        "nodeid": report.nodeid,
        "when": report.when,
        "outcome": report.outcome,
        "duration": report.duration,
        "path": path,
        "lineno": lineno,
        "sections": [[title, text] for title, text in report.sections if text],
    }
    if hasattr(report, "wasxfail"):
        record["wasxfail"] = report.wasxfail
    if report.skipped and isinstance(report.longrepr, tuple):
        record["reason"] = report.longrepr[2]
    elif report.failed:
        record.update(_failure(report))
    _write(record)


def pytest_unconfigure(config):
    global _out
    if _out is not None:
        _write({"event": "finish"})
        _out.close()
        _out = None
