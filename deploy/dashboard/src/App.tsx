import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { mcpCall } from '@/lib/api';
import { StatusTab } from '@/components/StatusTab';
import { ControlTab } from '@/components/ControlTab';
import { TemplatesTab } from '@/components/TemplatesTab';
import { RulesTab } from '@/components/RulesTab';
import { SessionsTab } from '@/components/SessionsTab';
import { ConfigsTab } from '@/components/ConfigsTab';
import { LogSidePanel } from '@/components/LogSidePanel';

export default function App() {
  const [online, setOnline] = useState(true);
  const [deviceState, setDeviceState] = useState('—');

  const poll = async () => {
    try {
      const text = await mcpCall('ble_status');
      const m = text.match(/^状态:\s*(\S+)/m);
      setDeviceState(m ? m[1] : '—');
      setOnline(true);
    } catch { setOnline(false); }
  };
  useEffect(() => { poll(); const t = setInterval(poll, 3000); return () => clearInterval(t); }, []);

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-6 pt-4">
      <header className="mb-3 flex items-center gap-3">
        <span className={online ? 'inline-block h-2.5 w-2.5 rounded-full bg-green-500 shadow-[0_0_0_3px_rgba(22,163,74,0.15)]' : 'inline-block h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]'} />
        <h1 className="text-lg font-bold tracking-tight">BLE Simulator</h1>
        <Badge variant={online ? 'success' : 'danger'}>{online ? 'MCP 在线' : 'MCP 离线'}</Badge>
        <Badge variant={deviceState === 'running' ? 'success' : 'secondary'}>
          {deviceState === 'running' ? '模拟运行中' : deviceState === 'stopped' ? '模拟已停止' : deviceState === '—' ? '模拟 —' : '模拟 ' + deviceState}
        </Badge>
      </header>

      <Tabs defaultValue="status" className="w-full">
        <TabsList className="mb-3 flex w-full justify-start overflow-x-auto">
          <TabsTrigger value="status">状态</TabsTrigger>
          <TabsTrigger value="control">模拟控制</TabsTrigger>
          <TabsTrigger value="configs">配置列表</TabsTrigger>
          <TabsTrigger value="templates">快捷模板</TabsTrigger>
          <TabsTrigger value="rules">交互规则</TabsTrigger>
          <TabsTrigger value="sessions">会话</TabsTrigger>
        </TabsList>
        <TabsContent value="status"><StatusTab /></TabsContent>
        <TabsContent value="control"><ControlTab deviceState={deviceState} /></TabsContent>
        <TabsContent value="configs"><ConfigsTab /></TabsContent>
        <TabsContent value="templates"><TemplatesTab /></TabsContent>
        <TabsContent value="rules"><RulesTab /></TabsContent>
        <TabsContent value="sessions"><SessionsTab /></TabsContent>
      </Tabs>

      <footer className="mt-5 text-center text-xs text-muted-foreground">
        MCP 端点 <a className="font-medium text-foreground underline underline-offset-2" href="/mcp" target="_blank">/mcp</a> ·
        Skill 文档 <a className="font-medium text-foreground underline underline-offset-2" href="/skill/SKILL.md" target="_blank">/skill/SKILL.md</a> ·
        <a className="font-medium text-foreground underline underline-offset-2" href="/help" target="_blank"> 使用说明</a> ·
        状态每 3 秒自动刷新
      </footer>

      <LogSidePanel />
    </div>
  );
}
