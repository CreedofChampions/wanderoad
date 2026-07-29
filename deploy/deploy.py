# <!-- created by AI -->
# Deploy Wanderoad to the Creed VPS (155.254.30.48, DirectAdmin / OpenLiteSpeed),
# served at https://crumbtown.org/wanderoad/.
#
#   dist/            -> /home/admin/domains/crumbtown.org/public_html/wanderoad/
#   server/*.php     -> .../wanderoad/api/
#   data dir         -> /home/admin/domains/crumbtown.org/wanderoad_data  (outside the docroot)
#
# Usage: python deploy/deploy.py [--skip-build]
import io
import os
import posixpath
import subprocess
import sys
import time

import re

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOST = "155.254.30.48"
# The root password is NOT in this file (this repo has a public mirror). It comes from the
# CRUMBTOWN_ROOT_PASS env var, or from deploy/secrets.local.json ({"root_pass": "..."}),
# which is gitignored - same box as crumbtown-site/deploy/deploy.py.
def _root_pass():
    v = os.environ.get("CRUMBTOWN_ROOT_PASS")
    if v:
        return v
    f = os.path.join(os.path.dirname(os.path.abspath(__file__)), "secrets.local.json")
    if os.path.exists(f):
        import json
        return json.load(open(f))["root_pass"]
    sys.exit("no VPS credential: set CRUMBTOWN_ROOT_PASS or create deploy/secrets.local.json")
ROOT_PASS = _root_pass()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
SERVER = os.path.join(ROOT, "server")
REMOTE_BASE = "/home/admin/domains/crumbtown.org/public_html/wanderoad"
REMOTE_DATA = "/home/admin/domains/crumbtown.org/wanderoad_data"
# cozydriver.com's own docroot — the apex the competition entry points at. See the rsync in
# deploy() for why it is a copy and not a symlink.
REMOTE_APEX = "/home/admin/domains/cozydriver.com/public_html"
# cozydriver.com/beta — its OWN directory, not a symlink. Operator: "all new changes to /beta".
# The apex is the competition entry and has to stay still; /beta is where work lands. Pass
# --beta to ship ONLY here and leave everything else exactly as it is.
REMOTE_BETA = REMOTE_APEX + "/beta"
PUBLIC_URL = "https://crumbtown.org/wanderoad/"

TEXT_EXT = {".html", ".js", ".css", ".json", ".svg", ".php", ".txt", ".htaccess", ".map"}


def run(ssh, cmd, timeout=120):
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    code = out.channel.recv_exit_status()
    return code, out.read().decode("utf-8", "replace"), err.read().decode("utf-8", "replace")


def upload_tree(sftp, ssh, local_dir, remote_dir):
    run(ssh, f"mkdir -p {remote_dir}")
    n = 0
    for name in sorted(os.listdir(local_dir)):
        lp = os.path.join(local_dir, name)
        rp = posixpath.join(remote_dir, name)
        if os.path.isdir(lp):
            n += upload_tree(sftp, ssh, lp, rp)
        else:
            sftp.put(lp, rp)
            n += 1
    return n


def _push_beta(ssh, sftp):
    """Ship dist/ to cozydriver.com/beta and PROVE the bundle hash landed.

    Its own directory rather than a symlink to the apex, because the apex is the URL on the
    competition entry and has to hold still while new work goes out. Operator: "all new changes
    to /beta please".

    The api/ folder is deliberately NOT copied: beta shares the live multiplayer/leaderboard
    endpoints under /wanderoad/api, so there is one set of PHP and one database rather than two
    that can disagree.
    """
    print(f"beta -> {REMOTE_BETA}")
    run(ssh, f"rm -rf {REMOTE_BETA}/assets {REMOTE_BETA}/index.html")
    run(ssh, f"mkdir -p {REMOTE_BETA}")
    n = upload_tree(sftp, ssh, DIST, REMOTE_BETA)
    run(ssh, f"chown -R admin:admin {REMOTE_BETA}; chmod -R 755 {REMOTE_BETA}")
    code, out, err = run(ssh, f"grep -o 'assets/index-[A-Za-z0-9_-]*[.]js' {REMOTE_BETA}/index.html | head -1")
    served = out.strip()
    want = ""
    with open(os.path.join(DIST, "index.html"), encoding="utf-8") as f:
        m = re.search(r"assets/index-[A-Za-z0-9_-]+\.js", f.read())
        want = m.group(0) if m else ""
    print(f"  uploaded {n} files; beta bundle {served or '(none)'} vs built {want or '(none)'}")
    if not served or (want and served != want):
        sys.exit(f"/beta was NOT updated: it serves {served!r}, the build is {want!r}")


def main():
    if "--skip-build" not in sys.argv:
        print("building…")
        r = subprocess.run(["npm", "run", "build"], cwd=ROOT, shell=True, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-3000:])
            print(r.stderr[-3000:])
            sys.exit("build failed")
        print("build ok")

    if not os.path.isdir(DIST):
        sys.exit("no dist/ — run npm run build first")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username="root", password=ROOT_PASS, timeout=30)
    sftp = ssh.open_sftp()

    if "--beta" in sys.argv:
        # Beta only. Nothing else on the box is touched — not /wanderoad, not the apex, not the
        # api. This is the mode to use for work in progress.
        _push_beta(ssh, sftp)
        sftp.close()
        ssh.close()
        print("smoke test…")
        time.sleep(1)
        for url in ["https://cozydriver.com/beta/"]:
            r = subprocess.run(["curl", "-s", "-o", os.devnull, "-w", "%{http_code}", f"{url}?cb={int(time.time())}"], capture_output=True, text=True)
            print(f"  {r.stdout}  {url}")
        print("")
        print("live: https://cozydriver.com/beta/")
        return

    print(f"clearing {REMOTE_BASE}")
    run(ssh, f"rm -rf {REMOTE_BASE}/assets {REMOTE_BASE}/index.html")
    run(ssh, f"mkdir -p {REMOTE_BASE} {REMOTE_DATA}")

    n = upload_tree(sftp, ssh, DIST, REMOTE_BASE)
    print(f"uploaded {n} files from dist/")

    if os.path.isdir(SERVER):
        m = upload_tree(sftp, ssh, SERVER, posixpath.join(REMOTE_BASE, "api"))
        print(f"uploaded {m} api files")

    # The worker bundle is served as a module worker; OpenLiteSpeed needs the right MIME
    # type or Chrome refuses it with a strict-MIME error.
    htaccess = (
        "AddType application/javascript .js\n"
        "AddType application/wasm .wasm\n"
        "<IfModule mod_headers.c>\n"
        '  Header set Cross-Origin-Opener-Policy "same-origin"\n'
        "</IfModule>\n"
        "<FilesMatch \"\\.(js|css|png|jpg|webp|svg)$\">\n"
        "  Header set Cache-Control \"public, max-age=86400\"\n"
        "</FilesMatch>\n"
        "<FilesMatch \"^index\\.html$\">\n"
        "  Header set Cache-Control \"no-cache\"\n"
        "</FilesMatch>\n"
    )
    with sftp.open(posixpath.join(REMOTE_BASE, ".htaccess"), "w") as f:
        f.write(htaccess)

    # The branded URL: /cozydriver is the SAME deployment via symlink — one docroot, two
    # paths, nothing to drift. /wanderoad stays live (it is on the competition form and in
    # every link shared so far).
    run(ssh, f"ln -sfn {REMOTE_BASE} {posixpath.dirname(REMOTE_BASE)}/cozydriver")

    # THE APEX DOMAIN, cozydriver.com, gets the same build in the same breath.
    #
    # It has its own docroot (a domain root cannot be a symlink into another domain's
    # public_html without DirectAdmin fighting it back), so this is a copy — but a copy made
    # BY THE DEPLOY, every time, rather than by hand afterwards. It had drifted a full day
    # behind: the apex was serving index-DpIYURtD.js while /cozydriver served the current
    # build, which is exactly the "one source of truth" failure this project keeps paying for.
    # The build is `base: './'` (vite.config.js), so the same files work at either root.
    # cp -a, not rsync: rsync is NOT installed on this box, and the first version of this
    # used it and failed SILENTLY — the smoke test still returned 200 because the apex was
    # serving yesterday's build perfectly well. Hence the exit-code check below.
    run(ssh, f"mkdir -p {REMOTE_APEX}")
    code, out, err = run(
        ssh,
        f"cd {REMOTE_BASE} && for p in *; do "
        f"[ \"$p\" = api ] && continue; [ \"$p\" = cgi-bin ] && continue; "
        f"rm -rf {REMOTE_APEX}/$p && cp -a \"$p\" {REMOTE_APEX}/; done && "
        f"cp -a .htaccess {REMOTE_APEX}/ 2>/dev/null; true",
    )
    run(ssh, f"chown -R admin:admin {REMOTE_APEX}; chmod -R 755 {REMOTE_APEX}")

    # /beta is its own directory now (see REMOTE_BETA). A full deploy refreshes it too, so
    # beta is never OLDER than the entry; a --beta deploy touches only beta.
    _push_beta(ssh, sftp)
    # and PROVE it took, rather than trusting a 200 from a page that might be yesterday's
    code, out, err = run(ssh, f"grep -o 'assets/index-[A-Za-z0-9_-]*[.]js' {REMOTE_APEX}/index.html | head -1")
    apex_bundle = out.strip()
    code, out, err = run(ssh, f"grep -o 'assets/index-[A-Za-z0-9_-]*[.]js' {REMOTE_BASE}/index.html | head -1")
    base_bundle = out.strip()
    print(f"  apex bundle {apex_bundle or '(none)'} vs deployed {base_bundle or '(none)'}")
    if not apex_bundle or apex_bundle != base_bundle:
        sys.exit(f"cozydriver.com was NOT updated: it serves {apex_bundle!r}, the deploy is {base_bundle!r}")

    run(ssh, f"chown -R admin:admin {REMOTE_BASE} {REMOTE_DATA}")
    run(ssh, f"chmod -R 755 {REMOTE_BASE}; chmod 775 {REMOTE_DATA}")

    code, out, err = run(ssh, f"ls -la {REMOTE_BASE} | head -20")
    print(out)

    # PHP lint every uploaded api file — a fatal parse error would otherwise only show up
    # as a 500 the first time a player joins.
    code, out, err = run(ssh, f"for f in {REMOTE_BASE}/api/*.php; do php -l \"$f\"; done")
    print(out.strip() or err.strip())

    sftp.close()
    ssh.close()

    print("smoke test…")
    time.sleep(1)
    for url in [PUBLIC_URL, PUBLIC_URL + "api/state.php?since=0", "https://crumbtown.org/cozydriver/", "https://crumbtown.org/cozydriver/social.jpg",
                "https://cozydriver.com/", "https://www.cozydriver.com/", "https://cozydriver.com/beta/"]:
        r = subprocess.run(
            ["curl", "-s", "-o", os.devnull, "-w", "%{http_code}", f"{url}{'&' if '?' in url else '?'}cb={int(time.time())}"],
            capture_output=True,
            text=True,
        )
        print(f"  {r.stdout}  {url}")

    print(f"\nlive: {PUBLIC_URL}")


if __name__ == "__main__":
    main()
