"""Read-only single-station playback of imported measurements, independent of the live collector."""
import csv
import hashlib
import io
import json
import math
import os
import sqlite3
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

import station_profiles
from power_quality import add_derived

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/replay", tags=["单站离线回放"])
SAMPLES = Path(__file__).with_name("replay_sample")
RULE_VERSION = "1.0"
LOCAL_ZONE = timezone(timedelta(hours=8))


def connect():
    db = sqlite3.connect(os.getenv("REPLAY_DB_PATH", "replay.db"), timeout=15)
    db.row_factory = sqlite3.Row
    db.executescript("""
        CREATE TABLE IF NOT EXISTS replay_sets (
            id TEXT PRIMARY KEY, name TEXT, start INTEGER, end INTEGER, rule_version TEXT,
            point_count INTEGER, sample_count INTEGER, duplicates INTEGER
        );
        CREATE TABLE IF NOT EXISTS replay_points (
            dataset TEXT, id TEXT, spec TEXT, PRIMARY KEY(dataset, id)
        );
        CREATE TABLE IF NOT EXISTS replay_samples (
            dataset TEXT, point TEXT, ts INTEGER, val REAL, good INTEGER,
            PRIMARY KEY(dataset, point, ts)
        );
        CREATE TABLE IF NOT EXISTS replay_events (
            dataset TEXT, point TEXT, kind TEXT, start INTEGER, end INTEGER,
            first_seen INTEGER, trigger_value REAL, recovered_value REAL, detail TEXT,
            PRIMARY KEY(dataset, point, kind, start)
        );
        CREATE TABLE IF NOT EXISTS station_recordings (
            dataset TEXT, device TEXT, id TEXT, end INTEGER, meta TEXT, cfg BLOB, dat BLOB,
            PRIMARY KEY(dataset, device, id)
        );
    """)
    return db


def fail(message):
    raise HTTPException(422, message)


def rows(content, required, label):
    try:
        try:
            decoded = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            decoded = content.decode("gb18030")
        reader = csv.DictReader(io.StringIO(decoded, newline=""), strict=True)
        headers = [x.strip() for x in reader.fieldnames or []]
        missing = sorted(required.difference(headers))
        if missing:
            fail(f"{label}缺少列：{'、'.join(missing)}")
        if len(set(headers)) != len(headers):
            fail(f"{label}存在重复列名")
        reader.fieldnames = headers
        for row in reader:
            if None in row or any(v is None for v in row.values()):
                fail(f"{label}第 {reader.line_num} 行的列数与表头不一致")
            yield reader.line_num, {k: v.strip() for k, v in row.items()}
    except (UnicodeError, csv.Error) as e:
        fail(f"{label}编码或 CSV 格式错误：{e}")


def number(row, key, label, default=None):
    text = row.get(key, "")
    if not text and default is not None:
        return default
    try:
        value = float(text)
        if math.isfinite(value):
            return value
    except ValueError:
        pass
    fail(f"{label}的“{key}”应为有限数值")


def parse_points(content):
    result = {}
    for line, r in rows(content, {"设备", "测点编号", "名称", "类型", "上送方式"}, "点表"):
        loc = f"点表第 {line} 行"
        key = r["测点编号"]
        if not all((r["设备"], key, r["名称"])) or key in result:
            fail(f"{loc}设备、编号或名称为空，或编号重复")
        if r["类型"] not in ("模拟量", "开关量") or r["上送方式"] not in ("周期", "变位"):
            fail(f"{loc}类型须为模拟量或开关量，上送方式须为周期或变位")
        timeout = number(r, "断数秒", loc, 0)
        if timeout < 0 or (r["上送方式"] == "周期" and timeout <= 0):
            fail(f"{loc}周期测点必须设置正数的断数秒数")
        rule = r.get("规则", "") or "无"
        if rule not in ("无", "低限", "高限", "装置故障"):
            fail(f"{loc}规则须为无、低限、高限或装置故障")
        if rule != "无" and ((rule == "装置故障") != (r["类型"] == "开关量")):
            fail(f"{loc}规则与测点类型不匹配")
        trigger = clear = None
        if rule != "无":
            trigger = number(r, "触发值", loc)
            clear = number(r, "恢复值", loc)
            if ((rule == "高限" and clear > trigger) or (rule == "低限" and clear < trigger)
                    or (rule == "装置故障" and {trigger, clear} != {0, 1})):
                fail(f"{loc}触发值与恢复值不相容")
        delay = number(r, "持续秒", loc, 0)
        if delay < 0 or (delay and r["上送方式"] == "变位"):
            fail(f"{loc}持续秒应非负，变位点应设为 0")
        try:
            extra = station_profiles.metadata(r, loc)
        except ValueError as error:
            fail(str(error))
        result[key] = dict(**extra, id=key, device=r["设备"], name=r["名称"], unit=r.get("单位", ""),
                           kind=r["类型"], mode=r["上送方式"], timeout=timeout, rule=rule,
                           trigger=trigger, clear=clear, delay=delay,
                           off=r.get("零值含义") or "0", on=r.get("一值含义") or "1")
    if not result:
        fail("点表为空")
    try:
        station_profiles.check_groups(result)
    except ValueError as error:
        fail(str(error))
    return result


def parse_samples(content, specs):
    data = defaultdict(dict)
    duplicates = 0
    for line, r in rows(content, {"时间", "测点编号", "数值", "质量"}, "采样表"):
        loc = f"采样表第 {line} 行"
        pid = r["测点编号"]
        if pid not in specs:
            fail(f"{loc}测点 {pid} 未在点表中定义")
        try:
            stamp = datetime.fromisoformat(r["时间"].replace("Z", "+00:00"))
            ts = round((stamp if stamp.tzinfo else stamp.replace(tzinfo=LOCAL_ZONE)).timestamp() * 1000)
        except (ValueError, OSError, OverflowError):
            fail(f"{loc}时间格式无效，请使用含日期的 ISO 时间")
        if r["质量"] not in ("有效", "无效"):
            fail(f"{loc}质量应填写有效或无效")
        good = r["质量"] == "有效"
        value = number(r, "数值", loc) if good else None
        if good and specs[pid]["kind"] == "开关量" and value not in (0, 1):
            fail(f"{loc}开关量只接受 0 或 1")
        entry = value, good
        if ts in data[pid]:
            if data[pid][ts] != entry:
                fail(f"{loc}同一时刻同一测点存在冲突记录")
            duplicates += 1
        data[pid][ts] = entry
    if not data:
        fail("采样表为空")
    return data, duplicates


def events_for(spec, samples, end):
    records = []
    active = outage = pending = previous = None

    def add(kind, ts, first, value, detail):
        event = dict(kind=kind, start=ts, end=None, first_seen=first, trigger_value=value,
                     recovered_value=None, detail=detail)
        records.append(event)
        return event

    def gap(time, reason):
        nonlocal pending, outage
        pending = None
        if outage is None:
            outage = add("数据质量", time, time, None, reason)

    timeout = max(1, round(spec["timeout"] * 1000)) if spec["mode"] == "周期" else None
    for ts, (value, good) in sorted(samples.items()):
        if timeout and previous is not None and ts - previous > timeout:
            gap(previous + timeout, "超过点表允许的最大采样间隔")
        previous = ts
        if not good:
            gap(ts, "源数据标记无效")
            continue
        if outage:
            outage.update(end=ts, recovered_value=value)
            outage = None
        rule = spec["rule"]
        if rule == "无":
            continue
        if rule == "低限":
            abnormal, recovered = value < spec["trigger"], value >= spec["clear"]
        elif rule == "高限":
            abnormal, recovered = value > spec["trigger"], value <= spec["clear"]
        else:
            abnormal, recovered = value == spec["trigger"], value == spec["clear"]
        if active is not None:
            if recovered:
                active.update(end=ts, recovered_value=value)
                active = None
        elif abnormal:
            if pending is None:
                pending = ts
            if ts - pending >= spec["delay"] * 1000:
                detail = "装置上报故障" if rule == "装置故障" else f"有效采样持续满足{rule}条件"
                active = add(rule, ts, pending, value, detail)
                pending = None
        else:
            pending = None
    if timeout and previous is not None and end - previous >= timeout:
        gap(previous + timeout, "超过点表允许的最大采样间隔")
    return records


def import_set(name, points, samples):
    name = name.strip()
    if not name:
        fail("请输入站点或批次名称")
    specs = parse_points(points)
    data, duplicates = parse_samples(samples, specs)
    start = min(min(series) for series in data.values())
    end = max(max(series) for series in data.values())
    count = sum(map(len, data.values()))
    try:
        add_derived(specs, data)
    except ValueError as exc:
        fail(str(exc))
    rule_version = "2.0" if any(p["category"] != "未分类" for p in specs.values()) else RULE_VERSION
    digest = hashlib.sha256()
    for value in [rule_version.encode(), name.encode(), points, samples]:
        digest.update(len(value).to_bytes(8, "big"))
        digest.update(value)
    key = digest.hexdigest()
    with closing(connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        exists = db.execute("SELECT * FROM replay_sets WHERE id=?", (key,)).fetchone()
        if exists:
            return {**dict(exists), "existing": True}
        db.execute("INSERT INTO replay_sets VALUES(?,?,?,?,?,?,?,?)",
                   (key, name, start, end, rule_version, len(specs), count, duplicates))
        for pid, spec in specs.items():
            db.execute("INSERT INTO replay_points VALUES(?,?,?)", (key, pid, json.dumps(spec, ensure_ascii=False)))
            series = data.get(pid, {})
            db.executemany("INSERT INTO replay_samples VALUES(?,?,?,?,?)",
                           ((key, pid, ts, val, good) for ts, (val, good) in series.items()))
            for event in events_for(spec, series, end):
                db.execute("""INSERT INTO replay_events VALUES(:dataset,:point,:kind,:start,:end,:first_seen,
                           :trigger_value,:recovered_value,:detail)""",
                           dict(dataset=key, point=pid, **event))
        return dict(db.execute("SELECT * FROM replay_sets WHERE id=?", (key,)).fetchone())


@router.get("/datasets")
def datasets():
    with closing(connect()) as db:
        return [dict(r) for r in db.execute("SELECT * FROM replay_sets ORDER BY rowid DESC")]


@router.post("/datasets")
def upload(name: str = Form(...), points: UploadFile = File(...), samples: UploadFile = File(...)):
    return import_set(name, points.file.read(), samples.file.read())


@router.post("/sample")
def load_example():
    return import_set("模拟站 · 直流站用电源", (SAMPLES / "points.csv").read_bytes(),
                      (SAMPLES / "samples.csv").read_bytes())


@router.get("/templates/{kind}")
def template(kind: str):
    if kind not in ("points", "samples"):
        raise HTTPException(404, "模板不存在")
    return FileResponse(SAMPLES / f"{kind}.csv", media_type="text/csv", filename=f"{kind}.csv")


@router.get("/datasets/{key}/snapshot")
def snapshot(key: str, at: int, point: str = ""):
    with closing(connect()) as db:
        dataset = db.execute("SELECT * FROM replay_sets WHERE id=?", (key,)).fetchone()
        if not dataset:
            raise HTTPException(404, "数据批次不存在")
        if not dataset["start"] <= at <= dataset["end"]:
            fail("回放时刻超出该批数据范围")
        specs = [json.loads(r["spec"]) for r in db.execute(
            "SELECT spec FROM replay_points WHERE dataset=? ORDER BY rowid", (key,))]
        if point and point not in {p["id"] for p in specs}:
            fail("批次中没有所选测点")
        selected = point or specs[0]["id"]
        events = [dict(r) for r in db.execute("""SELECT point,kind,start,end,first_seen,trigger_value,
            recovered_value,detail FROM replay_events WHERE dataset=? AND start<=?
            ORDER BY start DESC, point, kind""", (key, at))]
        quality = set()
        active = set()
        for e in events:
            if e["end"] is None or e["end"] > at:
                e.update(end=None, recovered_value=None)
                (quality if e["kind"] == "数据质量" else active).add(e["point"])
        for p in specs:
            recent = db.execute("""SELECT ts,val FROM replay_samples WHERE dataset=? AND point=?
                AND ts<=? AND good=1 ORDER BY ts DESC LIMIT 1""", (key,p["id"],at)).fetchone()
            p.update(last_valid=recent["ts"] if recent else None,
                     value=recent["val"] if recent and p["id"] not in quality else None,
                     quality="数据异常" if p["id"] in quality else ("有效" if recent else "尚无样本"),
                     active=p["id"] in active)
        rows = db.execute("""SELECT ts,val FROM replay_samples WHERE dataset=? AND point=? AND ts<=?
            ORDER BY ts DESC LIMIT 601""",(key,selected,at)).fetchall()
        history = [{"ts": r["ts"], "value": r["val"]} for r in reversed(rows[:600])]
        for e in events:
            if e["kind"] == "数据质量" and e["point"] == selected and history and history[0]["ts"] <= e["start"]:
                history.append(dict(ts=e["start"], value=None))
        history.sort(key=lambda r:r["ts"])
        return dict(at=at, rule_version=dataset["rule_version"], points=specs, events=events, point=selected, history=history, truncated=len(rows)>600)
