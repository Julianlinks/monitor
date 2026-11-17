# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

root = Path(SPECPATH)
datas = [(str(root / 'frontend' / 'dist'), 'frontend/dist'),
         (str(root / 'backend' / 'replay_sample'), 'replay_sample'),
         (str(root / 'LICENSE'), 'licenses/power-dashboard')]
for package in ('bms_alarm_triage', 'bms_triage_service', 'tzdata'):
    datas += collect_data_files(package)
for package in ('langgraph', 'langgraph-checkpoint', 'langchain-core', 'langsmith',
                'bms-alarm-triage-agent'):
    datas += copy_metadata(package)
hidden = ['uvicorn.protocols.http.h11_impl', 'uvicorn.protocols.websockets.websockets_impl',
          'uvicorn.lifespan.on', 'uvicorn.loops.asyncio', 'main', 'pymodbus.client']
hidden += collect_submodules('langgraph')
a = Analysis([str(root / 'backend' / 'desktop.py')], pathex=[str(root/'backend')],
             datas=datas, hiddenimports=hidden,
             excludes=['pytest', 'playwright', 'IPython', 'tkinter'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='Monitor', console=True, upx=False)
