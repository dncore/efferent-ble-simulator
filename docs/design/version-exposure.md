# 版本信息暴露（MCP serverInfo + ble_get_version + Skill 版本标记）

> 设计日期：2026-08-20
> 目的：让接入的 agent 能感知 MCP 服务与 Skill 文档的更新，对比本地缓存
> 版本号，变化即重新拉取 Skill。

## What changed

- 新增 `src/version.ts`（版本单一来源）：
  - `MCP_VERSION` / `SKILL_VERSION` / `SKILL_UPDATED_AT` / `CHANGELOG[]`
- MCP `initialize` 响应的 `serverInfo.version` 使用 `MCP_VERSION`（原硬编码 2.0.0）
- 新增工具 `ble_get_version`：返回 MCP 版本、Skill 版本+更新时间、Skill 下载
  地址（`SKILL_PUBLIC_URL` env，缺省返回相对路径）、最近变更摘要
- SKILL.md 头部 frontmatter 增加 `version` / `updated` 标记
- package.json version 对齐 2.1.0
- docker-compose mcp 服务透传 `SKILL_PUBLIC_URL`

## Key design decisions

1. **单一版本源**：`src/version.ts` 集中管理；发布时同步递增 version.ts、
   package.json、SKILL.md frontmatter（已在 CLAUDE.md 记录该约定——需补充）。
2. **两层感知**：
   - `serverInfo.version`（initialize）——MCP 客户端握手即知服务版本
   - `ble_get_version`（工具）——运行时查询，含 Skill 版本与下载地址
3. **更新检查协议**：agent 将版本号与其缓存对比；不一致 → 从
   `SKILL_PUBLIC_URL` 重新拉取 Skill。SKILL_PUBLIC_URL 由部署方配置
   （如 `http://<host>:3330/skill/SKILL.md`），未配置时返回相对路径。

## Affected interfaces

- MCP `initialize`：`serverInfo.version` = 2.1.0
- 新增 `ble_get_version` 工具
- SKILL.md frontmatter：新增 `version`/`updated`
- 环境变量 `SKILL_PUBLIC_URL`（可选）

## Data layout changes

- 无数据库/BLE 协议变化

## Backward compatibility

- 旧客户端不解析版本也能正常工作；新增字段均为增量
- `SKILL_PUBLIC_URL` 未设置时返回 `/skill/SKILL.md`，不影响现有调用
