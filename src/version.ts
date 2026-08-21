/**
 * 版本信息（单一来源）
 *
 * 发布规则：功能/文档变更时同时递增以下版本号，并同步：
 *   - package.json 的 version 字段
 *   - SKILL.md 头部 frontmatter 的 version
 * agent 通过 ble_get_version 或 MCP initialize 的 serverInfo.version 感知更新，
 * 与本地缓存的版本对比，变化即应重新拉取 /skill/SKILL.md。
 */

/** MCP 服务版本（serverInfo.version 与 package.json 保持一致） */
export const MCP_VERSION = '1.0.0';

/** Skill 文档版本（与 SKILL.md 头部 version 标记保持一致） */
export const SKILL_VERSION = '1.0.0';

/** Skill 最近更新日期 */
export const SKILL_UPDATED_AT = '2026-08-21';

/** 最近一次版本的主要变更摘要（供 agent 判断是否需要更新） */
export const CHANGELOG: { version: string; date: string; summary: string }[] = [
  {
    version: '1.0.0',
    date: '2026-08-21',
    summary: 'Initial release: BLE cycling/fitness simulator (FTMS/power/cadence/HR) with MCP server, ride_script scenarios, hot updates, config presets, Web dashboard, Docker deploy',
  },
];
