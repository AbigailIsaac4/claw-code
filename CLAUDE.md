# CLAUDE.md

This file provides runtime guidance to sub-agents executing tasks within Claw Code session workspaces.

## Agent Execution Environment & Rules

- **FILE PATHS**: ALWAYS use relative paths. **CRITICAL**: Save all final result files to the `output/` directory (e.g. `output/report.xlsx`). Create it with `mkdir -p output` first. NEVER `cd` to `/tmp`, `/root`, `/home` or any absolute path.
- **FORBIDDEN**: NEVER use `apt-get`, `apt`, `yum`, `sudo`, or any system package manager. The sandbox has no root privileges — these commands will always fail.
- **PACKAGE INSTALLS**: If a Python/Node package is missing, install locally: `pip install --user <package>` or `npm install <package>`.
- **SYSTEM CLI TOOLS**: If a task requires a system-level CLI tool (pandoc, ffmpeg, etc.) that is NOT installed, do NOT attempt to install it. Use a pure Python alternative instead (e.g. `python-docx` for Word, `openpyxl` for Excel, `Pillow` for images, `reportlab`/`fpdf` for PDF).
- **MATPLOTLIB CHINESE**: When generating charts with Chinese text, always configure the font at the top of your script:
  ```python
  import matplotlib
  matplotlib.rcParams['font.sans-serif'] = ['WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'SimHei', 'sans-serif']
  matplotlib.rcParams['axes.unicode_minus'] = False
  ```
