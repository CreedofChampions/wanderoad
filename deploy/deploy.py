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
    for url in [PUBLIC_URL, PUBLIC_URL + "api/state.php?since=0", "https://crumbtown.org/cozydriver/", "https://crumbtown.org/cozydriver/social.jpg"]:
        r = subprocess.run(
            ["curl", "-s", "-o", os.devnull, "-w", "%{http_code}", f"{url}{'&' if '?' in url else '?'}cb={int(time.time())}"],
            capture_output=True,
            text=True,
        )
        print(f"  {r.stdout}  {url}")

    print(f"\nlive: {PUBLIC_URL}")


if __name__ == "__main__":
    main()
