"""Self-test Sentry de bout en bout par `main()` du sidecar, hors fenetre.

`SENTRY_DSN` du point d'entree est remplace par un DSN `http://` d'un serveur local qui retient
chaque POST : vrai SDK, vrai transport, vraie compression, rien ne quitte la machine. `main()`
tourne avec `stdin` = `get_version` puis `shutdown`, une fois par valeur de
`TECHNO_TAGGER_SENTRY_SELFTEST` (`1`, `true`, absente). Le trousseau est un `MemoryKeyring` des
helpers : le vrai n'est jamais lu. Le verdict releve, par cas, le nombre d'evenements, le type
et la valeur de l'exception, les variables de frame, les fragments sensibles de l'enveloppe
decompressee entiere (contexte source des frames compris), `server_name`, `release`,
`environment`, et le `sentry_selftest` de l'evenement `version`.
"""

import getpass
import gzip
import io
import json
import os
import sys
import threading
import zlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Final

import sentry_sdk
from _probe import emit
from memory_keyring import MemoryKeyring

import tagger.__main__ as entry
from tagger import APP_NAME, RELEASE
from tagger.core.observability import SELFTEST_ENV

FRAGMENTS: Final = ("Nova", "Mind", "Musique", getpass.getuser())
CASES: Final = (("1", "1"), ("true", "true"), ("absente", None))

bodies: list[bytes] = []


class _Capture(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        match self.headers.get("Content-Encoding"):
            case "gzip":
                raw = gzip.decompress(raw)
            case "deflate":
                raw = zlib.decompress(raw)
            case "br":
                import brotli  # noqa: PLC0415

                raw = brotli.decompress(raw)
            case _:
                pass
        bodies.append(raw)
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_args: object) -> None:
        return


def _events() -> list[dict[str, object]]:
    events = []
    for body in bodies:
        lines = body.split(b"\n")
        for header, payload in zip(lines[1::2], lines[2::2], strict=False):
            if json.loads(header).get("type") == "event":
                events.append(json.loads(payload))
    return events


def _run_main(value: str | None) -> list[dict[str, object]]:
    """`main()` sur un `stdin` de deux commandes, la sortie NDJSON relue ligne a ligne."""
    if value is None:
        os.environ.pop(SELFTEST_ENV, None)
    else:
        os.environ[SELFTEST_ENV] = value
    stdin = io.StringIO('{"command":"get_version"}\n{"command":"shutdown"}\n')
    stdout = io.StringIO()
    saved = sys.stdin, sys.stdout
    sys.stdin, sys.stdout = stdin, stdout
    try:
        entry.main()
    finally:
        sys.stdin, sys.stdout = saved
    return [json.loads(line) for line in stdout.getvalue().splitlines() if line]


def _case(label: str, value: str | None) -> dict[str, object]:
    bodies.clear()
    output = _run_main(value)
    sentry_sdk.flush(timeout=10)
    rendered = b"".join(bodies).decode("utf-8", errors="replace")
    events = _events()
    versions = [e for e in output if e.get("event") == "version"]
    return {
        "case": label,
        "events": len(events),
        "exceptions": [
            [(entry_["type"], entry_.get("value")) for entry_ in e["exception"]["values"]]
            for e in events
        ],
        "frame_vars": sum(
            "vars" in frame
            for e in events
            for exc in e["exception"]["values"]
            for frame in exc.get("stacktrace", {}).get("frames", [])
        ),
        # Prouve que le contexte source a bien ete joint, donc fouille par la recherche qui suit.
        "context_lines": sum(
            len(frame.get("pre_context", [])) + len(frame.get("post_context", []))
            for e in events
            for exc in e["exception"]["values"]
            for frame in exc.get("stacktrace", {}).get("frames", [])
        ),
        "body_chars": len(rendered),
        "fragments_found": [f for f in FRAGMENTS if f in rendered],
        "server_names": sorted({str(e.get("server_name")) for e in events}),
        "releases": sorted({str(e.get("release")) for e in events}),
        "environments": sorted({str(e.get("environment")) for e in events}),
        "output_events": [e.get("event") for e in output],
        "sentry_selftest": [e.get("sentry_selftest") for e in versions],
    }


def main() -> None:
    server = HTTPServer(("127.0.0.1", 0), _Capture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    entry.SENTRY_DSN = f"http://key@127.0.0.1:{server.server_port}/1"
    entry.WinVaultKeyring = MemoryKeyring

    cases = [_case(label, value) for label, value in CASES]
    server.shutdown()
    emit(
        {"success": True, "app_name": APP_NAME, "release": RELEASE, "cases": cases},
        indent=2,
    )


if __name__ == "__main__":
    main()
