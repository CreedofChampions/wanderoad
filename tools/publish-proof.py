# created by AI
"""Wanderoad — put the proof screenshots online, as ONE link.

Operator: "YOU MUST PROVIDE SCREENSHOT PROOF of completion on website", and separately, standing:
reports are delivered as one online nibblet link, never a local path and never a preview pane.

Reads shots/proof/manifest-out.json (written by tools/proof-gallery.mjs), uploads every PNG to
nibblet.net/cozy-proof/, writes an index page with the item id, the operator's own words, the
in-game reading taken at the moment of the shot, and the photograph itself, then verifies the page
serves 200 with a cache-busted request.

    python tools/publish-proof.py
"""
import io
import os
import json
import time
import posixpath
import importlib.util
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "shots", "proof")
REMOTE = "/home/admin/domains/nibblet.net/public_html/cozy-proof"
URL = "https://nibblet.net/cozy-proof/"

spec = importlib.util.spec_from_file_location("dep", os.path.join(ROOT, "deploy", "deploy.py"))
dep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dep)
import paramiko  # noqa: E402  (after deploy.py, which is where paramiko is known to be installed)


def esc(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def main():
    man = os.path.join(SHOTS, "manifest-out.json")
    if not os.path.isfile(man):
        raise SystemExit("no manifest-out.json — run tools/proof-gallery.mjs first")
    rows = json.load(io.open(man, encoding="utf-8"))
    good = [r for r in rows if r.get("ok")]

    cards = []
    for r in rows:
        if r.get("ok"):
            reading = (
                '<p class="read">measured in game: <code>%s</code></p>' % esc(r["reading"])
                if r.get("reading")
                else ""
            )
            # A CLIP, not a still. Operator: "with games the proof has to be more than just an
            # image but a GIF showing movement (or webm for space) so it can be seen frame by frame
            # across 3 seconds minimum". Hence <video> with controls, plus explicit frame-step
            # buttons — scrubbing a video with a mouse cannot land on a single frame, and the whole
            # point is being able to walk through the motion one frame at a time.
            if r.get("clip"):
                media = (
                    '<video class="clip" src="%s" poster="%s" controls loop muted playsinline preload="none"></video>'
                    '<div class="ctl"><button data-step="-1">&#9664; frame</button>'
                    '<button data-play>play / pause</button>'
                    '<button data-step="1">frame &#9654;</button>'
                    '<span class="meta">%ss &middot; %s fps &middot; %s frames</span></div>'
                    % (esc(r["clip"]), esc(r["file"]), esc(r.get("seconds", "?")),
                       esc(r.get("fps", "?")), esc(r.get("frames", "?")))
                )
            else:
                media = '<a href="%s" target="_blank"><img loading="lazy" src="%s" alt="%s"></a>' % (
                    esc(r["file"]), esc(r["file"]), esc(r["label"]))
            cards.append(
                '<figure><h2><span class="id">%s</span> %s</h2>%s%s</figure>'
                % (esc(r["id"]), esc(r["label"]), reading, media)
            )
        else:
            cards.append(
                '<figure class="bad"><h2><span class="id">%s</span> %s</h2>'
                '<p class="read">NOT PROVEN — %s</p></figure>'
                % (esc(r["id"]), esc(r["label"]), esc(r.get("error", "no screenshot")))
            )

    stamp = time.strftime("%d %B %Y, %H:%M")
    html = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cozy Driver — proof</title>
<style>
 :root{color-scheme:dark}
 body{margin:0;padding:2rem 1rem 4rem;background:#14161a;color:#e8e6e1;
      font:17px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
 .wrap{max-width:1100px;margin:0 auto}
 h1{font-size:2rem;margin:0 0 .3rem;color:#f0c674}
 .sub{color:#9aa0a6;margin:0 0 2rem}
 .count{display:inline-block;background:#1e2128;border:1px solid #333;border-radius:99px;
        padding:.3rem .9rem;margin-right:.5rem}
 figure{margin:0 0 3rem;background:#1a1d23;border:1px solid #2b2f36;border-radius:14px;overflow:hidden}
 figure.bad{border-color:#7a2f2f}
 h2{font-size:1.15rem;margin:0;padding:1rem 1.2rem .4rem;font-weight:600}
 .id{display:inline-block;background:#f0c674;color:#14161a;border-radius:6px;
     padding:.05rem .5rem;margin-right:.6rem;font-weight:700;font-size:.85rem;vertical-align:2px}
 .read{margin:0;padding:0 1.2rem 1rem;color:#9aa0a6;font-size:.92rem}
 code{background:#0f1114;padding:.15rem .4rem;border-radius:5px;color:#a8d0a0}
 img,video.clip{display:block;width:100%;height:auto;border-top:1px solid #2b2f36;background:#000}
 .ctl{display:flex;gap:.5rem;align-items:center;padding:.7rem 1.2rem;flex-wrap:wrap}
 .ctl button{background:#2a2f38;color:#e8e6e1;border:1px solid #3a4049;border-radius:8px;
             padding:.4rem .8rem;font:inherit;font-size:.9rem;cursor:pointer}
 .ctl button:hover{background:#343a45}
 .ctl .meta{color:#9aa0a6;font-size:.85rem;margin-left:auto}
</style></head><body><div class="wrap">
<h1>Cozy Driver — screenshot proof</h1>
<p class="sub"><span class="count">@@OK@@ of @@N@@ proven</span> every shot taken from the live beta at
<a href="https://cozydriver.com/beta/" style="color:#f0c674">cozydriver.com/beta</a>, @@STAMP@@</p>
@@CARDS@@
</div>
<script>
/* FRAME BY FRAME. A WebM carries no frame index, so stepping is done by nudging currentTime by one
   frame's worth of seconds, using the rate each clip was actually captured at (printed beside it).
   Pause first — setting currentTime on a playing video just carries on playing from there. */
document.querySelectorAll('figure').forEach(function (fig) {
  var v = fig.querySelector('video');
  if (!v) return;
  var meta = fig.querySelector('.meta');
  var m = meta && meta.textContent.match(/([0-9.]+) fps/);
  var fps = m ? (parseFloat(m[1]) || 30) : 30;
  fig.querySelectorAll('[data-step]').forEach(function (b) {
    b.addEventListener('click', function () {
      v.pause();
      v.currentTime = Math.max(0, v.currentTime + parseInt(b.dataset.step, 10) / fps);
    });
  });
  var p = fig.querySelector('[data-play]');
  if (p) p.addEventListener('click', function () { v.paused ? v.play() : v.pause(); });
});
</script>
</body></html>"""
    # Placeholders rather than %-formatting: the stylesheet is full of "width:100%" and every one of
    # those is a format specifier to Python, which is what broke the first run of this file.
    html = (
        html.replace("@@OK@@", str(len(good)))
        .replace("@@N@@", str(len(rows)))
        .replace("@@STAMP@@", stamp)
        .replace("@@CARDS@@", "\n".join(cards))
    )

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(dep.HOST, username="root", password=dep.ROOT_PASS, timeout=30)
    ssh.exec_command("mkdir -p %s" % REMOTE)
    time.sleep(1)
    sftp = ssh.open_sftp()
    n = 0
    for r in good:
        # The poster AND the clip. Uploading only the still would publish a page of <video> tags
        # pointing at files that are not there — a proof page that proves nothing.
        for key in ("file", "clip"):
            name = r.get(key)
            if not name:
                continue
            local = os.path.join(SHOTS, name)
            if not os.path.isfile(local):
                continue
            with open(local, "rb") as fh, sftp.open(posixpath.join(REMOTE, name), "wb") as rf:
                rf.write(fh.read())
            n += 1
    with sftp.open(posixpath.join(REMOTE, "index.html"), "w") as f:
        f.write(html)
    sftp.close()
    ssh.exec_command("chown -R admin:admin %s" % REMOTE)
    ssh.close()
    print("uploaded %d files (clips + posters) + index" % n)

    time.sleep(2)
    cb = "%s?cb=%d" % (URL, int(time.time()))
    code = subprocess.run(
        ["curl", "-s", "-o", os.devnull, "-w", "%{http_code}", cb],
        capture_output=True, text=True,
    ).stdout.strip()
    print("live: %s  (http %s)" % (URL, code))
    if code != "200":
        raise SystemExit("the proof page does not serve — http %s" % code)


if __name__ == "__main__":
    main()
