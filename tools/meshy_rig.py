#!/usr/bin/env python3
"""Rig humanoid Meshy models and fetch their walking animation.

  MESHY_KEY_FILE=... python3 tools/meshy_rig.py submit <glb_dir> <state.json> name:yawDeg [...]
  MESHY_KEY_FILE=... python3 tools/meshy_rig.py poll <state.json> <out_dir>

yawDeg = forward angle of the model (atan2(z, x) in degrees, as calibrated in tools/render/models.json).
Meshy wants the character facing +Z (= 90°), so the GLB root is rotated accordingly before upload.
"""
import base64
import json
import math
import os
import struct
import sys
import urllib.request

API = "https://api.meshy.ai/openapi/v1/rigging"


def key():
    k = os.environ.get("MESHY_API_KEY")
    if not k and os.environ.get("MESHY_KEY_FILE"):
        k = open(os.environ["MESHY_KEY_FILE"]).read().strip()
    if not k:
        sys.exit("set MESHY_API_KEY or MESHY_KEY_FILE")
    return k


def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=300) as resp:
        return json.loads(resp.read().decode())


def rotate_glb(src, yaw_deg):
    """Return GLB bytes with all scene roots wrapped in a node rotated about Y so that forward -> +Z."""
    raw = open(src, "rb").read()
    magic, ver, length = struct.unpack_from("<III", raw, 0)
    assert magic == 0x46546C67
    off = 12
    chunks = []
    while off < length:
        clen, ctype = struct.unpack_from("<II", raw, off)
        chunks.append([ctype, raw[off + 8: off + 8 + clen]])
        off += 8 + clen
    js = json.loads(chunks[0][1].decode())
    # rotation needed: current forward angle yaw -> 90° (atan2(z,x) of +Z)
    # three/glTF: rotating by +θ about Y maps angle φ -> φ - θ, so θ = yaw - 90
    theta = math.radians(yaw_deg - 90)
    q = [0.0, math.sin(theta / 2), 0.0, math.cos(theta / 2)]
    scene = js["scenes"][js.get("scene", 0)]
    new_index = len(js["nodes"])
    js["nodes"].append({"name": "orient", "rotation": q, "children": list(scene["nodes"])})
    scene["nodes"] = [new_index]
    jb = json.dumps(js, separators=(",", ":")).encode()
    jb += b" " * ((4 - len(jb) % 4) % 4)
    chunks[0][1] = jb
    body = b"".join(struct.pack("<II", len(c[1]), c[0]) + c[1] for c in chunks)
    return struct.pack("<III", magic, ver, 12 + len(body)) + body


def submit(glb_dir, state_path, specs):
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    for spec in specs:
        name, yaw = spec.split(":")
        if name in state and state[name].get("status") not in ("FAILED", "CANCELED"):
            continue
        data = rotate_glb(os.path.join(glb_dir, f"{name}.glb"), float(yaw))
        uri = "data:model/gltf-binary;base64," + base64.b64encode(data).decode()
        try:
            res = req("POST", API, {"model_url": uri, "height_meters": 1.9})
            state[name] = {"id": res["result"], "status": "PENDING"}
            print("submitted", name, res["result"])
        except urllib.error.HTTPError as e:
            print("submit failed", name, e.code, e.read()[:300])
        json.dump(state, open(state_path, "w"), indent=1)


def poll(state_path, out_dir):
    state = json.load(open(state_path))
    os.makedirs(out_dir, exist_ok=True)
    for name, st in state.items():
        if st.get("status") == "SUCCEEDED" and os.path.exists(os.path.join(out_dir, f"{name}_walk.glb")):
            continue
        t = req("GET", f"{API}/{st['id']}")
        st["status"] = t.get("status")
        if t["status"] == "SUCCEEDED":
            anims = t["result"]["basic_animations"]
            urllib.request.urlretrieve(anims["walking_glb_url"], os.path.join(out_dir, f"{name}_walk.glb"))
            urllib.request.urlretrieve(anims["running_glb_url"], os.path.join(out_dir, f"{name}_run.glb"))
            print(name, "downloaded walk/run", t.get("consumed_credits"), "credits")
        elif t["status"] == "FAILED":
            print(name, "FAILED", t.get("task_error"))
        else:
            print(name, t["status"], t.get("progress"))
    json.dump(state, open(state_path, "w"), indent=1)


if __name__ == "__main__":
    if sys.argv[1] == "submit":
        submit(sys.argv[2], sys.argv[3], sys.argv[4:])
    else:
        poll(sys.argv[2], sys.argv[3])
