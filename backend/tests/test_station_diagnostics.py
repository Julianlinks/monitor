import csv
import io
import math
import struct

import pytest
from fastapi.testclient import TestClient

import diagnostics
from main import app
from power_quality import harmonic_ratio, negative_sequence


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("REPLAY_DB_PATH", str(tmp_path / "station.db"))
    return TestClient(app)


@pytest.fixture
def batch(client):
    res = client.post("/api/diagnostics/sample")
    res.raise_for_status()
    return res.json()


def frame(client, batch, offset):
    res = client.get("/api/diagnostics/" + batch["id"], params={"at": batch["start"] + offset})
    res.raise_for_status()
    return res.json()


def test_seven_categories_and_reproducible_evidence(client, batch):
    data = frame(client, batch, 23000)
    cats = {c["name"]: c for c in data["categories"]}
    assert len(cats) == 7 and all(c["devices"] for c in cats.values())
    assert batch["point_count"] == 35 and batch["rule_version"] == "2.0"
    for category in diagnostics.PAIRS:
        findings = cats[category]["findings"]
        assert len(findings) == 1 and len(findings[0]["points"]) == 2
    assert cats["监控系统"]["unknown"] == 1
    metrics = {m["name"]: m["value"] for m in cats["电能质量监测系统"]["metrics"]}
    assert metrics["电压相对额定值"] == 80
    assert metrics["负序电压不平衡度"] == pytest.approx(100 / 14)
    assert metrics["已测阶次电压畸变率"] == pytest.approx(100 * math.sqrt(229) / 184)
    (event,) = data["voltage_excursions"]
    assert event["minimum"] == 184 and event["end"] is None and not event["has_gap"]
    assert not any(c["findings"] for c in frame(client, batch, 60000)["categories"])
    assert frame(client, batch, 23000) == data
    repeat = client.post("/api/diagnostics/sample").json()
    assert repeat["existing"] and len(frame(client, repeat, 23000)["recordings"]) == 1


def test_two_action_windows_and_seek(client, batch):
    assert not frame(client, batch, 15099)["actions"]
    (waiting,) = frame(client, batch, 15164)["actions"]
    assert waiting["result"] == "等待反馈" and waiting["elapsed_ms"] is None
    (normal,) = frame(client, batch, 15165)["actions"]
    assert normal["elapsed_ms"] == 65 and normal["limit_ms"] == 120
    late = frame(client, batch, 30280)["actions"][0]
    assert late["result"] == "时限内未见新的反馈变位" and late["feedback_ts"] is None
    assert frame(client, batch, 30330)["actions"][0]["elapsed_ms"] == 230
    assert frame(client, batch, 30330)["actions"][0]["result"] == "时限后观测到同组反馈"
    assert frame(client, batch, 15100)["actions"] == [waiting]
    assert all(e["ts"] <= batch["start"] + 15164 for e in frame(client, batch, 15164)["sequence"])


def test_relay_ambiguous_and_missing_quality(client):
    specs = template("points").decode("utf-8-sig").replace("安自动作,备用回路", "安自动作,线路一")
    records = ["时间,测点编号,数值,质量"]
    for ms, point, val in [
        (0, "RP.TRIP", 0),
        (0, "SA.ACT", 0),
        (0, "BRK.OPEN", 0),
        (100, "RP.TRIP", 1),
        (110, "SA.ACT", 1),
        (135, "BRK.OPEN", 1),
        (300, "RP.TRIP", 0),
        (301, "BRK.OPEN", 0),
        (500, "RP.TRIP", 1),
        (510, "BRK.OPEN", None),
        (520, "BRK.OPEN", 0),
        (530, "BRK.OPEN", 1),
    ]:
        records.append(
            f"2026-01-01T08:00:00.{ms:03},{point},{val if val is not None else ''},{'有效' if val is not None else '无效'}"
        )
    b = import_csv(client, specs.encode(), "\n".join(records).encode()).json()
    actions = frame(client, b, 530)["actions"]
    assert [a["result"] for a in actions] == [
        "反馈依据不足",
        "动作窗口重叠，归属待核实",
        "动作窗口重叠，归属待核实",
    ]
    assert all(a["elapsed_ms"] is None for a in actions)


def template(name):
    return (
        (diagnostics.SAMPLE / name).read_bytes()
        if "." in name
        else (diagnostics.SAMPLE / (name + ".csv")).read_bytes()
    )


def import_csv(client, points, samples):
    return client.post(
        "/api/replay/datasets",
        data={"name": "测试批次"},
        files={"points": ("points.csv", points), "samples": ("samples.csv", samples)},
    )


def test_metrics_require_synchronized_valid_inputs(client):
    points = template("points")
    samples = "时间,测点编号,数值,质量\n" + "\n".join(
        f"2026-01-01T08:00:0{sec},{pid},{value},有效"
        for sec, pid, value in [
            (0, "PQ.H1", 100),
            (0, "PQ.H3", 3),
            (0, "PQ.H5", 4),
            (0, "PQ.H7", 0),
            (1, "PQ.H3", 2),
            (2, "PQ.H1", 0),
            (2, "PQ.H3", 3),
            (2, "PQ.H5", 4),
            (2, "PQ.H7", 0),
        ]
    )
    ds = import_csv(client, points, samples.encode()).json()

    def metric(t):
        return next(
            m
            for c in frame(client, ds, t)["categories"]
            for m in c["metrics"]
            if m["name"] == "已测阶次电压畸变率"
        )

    assert metric(0)["value"] == 5 and not metric(0)["active"]
    assert metric(1000)["value"] is None and metric(2000)["value"] is None
    assert negative_sequence([1, 0, 1, -120, 1, 120]) == pytest.approx(0, abs=1e-12)
    assert negative_sequence([1, 0, 1, 120, 1, -120]) is None
    assert harmonic_ratio([0, 3, 4]) is None


def test_legacy_and_metadata_validation(client):
    old = client.post("/api/replay/sample").json()
    assert old["rule_version"] == "1.0" and frame(client, old, 0)["categories"][-1]["name"] == "未分类"
    points = template("points").decode("utf-8-sig")
    for changed in [
        points.replace("触头温度,一号高压开关柜", "无效角色,一号高压开关柜"),
        points.replace("线路一,120,", "线路一,0,"),
        points.replace("模拟量,V,周期,3,低限,207", "模拟量,kV,周期,3,低限,207"),
    ]:
        assert import_csv(client, changed.encode(), template("samples")).status_code == 422
    assert len(client.get("/api/replay/datasets").json()) == 1


@pytest.mark.parametrize(
    "encoding,packing",
    [("ASCII", None), ("BINARY", "<IIhhH"), ("BINARY32", "<IIiiH"), ("FLOAT32", "<IIffH")],
)
def test_recording_variants_and_cursor(client, batch, encoding, packing):
    cfg = template("example.cfg").replace(b"ASCII", encoding.encode())
    dat = template("example.dat")
    if packing:
        dat = b"".join(
            struct.pack(packing, *map(int, row)) for row in csv.reader(io.StringIO(dat.decode()))
        )
    url = "/api/diagnostics/" + batch["id"] + "/recordings"
    args = {
        "data": {"device": "录波装置一"},
        "files": {"config": ("test.cfg", cfg), "data": ("test.dat", dat)},
    }
    res = client.post(url, **args)
    res.raise_for_status()
    meta = res.json()
    assert (meta["samples"], meta["analog"], meta["digital"]) == (320, 2, 1)
    path = url + "/" + meta["id"]
    query = {"device": "录波装置一", "at": meta["end"] - 1, "channel": 2}
    assert client.get(path, params=query).status_code == 404
    query["at"] = meta["end"]
    w = client.get(path, params=query).json()
    assert w["minimum"] == 0 and w["maximum"] == 1 and w["trigger_ms"] == 40
    assert (w["plot"][0]["ms"], w["plot"][-1]["ms"]) == (0, 159.5)
    assert client.get(path, params={**query, "channel": 3}).status_code == 422
    assert client.get(path, params={**query, "device": "其他站"}).status_code == 404


def test_invalid_recording_never_added(client, batch):
    url = "/api/diagnostics/" + batch["id"] + "/recordings"
    cfg, dat = template("example.cfg"), template("example.dat")
    for device, name, cf, da in [
        ("不存在", "test.dat", cfg, dat),
        ("录波装置一", "other.dat", cfg, dat),
        ("录波装置一", "test.dat", cfg, b"1,0,0,0,0"),
        ("录波装置一", "test.dat", cfg.replace(b"01/01/2026", b"01/03/2026"), dat),
        ("录波装置一", "test.dat", b"bad data", dat),
    ]:
        res = client.post(
            url, data={"device": device}, files={"config": ("test.cfg", cf), "data": (name, da)}
        )
        assert res.status_code == 422
    assert len(frame(client, batch, 60000)["recordings"]) == 1
