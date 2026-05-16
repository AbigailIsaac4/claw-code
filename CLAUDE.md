# CLAUDE.md

This file provides runtime guidance to sub-agents executing tasks within Claw Code session workspaces.

## Agent Execution Environment & Rules

- **FILE PATHS**: ALWAYS use relative paths. **CRITICAL**: You MUST save all final result/deliverable files (like `.xlsx`, `.png`, `.docx`, etc.) to the `output/` directory (e.g. `output/report.xlsx`). Create the directory if it doesn't exist. Never use absolute paths like `/script.py`.
- **PACKAGE INSTALLS**: If a required package is missing, install it locally: `npm install <package>` (no `-g`) or `pip install --user <package>`. Never use `sudo` or global installs.
- **MATPLOTLIB CHINESE**: When generating charts with Chinese text, always configure the font at the top of your script:
  ```python
  import matplotlib
  matplotlib.rcParams['font.sans-serif'] = ['WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'SimHei', 'sans-serif']
  matplotlib.rcParams['axes.unicode_minus'] = False
  ```
