"""Derive indicators from simultaneous fundamental phasors or harmonic RMS values."""

import cmath
import math
from collections import defaultdict

from station_profiles import HARMONIC, POWER_QUALITY


def negative_sequence(values):
    magnitudes, angles = values[::2], values[1::2]
    if min(magnitudes) < 0:
        return None
    va, vb, vc = [cmath.rect(mag, math.radians(angle)) for mag, angle in zip(magnitudes, angles)]
    a = cmath.rect(1, 2 * math.pi / 3)
    positive = abs(va + a * vb + a * a * vc)
    if positive <= max(magnitudes) * 1e-12:
        return None
    return 100 * abs(va + a * a * vb + a * vc) / positive


def harmonic_ratio(values):
    if values[0] <= 0 or min(values[1:]) < 0:
        return None
    return 100 * math.hypot(*values[1:]) / values[0]


def add_derived(specs, samples):
    groups = defaultdict(dict)
    for p in specs.values():
        if p["category"] == POWER_QUALITY and p["role"]:
            groups[p["group"]][p["role"]] = p

    def derive(inputs, suffix, name, method, calc):
        first = inputs[0]
        pid = f"CALC.{first['id']}.{suffix}"
        if pid in specs:
            raise ValueError(f"计算测点 {pid} 与导入位号冲突")
        limit = first.get("metric_limit")
        timeouts = [p["timeout"] for p in inputs if p["mode"] == "周期"]
        specs[pid] = {
            **first,
            "id": pid,
            "name": name,
            "role": "计算指标",
            "unit": "%",
            "rule": "高限" if limit is not None else "无",
            "trigger": limit,
            "clear": limit,
            "mode": "周期" if timeouts else "变位",
            "timeout": min(timeouts, default=0),
            "delay": 0,
            "nominal": None,
            "method": method,
            "inputs": [p["id"] for p in inputs],
        }
        sources = [samples.get(p["id"], {}) for p in inputs]
        series = {}
        for ts in set().union(*sources):
            readings = [s.get(ts, (None, False)) for s in sources]
            value = calc([r[0] for r in readings]) if all(r[1] for r in readings) else None
            valid = value is not None and math.isfinite(value)
            series[ts] = (value if valid else None, valid)
        samples[pid] = series

    for mapped in groups.values():
        harmonics = sorted((int(r[1:]), p) for r, p in mapped.items() if HARMONIC.fullmatch(r))
        if len(harmonics) > 1 and harmonics[0][0] == 1:
            orders = [h for h, _ in harmonics[1:]]
            name = "电压 THD（2–50 次）" if orders == list(range(2, 51)) else "已测阶次电压畸变率"
            derive(
                [p for _, p in harmonics],
                "HD",
                name,
                "所配 "
                + "、".join(map(str, orders))
                + " 次谐波有效值的平方和开根，除以同刻基波有效值。",
                harmonic_ratio,
            )
        roles = [f"{phase}相基波{part}" for phase in "ABC" for part in ("幅值", "相角")]
        if all(r in mapped for r in roles):
            derive(
                [mapped[r] for r in roles],
                "U2",
                "负序电压不平衡度",
                "用同刻 ABC 三相基波相量计算负序与正序电压幅值之比。",
                negative_sequence,
            )
