/**
 * BLE Simulator MCP Service — 入口
 *
 * 传输模式由环境变量控制：
 *   MCP_TRANSPORT=stdio   标准输入/输出（默认，适合本地 MCP 客户端）
 *   MCP_TRANSPORT=http    HTTP 端口监听，供远端 agent 访问
  *   MCP_PORT=3300         HTTP 模式监听端口（默认 3300）
 *   MCP_HOST=0.0.0.0      HTTP 模式监听地址（默认 0.0.0.0）
 *   SIM_SERIAL_STABLE=1   同设备类型会话序列号稳定（App 免忘记设备无缝重连）；
 *                         默认未设置：每次会话序列号带 -S<id> 后缀强制重新发现
 */

import { BleController } from './ble-controller';
import { SimulatorDatabase } from './database';
import { startMcpServer } from './mcp-server';

async function main(): Promise<void> {
  const db = new SimulatorDatabase();
  const controller = new BleController();
  controller.setDatabase(db);

  const transportMode = (process.env['MCP_TRANSPORT'] ?? 'stdio') as 'stdio' | 'http';
  const port = parseInt(process.env['MCP_PORT'] ?? '3300', 10);
  const host = process.env['MCP_HOST'] ?? '0.0.0.0';

  const shutdown = async (signal: string): Promise<void> => {
    console.error(`\n[Main] ${signal} received, shutting down...`);
    if (controller.isRunning) {
      try {
        const status = controller.getStatus();
        if (status.sessionId !== null) db.stopSession(status.sessionId);
        await controller.stop();
      } catch (err) {
        console.error('[Main] Error stopping BLE controller:', err);
      }
    }
    db.close();
    process.exit(0);
  };

  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

  await startMcpServer(controller, db, { transport: transportMode, port, host });
}

main().catch((err: unknown) => {
  console.error('[Main] Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
