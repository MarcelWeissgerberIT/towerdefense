#!/usr/bin/env python3
"""Meshy image-to-3D helper.

The API key is read from the MESHY_API_KEY environment variable or from the file
given by MESHY_KEY_FILE – it is never stored in the repository.

  python3 tools/meshy.py submit <jobs.json> <state.json>   # create tasks for missing entries
  python3 tools/meshy.py poll   <state.json> <out_dir>     # check status, download finished GLBs

jobs.json: {"name": {"image_url": "...", "texture_prompt": "...optional"}}
"""
import json
import os
import sys
import time
import urllib.request

API = "https://api.meshy.ai/openapi/v1/image-to-3d"


def key():
    k = os.environ.get("MESHY_API_KEY")
    if not k and os.environ.get("MESHY_KEY_FILE"):
        k = open(os.environ["MESHY_KEY_FILE"]).read().strip()
    if not k:
        sys.exit("set MESHY_API_KEY or MESHY_KEY_FILE")
    return k


def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {key()}",
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode())


def load(p, default):
    try:
        return json.load(open(p))
    except FileNotFoundError:
        return default


def submit(jobs_path, state_path):
    jobs = json.load(open(jobs_path))
    state = load(state_path, {})
    for name, job in jobs.items():
        if name in state and state[name].get("status") not in ("FAILED", "CANCELED"):
            continue
        body = {
            "image_url": job["image_url"],
            "ai_model": "latest",
            "should_remesh": True,
            "target_polycount": job.get("polycount", 60000),
            "should_texture": True,
            "enable_pbr": True,
            "origin_at": "bottom",
            "target_formats": ["glb"],
        }
        if job.get("texture_prompt"):
            body["texture_prompt"] = job["texture_prompt"]
        try:
            res = req("POST", API, body)
            state[name] = {"id": res["result"], "status": "PENDING"}
            print("submitted", name, res["result"])
        except Exception as e:  # noqa
            print("submit failed", name, e)
        json.dump(state, open(state_path, "w"), indent=1)


def poll(state_path, out_dir):
    state = load(state_path, {})
    os.makedirs(out_dir, exist_ok=True)
    for name, st in state.items():
        dst = os.path.join(out_dir, f"{name}.glb")
        if st.get("status") == "SUCCEEDED" and os.path.exists(dst):
            continue
        try:
            t = req("GET", f"{API}/{st['id']}")
        except Exception as e:  # noqa
            print("poll failed", name, e)
            continue
        st["status"] = t.get("status")
        st["progress"] = t.get("progress")
        if t.get("status") == "SUCCEEDED":
            url = t["model_urls"]["glb"]
            urllib.request.urlretrieve(url, dst)
            st["thumb"] = t.get("thumbnail_url")
            st["credits"] = t.get("consumed_credits")
            print(f"{name}: downloaded {os.path.getsize(dst) // 1024} KB")
        elif t.get("status") == "FAILED":
            print(f"{name}: FAILED {t.get('task_error')}")
        else:
            print(f"{name}: {t.get('status')} {t.get('progress')}%")
    json.dump(state, open(state_path, "w"), indent=1)
    left = [n for n, s in state.items() if s.get("status") not in ("SUCCEEDED", "FAILED", "CANCELED")]
    print("remaining:", left)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "submit":
        submit(sys.argv[2], sys.argv[3])
    elif cmd == "poll":
        poll(sys.argv[2], sys.argv[3])
