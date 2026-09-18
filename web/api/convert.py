"""Turn a canonical BattINFO record into EMMO-aligned JSON-LD.

The transform is ~5,000 lines of Python in the battinfo package (json_to_jsonld,
jsonld, cell_spec_node). There is no JavaScript equivalent anywhere in the repo:
`jsonld` (npm) can expand and verify the output but cannot produce it, which is
why scripts/gen_web_jsonld.py precomputes the site's examples. Writing a port
would make this a second implementation of a normative contract -- the very
thing the authoring form exists to avoid. So the browser posts the record here
and the real `record_to_jsonld` answers.

requirements.txt pins the package to a commit of this repo, so the transform and
the schemas the form validates against are always the same version.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler

from battinfo import record_to_jsonld

MAX_BYTES = 1_000_000


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802 - the name Vercel's runtime calls
        length = int(self.headers.get("content-length") or 0)
        if length > MAX_BYTES:
            self._reply(413, {"error": "Record too large."})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            record, record_type = body["record"], body["record_type"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            self._reply(400, {"error": f"Expected {{record, record_type}}: {error}"})
            return
        try:
            self._reply(200, record_to_jsonld(record, record_type))
        except Exception as error:  # noqa: BLE001
            # The input came from a browser, so a bad record is an answer, not a
            # crash. The message is the transform's own, which names the field.
            self._reply(422, {"error": str(error)})

    def _reply(self, status: int, body: object) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
