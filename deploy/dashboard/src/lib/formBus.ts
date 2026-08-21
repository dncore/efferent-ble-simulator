/** 简易事件总线：模板「填入表单」→ 控制页表单状态 */
type Listener = (data: Record<string, unknown>) => void;

const listeners = new Set<Listener>();
let last: Record<string, unknown> | null = null;

export const formBus = {
  set(data: Record<string, unknown>) {
    last = data;
    listeners.forEach((l) => l(data));
  },
  subscribe(l: Listener) {
    listeners.add(l);
    if (last) l(last);
    return () => { listeners.delete(l); };
  },
};
