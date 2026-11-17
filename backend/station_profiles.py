"""Optional professional metadata on station point sheets. Legacy sheets stay valid."""

import math
import re

CATEGORIES = {
    "高压设备": {"触头温度": "模拟量", "负载率": "模拟量", "局放幅值": "模拟量", "断路器位置": "开关量"},
    "继电保护及安全自动装置": {
        "保护动作": "开关量",
        "安自动作": "开关量",
        "动作反馈": "开关量",
        "装置自检": "开关量",
    },
    "监控系统": {"采集心跳": "模拟量", "链路故障": "开关量", "服务故障": "开关量"},
    "电力系统动态记录装置": {"录波器心跳": "模拟量", "对时异常": "开关量", "存储告警": "开关量"},
    "电能质量监测系统": {
        "电压有效值": "模拟量",
        "频率": "模拟量",
        "仪表故障": "开关量",
        **{f"{p}相基波幅值": "模拟量" for p in "ABC"},
        **{f"{p}相基波相角": "模拟量" for p in "ABC"},
    },
    "站用电源系统": {
        "母线电压": "模拟量",
        "充电机故障": "开关量",
        "电池电压": "模拟量",
        "UPS旁路": "开关量",
    },
    "辅助设施": {"环境温度": "模拟量", "环境湿度": "模拟量", "水浸信号": "开关量", "风机故障": "开关量"},
}
POWER_QUALITY = "电能质量监测系统"
PROTECTION = "继电保护及安全自动装置"
RECORDER = "电力系统动态记录装置"
HARMONIC = re.compile(r"H([1-9]|[1-4][0-9]|50)")


def metadata(row, prefix):
    category, role = row.get("设备类别", ""), row.get("信号角色", "")
    group = row.get("关联组", "") or row["设备"]
    if category and category not in CATEGORIES:
        raise ValueError(f"{prefix}设备类别无法识别")
    harmonic = category == POWER_QUALITY and HARMONIC.fullmatch(role)
    required = "模拟量" if harmonic else CATEGORIES.get(category, {}).get(role)
    if role and required != row["类型"]:
        raise ValueError(f"{prefix}信号角色与设备类别或测点类型不符")
    if category == POWER_QUALITY and role:
        unit = row.get("单位", "")
        if (harmonic or "幅值" in role or role == "电压有效值") and unit != "V":
            raise ValueError(f"{prefix}参与计算的电压须以 V 表示")
        if "相角" in role and unit != "°":
            raise ValueError(f"{prefix}相角须以 ° 表示")
    deadline = row.get("反馈时限毫秒", "")
    if role in ("保护动作", "安自动作"):
        try:
            deadline = int(deadline)
            if deadline <= 0:
                raise ValueError()
        except ValueError:
            raise ValueError(f"{prefix}动作点必须配置正整数反馈时限（毫秒）")
    elif deadline:
        raise ValueError(f"{prefix}反馈时限只适用于动作点")
    nominal = row.get("额定值", "")
    if nominal:
        try:
            nominal = float(nominal)
            if not math.isfinite(nominal) or nominal <= 0:
                raise ValueError()
        except ValueError:
            raise ValueError(f"{prefix}额定值必须为正数")
    metric_limit = row.get("指标限值%", "")
    if metric_limit:
        try:
            metric_limit = float(metric_limit)
            if role not in ("H1", "A相基波幅值") or not math.isfinite(metric_limit) or metric_limit <= 0:
                raise ValueError()
        except ValueError:
            raise ValueError(f"{prefix}指标限值须为正数，且配置在 H1 或 A 相基波幅值上")
    return dict(
        metric_limit=metric_limit or None,
        category=category or "未分类",
        role=role,
        group=group,
        nominal=nominal or None,
        deadline_ms=deadline or None,
    )


def check_groups(specs):
    seen = set()
    for point in specs.values():
        if point["category"] not in (POWER_QUALITY, PROTECTION) or not point["role"]:
            continue
        key = (point["category"], point["group"], point["role"])
        if key in seen:
            raise ValueError(f"关联组 {point['group']} 的角色 {point['role']} 重复，请拆分关联组")
        seen.add(key)
