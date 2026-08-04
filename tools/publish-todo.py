# created by AI
"""Cozy Driver — put the to-do list on the web, in one step.

The operator's rule, given after work went invisible twice: "every update must update the to-do
list", and the list he plans from is the ONLINE one at https://nibblet.net/cozy-todo/. Building the
page and uploading it were two separate errands, done by hand, which is exactly how a page goes
stale without anyone noticing. This does both: builds from `TODO-ITEMS.json` via
tools/build-todo.mjs, uploads, and refuses to claim success without a cache-busted 200 back.

It writes the built page to a `.htmltxt` staging file on purpose — a local `.html` gets auto-opened
in a preview pane, and he has asked more than once that nothing pop open beside him.

    python tools/publish-todo.py
"""
import io
import os
import posixpath
import subprocess
import sys
import importlib.util
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGE = r"D:\OpenClaw\tmp\cozy-todo.htmltxt"
REMOTE = "/home/admin/domains/nibblet.net/public_html/cozy-todo"
URL = "https://nibblet.net/cozy-todo/"

spec = importlib.util.spec_from_file_location("dep", os.path.join(ROOT, "deploy", "deploy.py"))
dep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dep)
import paramiko  # noqa: E402  (after deploy.py, which is where paramiko is known to be installed)


def main():
    build = subprocess.run(
        ["node", os.path.join(ROOT, "tools", "build-todo.mjs"), STAGE],
        cwd=ROOT, capture_output=True, text=True,
    )
    sys.stdout.write(build.stdout)
    if build.returncode != 0:
        sys.stderr.write(build.stderr)
        return 1
    html = io.open(STAGE, encoding="utf-8").read()

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(dep.HOST, username="root", password=dep.ROOT_PASS, timeout=30)
    sftp = ssh.open_sftp()
    try:
        sftp.stat(REMOTE)
    except IOError:
        sftp.mkdir(REMOTE)
    with sftp.open(posixpath.join(REMOTE, "index.html"), "w") as f:
        f.write(html)
    sftp.close()
    ssh.close()

    # Cache-busted, because a 200 off a stale cache proves nothing about what was just uploaded.
    with urllib.request.urlopen(URL + "?cb=publish", timeout=30) as r:
        served = r.read().decode("utf-8", "replace")
        code = r.status
    fresh = len(served) == len(html)
    print(f"  {code}  {URL}  ({len(served)} bytes served, {'matches' if fresh else 'DIFFERS from'} what was uploaded)")
    return 0 if code == 200 and fresh else 1


if __name__ == "__main__":
    raise SystemExit(main())
