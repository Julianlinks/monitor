from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

import replay
from main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("REPLAY_DB_PATH", str(tmp_path / "replay.db"))
    return TestClient(app)


def example(client):
    response = client.post("/api/replay/sample")
    response.raise_for_status()
    return response.json()


def snapshot(client, ds, second, point="BUS.V"):
    response = client.get(f"/api/replay/datasets/{ds['id']}/snapshot",
                          params={"at": ds["start"] + second * 1000, "point": point})
    response.raise_for_status()
    return response.json()


def test_seek_gap_and_recovery(client):
    ds = example(client)
    assert (ds["point_count"], ds["sample_count"]) == (3, 63)
    assert snapshot(client, ds, 8)["events"] == []  # short excursion
    assert not snapshot(client, ds, 16)["events"]
    at_alarm = snapshot(client, ds, 18)
    assert {e["kind"] for e in at_alarm["events"]} == {"低限", "装置故障"}
    assert all(e["end"] is None and e["recovered_value"] is None for e in at_alarm["events"])
    gap = snapshot(client, ds, 28)
    bus = next(p for p in gap["points"] if p["id"] == "BUS.V")
    assert bus["value"] is None and bus["active"] and bus["last_valid"] == ds["start"] + 22000
    assert gap["history"][-1]["value"] is None
    assert not any(e["kind"] == "数据质量" and e["point"] == "CHG.F" for e in gap["events"])
    restored = snapshot(client, ds, 52)
    low, = [e for e in restored["events"] if e["kind"] == "低限"]
    assert low["first_seen"] == ds["start"] + 14000
    assert low["end"] == ds["start"] + 44000 and low["recovered_value"] == 220
    assert snapshot(client, ds, 18) == at_alarm
    assert all(r["ts"] <= at_alarm["at"] for r in at_alarm["history"])


def test_upload_validation_dedup_and_rollback(client):
    points = client.get("/api/replay/templates/points").content
    lines = client.get("/api/replay/templates/samples").content.decode("utf-8-sig").splitlines()
    def upload(records):
        return client.post("/api/replay/datasets", data={"name": "现场样例"},
                           files={"points": ("points.csv", points),
                                  "samples": ("samples.csv", "\n".join(records).encode("gb18030"))})
    shuffled = [lines[0], *reversed(lines[1:]), lines[1]]
    ds = upload(shuffled).json()
    assert ds["duplicates"] == 1 and ds["sample_count"] == 63
    assert upload(shuffled).json()["existing"]
    assert snapshot(client, ds, 52)["events"]
    conflicting = upload([*shuffled, lines[1].replace(",220,", ",210,")])
    assert conflicting.status_code == 422 and "冲突" in conflicting.json()["detail"]
    assert upload([lines[0], lines[1].replace("BUS.V", "OTHER")]).status_code == 422
    assert len(client.get("/api/replay/datasets").json()) == 1


def test_gap_breaks_pending_and_delayed_start(client):
    points = replay.SAMPLES.joinpath("points.csv").read_bytes()
    lines = ["时间,测点编号,数值,质量",
             "2026-01-01T00:00:00Z,BUS.V,205,有效",
             "2026-01-01T08:00:07+08:00,BUS.V,205,有效",
             "2026-01-01T08:00:10,BUS.V,205,有效",
             "2026-01-01T08:00:11,BUS.V,205,有效"]
    ds = replay.import_set("中断", points, "\n".join(lines).encode())
    at_ten = snapshot(client, ds, 10)
    assert [e["kind"] for e in at_ten["events"]] == ["数据质量"]
    assert next(p for p in at_ten["points"] if p["id"] == "CHG.F")["quality"] == "尚无样本"
    e = next(e for e in snapshot(client, ds, 11)["events"] if e["kind"] == "低限")
    assert e["first_seen"] == ds["start"] + 7000


def test_concurrent_reimport_is_one_batch(client):
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda _: replay.load_example(), range(3)))
    assert len({r["id"] for r in results}) == 1
    assert len(replay.datasets()) == 1
