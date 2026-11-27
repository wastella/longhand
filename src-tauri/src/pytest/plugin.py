"""Longhand's pytest reporter.

Loaded with `-p longhand_pytest`, it writes one JSON object per line to the file named by
$LONGHAND_PYTEST_REPORT as the run happens, so the editor can show live progress and structured
results without scraping pytest's terminal output. Without the variable it does nothing.

It changes the run in one way only: when $LONGHAND_PYTEST_SELECT names a JSON file, the run keeps
just the tests listed there (node ids, or a test's prefix such as a class or a parameterised
function) and the files or folders listed with them. The editor passes test files as arguments
and picks single tests this way, so a test that was renamed is simply not found, rather than
making pytest refuse the whole command.

Records: start, collected (count and ids), collect-error, begin, report, late (a failure pytest
counted without reporting it as it happened, such as a unittest subTest), interrupted, finish.
"""

import json
import os

import pytest

_out = None
_exitstatus = None
# (nodeid, when) of every failure written, so failures pytest only counted can be found later.
_failures_written = set()
_collected_written = False

# Longest captured section and failure text kept; the start and end are kept, where the useful
# parts are. A test that prints a tensor without end must not fill the disk or the editor.
SECTION_LIMIT = 100_000
TEXT_LIMIT = 200_000
FRAME_LINES = 400


def _cap(text, limit):
    if not isinstance(text, str) or len(text) <= limit:
        return text
    head, tail = text[: limit // 2], text[-limit // 2 :]
    dropped = text[limit // 2 : -limit // 2]
    return "%s\n… %d lines (%d characters) omitted …\n%s" % (head, dropped.count("\n"), len(dropped), tail)


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
            lines = [str(line) for line in getattr(entry, "lines", [])]
            if len(lines) > FRAME_LINES:
                lines = lines[: FRAME_LINES // 2] + ["… %d lines omitted …" % (len(lines) - FRAME_LINES)] + lines[-FRAME_LINES // 2 :]
            frames.append(
                {
                    "path": getattr(location, "path", None),
                    "lineno": getattr(location, "lineno", None),
                    "where": getattr(location, "message", ""),
                    "lines": [_cap(line, SECTION_LIMIT) for line in lines],
                }
            )
        if description:
            frames.append({"note": description})
    return frames


def _failure(report):
    failure = {"longrepr": _cap(report.longreprtext, TEXT_LIMIT), "frames": _frames(report.longrepr)}
    crash = getattr(report.longrepr, "reprcrash", None)
    if crash is not None:
        failure["crash"] = {"path": str(crash.path), "lineno": crash.lineno, "message": _cap(crash.message, TEXT_LIMIT)}
    return failure


def _report(report, event="report"):
    path, lineno, _domain = report.location
    record = {
        "event": event,
        "nodeid": report.nodeid,
        "when": report.when,
        "outcome": report.outcome,
        "duration": getattr(report, "duration", 0),
        "path": path,
        "lineno": lineno,
    }
    # Each report repeats the sections captured so far; the last one has them all.
    if report.when == "teardown" or event == "late":
        record["sections"] = [[title, _cap(text, SECTION_LIMIT)] for title, text in report.sections if text]
    context = getattr(report, "context", None)
    if context is not None:
        # A subtest: which one failed.
        msg = getattr(context, "msg", None)
        kwargs = getattr(context, "kwargs", None) or {}
        # pytest-xdist hands the values over as their repr already.
        shown = lambda value: value if isinstance(value, str) else repr(value)
        parts = ([shown(msg)] if msg else []) + ["%s=%s" % (key, shown(value)) for key, value in kwargs.items()]
        record["subtest"] = ", ".join(parts)
    if hasattr(report, "wasxfail"):
        record["wasxfail"] = report.wasxfail
    if report.skipped and isinstance(report.longrepr, tuple):
        record["reason"] = report.longrepr[2]
    elif report.failed:
        record.update(_failure(report))
        _failures_written.add((report.nodeid, report.when))
    return record


def _is_controller_or_alone(config):
    return not hasattr(config, "workerinput")


def pytest_configure(config):
    global _out
    path = os.environ.get("LONGHAND_PYTEST_REPORT")
    # Workers of pytest-xdist load plugins too; only the main process reports.
    if path and _out is None and _is_controller_or_alone(config):
        _out = open(path, "w", encoding="utf-8", buffering=1)
        _write({"event": "start"})


def _selection():
    path = os.environ.get("LONGHAND_PYTEST_SELECT")
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as file:
            return json.load(file)
    except (OSError, ValueError):
        return None


def _selected(nodeid, selection):
    for id in selection.get("ids", []):
        if nodeid == id or nodeid.startswith(id + "::") or nodeid.startswith(id + "["):
            return True
    file = nodeid.split("::", 1)[0]
    for path in selection.get("paths", []):
        path = path.rstrip("/")
        if file == path or file.startswith(path + "/"):
            return True
    return False


@pytest.hookimpl(trylast=True)
def pytest_collection_modifyitems(session, config, items):
    selection = _selection()
    if selection is None:
        return
    keep, drop = [], []
    for item in items:
        (keep if _selected(item.nodeid, selection) else drop).append(item)
    if drop:
        config.hook.pytest_deselected(items=drop)
        items[:] = keep


def _collected(ids):
    global _collected_written
    if not _collected_written:
        _collected_written = True
        _write({"event": "collected", "count": len(ids), "ids": ids})


def pytest_collection_finish(session):
    if _is_controller_or_alone(session.config):
        _collected([item.nodeid for item in session.items])


@pytest.hookimpl(optionalhook=True)
def pytest_xdist_node_collection_finished(node, ids):
    # With pytest-xdist the main process collects nothing; every worker collects the same tests.
    _collected(list(ids))


def pytest_collectreport(report):
    if report.failed:
        _write({"event": "collect-error", "nodeid": report.nodeid, **_failure(report)})


def pytest_runtest_logstart(nodeid, location):
    _write({"event": "begin", "nodeid": nodeid})


def pytest_runtest_logreport(report):
    _write(_report(report))


def pytest_keyboard_interrupt(excinfo):
    # Ctrl+C, and pytest.exit() too.
    _write({"event": "interrupted", "message": _cap(excinfo.exconly(), TEXT_LIMIT)})


def pytest_sessionfinish(session, exitstatus):
    global _exitstatus
    _exitstatus = int(exitstatus)


def pytest_terminal_summary(terminalreporter):
    # Some failures are counted without passing through pytest_runtest_logreport (unittest's
    # subTest in some pytest versions); they must not show as passes.
    for key in ("failed", "error"):
        for report in terminalreporter.stats.get(key, []):
            nodeid, when = getattr(report, "nodeid", None), getattr(report, "when", None)
            if nodeid and when and when != "collect" and (nodeid, when) not in _failures_written:
                _write(_report(report, "late"))


def pytest_unconfigure(config):
    global _out
    if _out is not None:
        _write({"event": "finish", "exitstatus": _exitstatus})
        _out.close()
        _out = None
