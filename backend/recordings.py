"""Offline COMTRADE attachment and channel inspection for completed records."""

import hashlib
import json
import math
import struct
from contextlib import closing
from pathlib import Path

import comtrade
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

import replay
from station_profiles import RECORDER

router = APIRouter(prefix="/api/diagnostics", tags=["动态记录"])
CFG_LIMIT = 1024 * 1024
DAT_LIMIT = 32 * 1024 * 1024
MAX_VALUES = 4_000_000


def parse(cfg_bytes, dat_bytes):
    try:
        try:
            text = cfg_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = cfg_bytes.decode("gb18030")
        lines = text.splitlines()
        total, analog, digital = lines[1].strip().upper().split(",")
        na, nd = int(analog.strip().removesuffix("A")), int(digital.strip().removesuffix("D"))
        if min(na, nd) < 0 or int(total) != na + nd or not 1 <= na + nd <= 256:
            replay.fail("通道数无效，单文件最多支持 256 个通道")
        if not 0 <= int(lines[3 + na + nd]) <= 128:
            replay.fail("采样率分段声明无效")
        cfg = comtrade.Cfg()
        cfg.read(text)
        if any(not all(math.isfinite(v) for v in (c.skew, c.a, c.b)) for c in cfg.analog_channels):
            replay.fail("通道增益、偏置或偏移无效")
        if not cfg.sample_rates:
            replay.fail("配置文件缺少采样段")
        count = cfg.sample_rates[-1][1]
        if count < 1 or count * (1 + na + nd) > MAX_VALUES:
            replay.fail("采样数量无效或超过本地查看器单文件上限")
        ft = cfg.ft.upper()
        if ft == "ASCII":
            rows = dat_bytes.decode("utf-8-sig").strip().rstrip("\x1a").strip().splitlines()
            if len(rows) != count or any(len(row.split(",")) != na + nd + 2 for row in rows):
                replay.fail("DAT 行数或列数与 CFG 不一致")
            if nd and any(
                any(v.strip() not in ("0", "1") for v in row.rsplit(",", nd)[1:]) for row in rows
            ):
                replay.fail("开关通道应为 0 或 1")
        elif ft in ("BINARY", "BINARY32", "FLOAT32"):
            width = 8 + na * (2 if ft == "BINARY" else 4) + 2 * math.ceil(nd / 16)
            if len(dat_bytes) != count * width:
                replay.fail("DAT 长度与 CFG 声明不符")
        else:
            replay.fail("不支持的 DAT 编码")
        record = comtrade.Comtrade(use_double_precision=True)
        record.read(text, dat_bytes)
        if any(
            not math.isfinite(t) or (i and t < record.time[i - 1]) for i, t in enumerate(record.time)
        ):
            replay.fail("录波采样时间无效或倒序")
        return record
    except (
        ValueError,
        TypeError,
        IndexError,
        OverflowError,
        ZeroDivisionError,
        OSError,
        StopIteration,
        struct.error,
        KeyError,
        comtrade.ComtradeError,
    ) as exc:
        raise HTTPException(422, "无法解析录波，请核对 CFG、DAT 的格式、时间和通道定义") from exc


def store(db, dataset, device, filename, cfg, dat):
    ds = db.execute("SELECT start,end FROM replay_sets WHERE id=?", (dataset,)).fetchone()
    if not ds:
        raise HTTPException(404, "批次不存在")
    points = (
        json.loads(row[0])
        for row in db.execute("SELECT spec FROM replay_points WHERE dataset=?", (dataset,))
    )
    if not any(p["device"] == device and p.get("category") == RECORDER for p in points):
        replay.fail("请选择本批次中已登记的动态记录装置")
    record = parse(cfg, dat)

    def epoch(utc_stamp, local_stamp):
        instant = utc_stamp or local_stamp.replace(tzinfo=replay.LOCAL_ZONE)
        return round(instant.timestamp() * 1000)

    start = epoch(record.start_timestamp_utc, record.start_timestamp)
    trigger = epoch(record.trigger_timestamp_utc, record.trigger_timestamp)
    skew = max([0.0] + [c.skew / 1e6 for c in record.cfg.analog_channels])
    end = max(trigger, math.ceil(start + (record.time[-1] + skew) * 1000))
    if not ds["start"] <= end <= ds["end"]:
        replay.fail("录波完成时刻超出批次范围，请核对时间、时区和采样批次")
    key = hashlib.sha256(cfg + b"\0" + dat).hexdigest()
    meta = dict(
        id=key,
        device=device,
        filename=filename,
        station=record.station_name,
        recorder=record.rec_dev_id,
        start=start,
        trigger=trigger,
        end=end,
        encoding=record.ft,
        samples=record.total_samples,
        analog=record.analog_count,
        digital=record.status_count,
        time_basis="CFG 时区" if record.start_timestamp_utc else "北京时间（CFG 未指定时区）",
    )
    db.execute(
        """INSERT OR IGNORE INTO station_recordings(dataset,device,id,end,meta,cfg,dat)
               VALUES(?,?,?,?,?,?,?)""",
        (dataset, device, key, end, json.dumps(meta, ensure_ascii=False), cfg, dat),
    )
    return json.loads(
        db.execute(
            "SELECT meta FROM station_recordings WHERE dataset=? AND device=? AND id=?",
            (dataset, device, key),
        ).fetchone()[0]
    )


@router.post("/{dataset}/recordings")
def upload(
    dataset: str, device: str = Form(...), config: UploadFile = File(...), data: UploadFile = File(...)
):
    cfg_name, dat_name = Path(config.filename or ""), Path(data.filename or "")
    if (cfg_name.suffix.lower(), dat_name.suffix.lower()) != (
        ".cfg",
        ".dat",
    ) or cfg_name.stem.casefold() != dat_name.stem.casefold():
        replay.fail("请选择同名的 .cfg 和 .dat 配对文件")
    cfg, dat = config.file.read(CFG_LIMIT + 1), data.file.read(DAT_LIMIT + 1)
    if len(cfg) > CFG_LIMIT or len(dat) > DAT_LIMIT:
        replay.fail("CFG 上限为 1 MiB，DAT 上限为 32 MiB")
    with closing(replay.connect()) as db, db:
        return store(db, dataset, device, cfg_name.name, cfg, dat)


@router.get("/{dataset}/recordings/{key}")
def waveform(dataset: str, key: str, device: str, at: int, channel: int = 0):
    with closing(replay.connect()) as db:
        row = db.execute(
            """SELECT * FROM station_recordings WHERE dataset=? AND device=? AND id=? AND end<=?""",
            (dataset, device, key, at),
        ).fetchone()
        if not row:
            raise HTTPException(404, "截至该时刻尚无这份完整录波")
    meta = json.loads(row["meta"])
    record = parse(row["cfg"], row["dat"])
    channels = [
        dict(name=c.name, unit=c.uu, kind="模拟量", skew_us=c.skew) for c in record.cfg.analog_channels
    ]
    channels.extend(
        dict(name=c.name, unit="", kind="开关量", skew_us=0) for c in record.cfg.status_channels
    )
    if not 0 <= channel < len(channels):
        replay.fail("通道序号超出范围")
    analog = channel < record.analog_count
    values = record.analog[channel] if analog else record.status[channel - record.analog_count]
    stride = max(1, math.ceil(len(values) / 550))
    indices = {0, len(values) - 1}
    for left in range(0, len(values), stride):
        block = range(left, min(left + stride, len(values)))
        valid = [i for i in block if math.isfinite(values[i])]
        if valid:
            indices.update((min(valid, key=values.__getitem__), max(valid, key=values.__getitem__)))
        if len(valid) != len(block):
            indices.add(next(i for i in block if not math.isfinite(values[i])))
    skew = channels[channel]["skew_us"] / 1000
    plot = [
        dict(
            ms=round(record.time[i] * 1000 + skew, 6),
            value=values[i] if math.isfinite(values[i]) else None,
        )
        for i in sorted(indices)
    ]
    finite = (v for v in values if math.isfinite(v))
    lo = min(finite, default=None)
    hi = max((v for v in values if math.isfinite(v)), default=None)
    return dict(
        meta=meta,
        channels=channels,
        channel=channel,
        plot=plot,
        minimum=lo,
        maximum=hi,
        trigger_ms=meta["trigger"] - meta["start"],
        decimated=stride > 1,
    )
