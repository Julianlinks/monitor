"""Station condition monitoring evaluated strictly as of the replay cursor."""

import json
from collections import defaultdict
from contextlib import closing
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse

import recordings
import replay
from station_profiles import CATEGORIES, POWER_QUALITY, PROTECTION

router = APIRouter(prefix="/api/diagnostics", tags=["专业诊断"])
SAMPLE = Path(__file__).with_name("station_sample")

# Conditions are observations within the same configured equipment group.
PAIRS = {
    "高压设备": ("触头温度", "负载率", "触头温度与负载率同时越限"),
    "监控系统": ("采集心跳", "链路故障", "采集心跳异常并伴有链路故障上报"),
    "电力系统动态记录装置": ("对时异常", "存储告警", "录波装置同时上报对时和存储异常"),
    "站用电源系统": ("母线电压", "充电机故障", "母线电压异常期间，充电机同时上报故障"),
    "辅助设施": ("环境温度", "风机故障", "环境温度异常期间，通风设备同时上报故障"),
}


@router.get("/templates/{kind}")
def template(kind: str):
    names = {
        "points": "points.csv",
        "samples": "samples.csv",
        "cfg": "example.cfg",
        "dat": "example.dat",
    }
    if kind not in names:
        replay.fail("模板不存在")
    return FileResponse(SAMPLE / names[kind], filename=names[kind])


@router.post("/sample")
def load_sample():
    ds = replay.import_set(
        "模拟站 · 七类电气设备",
        (SAMPLE / "points.csv").read_bytes(),
        (SAMPLE / "samples.csv").read_bytes(),
    )
    with closing(replay.connect()) as db, db:
        recordings.store(
            db,
            ds["id"],
            "录波装置一",
            "example.cfg",
            (SAMPLE / "example.cfg").read_bytes(),
            (SAMPLE / "example.dat").read_bytes(),
        )
    return ds


def sequence_analysis(db, dataset, at, points):
    """Use observed rising edges; the initial state never constitutes an action."""
    series = {}
    timeline = []
    for p in points:
        if p.get("role") not in ("保护动作", "安自动作", "动作反馈"):
            continue
        rows = db.execute(
            """SELECT ts,val,good FROM replay_samples WHERE dataset=? AND point=? AND ts<=?
                         ORDER BY ts""",
            (dataset, p["id"], at),
        )
        transitions = []
        prev = None
        previous_time = None
        for row in rows:
            if (
                p["mode"] == "周期"
                and previous_time is not None
                and row["ts"] - previous_time > p["timeout"] * 1000
            ):
                prev = None
            previous_time = row["ts"]
            value = row["val"] if row["good"] else None
            if value != prev:
                event = dict(
                    ts=row["ts"],
                    point=p["id"],
                    device=p["device"],
                    role=p["role"],
                    value=value,
                    group=p["group"],
                    rise=prev == 0 and value == 1,
                    state="质量无效" if value is None else (p["on"] if value else p["off"]),
                )
                transitions.append(event)
                if prev is not None or value is None:
                    timeline.append(event)
            prev = value
        series[p["id"]] = transitions
    groups = defaultdict(list)
    for p in points:
        if p["id"] in series:
            groups[p["group"]].append(p)
    associations = []
    for group, members in groups.items():
        actions = sorted(
            (r["ts"], p["id"], p["deadline_ms"])
            for p in members
            if p["role"] != "动作反馈"
            for r in series[p["id"]]
            if r["rise"]
        )
        feedback = next((p for p in members if p["role"] == "动作反馈"), None)
        edges = series[feedback["id"]] if feedback else []
        ups = [r["ts"] for r in edges if r["rise"]]
        consumed = set()
        for i, (start, pid, window) in enumerate(actions):
            deadline = start + window
            matches = [ts for ts in ups if start <= ts <= deadline and ts not in consumed]
            ambiguous = i + 1 < len(actions) and actions[i + 1][0] <= min(
                deadline, matches[0] if matches else at
            )
            previous_overlap = (
                i > 0
                and actions[i - 1][0] + actions[i - 1][2] >= start
                and associations[-1]["result"] == "动作窗口重叠，归属待核实"
            )
            match = None
            if ambiguous or previous_overlap:
                result = "动作窗口重叠，归属待核实"
            elif not feedback:
                result = "未配置反馈测点"
            else:
                next_action = actions[i + 1][0] if i + 1 < len(actions) else None
                late = next(
                    (
                        ts
                        for ts in ups
                        if deadline < ts
                        and (next_action is None or ts < next_action)
                        and ts not in consumed
                    ),
                    None,
                )
                candidate = matches[0] if matches else late
                until = candidate if candidate is not None else min(at, deadline)
                baseline = next((r for r in reversed(edges) if r["ts"] <= start), None)
                gaps = db.execute(
                    """SELECT 1 FROM replay_events WHERE dataset=? AND point=? AND kind='数据质量'
                    AND start<=? AND (end IS NULL OR end>?) LIMIT 1""",
                    (dataset, feedback["id"], until, start),
                ).fetchone()
                if not baseline or baseline["value"] is None or gaps:
                    result = "反馈依据不足"
                elif candidate is not None:
                    match = candidate
                    consumed.add(match)
                    result = "时限内观察到反馈" if match <= deadline else "时限后观测到同组反馈"
                else:
                    result = "等待反馈" if at < deadline else "时限内未见新的反馈变位"
            associations.append(
                dict(
                    group=group,
                    point=pid,
                    ts=start,
                    limit_ms=window,
                    feedback=feedback["id"] if feedback else None,
                    feedback_ts=match,
                    elapsed_ms=match - start if match is not None else None,
                    result=result,
                )
            )
    return sorted(timeline, key=lambda r: r["ts"]), sorted(
        associations, key=lambda r: r["ts"], reverse=True
    )


@router.get("/{dataset}")
def overview(dataset: str, at: int):
    frame = replay.snapshot(dataset, at)
    points = frame["points"]
    for p in points:
        p.setdefault("category", "未分类")
        p.setdefault("role", "")
        p.setdefault("group", p["device"])
    by_id = {p["id"]: p for p in points}
    categories = []
    for name in [*CATEGORIES, *(["未分类"] if any(p["category"] == "未分类" for p in points) else [])]:
        members = [p for p in points if p["category"] == name]
        events = [e for e in frame["events"] if by_id[e["point"]]["category"] == name]
        groups = defaultdict(list)
        for p in members:
            groups[p["group"]].append(p)
        findings = []
        if name in PAIRS:
            left, right, title = PAIRS[name]
            for group, group_points in groups.items():
                affected = [
                    p
                    for p in group_points
                    if (p["active"] and p["quality"] == "有效")
                    or (p["role"] == "采集心跳" and p["quality"] == "数据异常")
                ]
                if {left, right} <= {p["role"] for p in affected}:
                    findings.append(
                        dict(
                            title=title,
                            group=group,
                            points=[p["id"] for p in affected if p["role"] in (left, right)],
                        )
                    )
        metrics = []
        if name == POWER_QUALITY:
            for p in members:
                if p.get("method"):
                    metrics.append(
                        dict(
                            name=p["name"],
                            point=p["id"],
                            value=p["value"],
                            unit=p["unit"],
                            method=p["method"],
                            inputs=p["inputs"],
                            active=p["active"],
                            group=p["group"],
                        )
                    )
                if p["role"] == "电压有效值" and p.get("nominal"):
                    metrics.append(
                        dict(
                            name="电压相对额定值",
                            point=p["id"],
                            group=p["group"],
                            unit="%",
                            value=(
                                None if p["value"] is None else round(100 * p["value"] / p["nominal"], 4)
                            ),
                            method=f"实测有效值除以本批额定值 {p['nominal']} V。",
                            inputs=[p["id"]],
                            active=p["active"],
                        )
                    )
        categories.append(
            dict(
                name=name,
                devices=len({p["device"] for p in members}),
                points=members,
                events=events,
                findings=findings,
                metrics=metrics,
                active=sum(p["active"] for p in members),
                unknown=sum(p["quality"] != "有效" for p in members),
            )
        )
    with closing(replay.connect()) as db:
        soe, actions = sequence_analysis(
            db, dataset, at, [p for p in points if p["category"] == PROTECTION]
        )
        files = [
            json.loads(row[0])
            for row in db.execute(
                "SELECT meta FROM station_recordings WHERE dataset=? AND end<=? ORDER BY end DESC",
                (dataset, at),
            )
        ]
        excursions = []
        for event in frame["events"]:
            point = by_id[event["point"]]
            if (
                point["category"] != POWER_QUALITY
                or point["role"] != "电压有效值"
                or event["kind"] != "低限"
            ):
                continue
            until = event["end"] if event["end"] is not None else at
            minimum = db.execute(
                """SELECT MIN(val) FROM replay_samples WHERE dataset=? AND point=?
                    AND good=1 AND ts BETWEEN ? AND ?""",
                (dataset, point["id"], event["first_seen"], until),
            ).fetchone()[0]
            has_gap = any(
                e["point"] == point["id"]
                and e["kind"] == "数据质量"
                and e["start"] <= until
                and (e["end"] is None or e["end"] > event["first_seen"])
                for e in frame["events"]
            )
            excursions.append(
                dict(
                    point=point["id"],
                    first=event["first_seen"],
                    start=event["start"],
                    end=event["end"],
                    elapsed_ms=until - event["first_seen"],
                    minimum=minimum,
                    unit=point["unit"],
                    has_gap=has_gap,
                )
            )
    return dict(
        at=at,
        dataset=dataset,
        categories=categories,
        sequence=soe,
        actions=actions,
        recordings=files,
        voltage_excursions=excursions,
        rule_version=frame["rule_version"],
        diagnostics_version="2.0",
    )
