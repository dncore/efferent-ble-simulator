# 命名配置管理（保存/载入/列表/重命名/删除，上限 20）

> 设计日期：2026-08-20
> 目的：Dashboard / MCP 可将模拟参数保存为**命名配置**（多条、上限 20），
> 随时载入到表单复用；提供配置列表 tab 统一管理。

## What changed

**存储**（`database.ts`）：
- 新表 `saved_configs`（id/name/config_json/created_at/updated_at）
- 方法：`saveConfig`（上限 20 校验）、`listSavedConfigs`、`getSavedConfig`、
  `renameSavedConfig`、`deleteSavedConfig`、`countSavedConfigs`

**MCP 工具**（`mcp-server.ts`）新增 5 个：
- `ble_save_config` { name, config? } — 保存命名配置；config 缺省用当前/
  最近配置；超 20 条返回上限提示
- `ble_list_configs` — 列出（id/名称/设备类型/更新时间）
- `ble_get_config_detail` { id } — 完整 JSON
- `ble_rename_config` { id, name }
- `ble_delete_config` { id }

**Dashboard**（React + shadcn/ui）：
- 「模拟控制」页按钮重构：
  - **启动/停止合并为单个切换按钮**（按状态显示；停止需 AlertDialog 确认）
  - **重启**需 AlertDialog 确认
  - **保存配置**：Dialog 输入名称 → `ble_save_config`
  - **载入已保存**：Dialog 列出已保存配置 → 选择载入表单
  - 动态提示条：运行中「保存配置即热更新生效」/ 未运行「启动开始模拟」
- 新增「**配置列表**」tab：查看（JSON Dialog）/ 载入 / 重命名（Dialog）/
  删除（AlertDialog 确认），与载入弹窗同源（`ble_list_configs`）

## Key design decisions

1. **配置与会话分离**：`saved_configs` 是用户主动保存的命名预设；`sessions`
   是运行记录。两者独立，互不影响。
2. **上限 20**：常量 `SAVED_CONFIG_LIMIT=20`，保存时计数校验，超出明确报错。
3. **载入 = 填表单**：载入把配置填入表单（formBus），由用户决定「启动」或
   「保存配置」生效——与"参数修改需显式生效"的心智一致。

## Affected interfaces

- MCP 新增 5 个工具；`ble_get_config`（当前/最近配置）保持不变
- Dashboard 控制页按钮语义变化；新增「配置列表」tab

## Data layout changes

- 新表 `saved_configs`；`config_json` 存完整 SimulationConfig

## Backward compatibility

- 原有工具/会话逻辑不变；新表由 `migrate()` 幂等创建
- 未保存任何配置时列表返回空，行为友好
