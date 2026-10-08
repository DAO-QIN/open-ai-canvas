"""Exercise the actual Web image and nginx.conf without exposing a test port.

Run: python3 scripts/test_nginx_spa_routes.py --image <built-web-image>
"""

import argparse
import json
import pathlib
import re
import subprocess
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent.parent
    container = "canvas-nginx-routes-" + uuid.uuid4().hex[:12]

    def docker(*command):
        return subprocess.check_output(["docker", *command])

    def file_bytes(path):
        return docker("exec", container, "cat", "/usr/share/nginx/html" + path)

    def request(path):
        result = subprocess.run(
            ["docker", "exec", container, "wget", "-S", "-O", "-",
             "http://127.0.0.1:3000" + path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
        )
        headers = result.stderr.decode()
        statuses = re.findall(r"HTTP/\d\.\d (\d+)", headers)
        assert result.returncode == 0 and statuses == ["200"], (path, headers)
        assert "location:" not in headers.lower(), (path, headers)
        return result.stdout, headers.lower()

    try:
        docker(
            "run", "--detach", "--name", container, "--network", "none",
            "--add-host", "backend:127.0.0.1",
            "--mount", "type=bind,src=" + str(root / "nginx.conf")
            + ",dst=/etc/nginx/conf.d/default.conf,readonly", args.image,
        )
        for _ in range(20):
            result = subprocess.run(
                ["docker", "exec", container, "wget", "-qO", "/dev/null",
                 "http://127.0.0.1:3000/"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if result.returncode == 0:
                break
            time.sleep(0.5)
        docker("exec", container, "nginx", "-t")
        html = file_bytes("/index.html")
        routes = ["/", "/assets", "/assets/", "/canvas", "/canvas/",
                  "/welcome", "/welcome/", "/inspirations", "/inspirations/"]
        for path in routes:
            body, headers = request(path)
            assert body == html, path
            assert "content-type: text/html" in headers, (path, headers)
            assert "cache-control: no-cache, must-revalidate" in headers, path
        manifest_path = "/inspirations/manifest.json"
        manifest, headers = request(manifest_path)
        assert manifest == file_bytes(manifest_path)
        json.loads(manifest)
        assert "content-type: application/json" in headers
        entries = re.findall(rb'(?:src|href)="(/assets/[^\"]+)"', html)
        assert entries, "No compiled assets in the actual Web image"
        for entry in entries:
            path = entry.decode()
            body, headers = request(path)
            assert body == file_bytes(path), path
            assert "immutable" in headers, path
        print(json.dumps({"htmlRoutes": routes, "staticManifest": manifest_path,
                          "compiledAssets": len(entries), "passed": True}))
    finally:
        subprocess.run(["docker", "rm", "--force", container],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
