# CLAUDE.md

This file provides runtime guidance to sub-agents executing tasks within Claw Code session workspaces.

## Agent Execution Environment & Rules

- **FILE PATHS**: ALWAYS use relative paths (`script.py`, `./output.xlsx`). NEVER write to absolute paths like `/script.py` — the sandbox does not allow writing to system root.
- **PACKAGE INSTALLS**: If a required package is missing, install it locally: `npm install <package>` (no `-g`) or `pip install --user <package>`. Never use `sudo` or global installs.
- **MATPLOTLIB CHINESE**: When generating charts with Chinese text, always configure the font at the top of your script:
  ```python
  import matplotlib
  matplotlib.rcParams['font.sans-serif'] = ['WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'SimHei', 'sans-serif']
  matplotlib.rcParams['axes.unicode_minus'] = False
  ```
