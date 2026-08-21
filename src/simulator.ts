/**
 * 心率模拟器：产生接近真实运动时的心率变化曲线
 *
 * 算法：以基准心率为中心，加入低频趋势波动 + 高频随机噪声
 * 范围限制在 [baseHR - 30, baseHR + 50] 之间
 */
export class HeartRateSimulator {
  private current: number;
  private trend: number = 0;       // 缓慢趋势偏移 (-1 / 0 / +1)
  private trendTimer: number = 0;  // 当前趋势持续的 tick 数
  private base: number;

  constructor(baseHeartRate: number) {
    this.base = baseHeartRate;
    this.current = baseHeartRate;
  }

  /** 动态更新基准心率（不重置当前值，渐进靠拢） */
  updateBase(newBase: number): void {
    this.base = newBase;
    // 将当前值钳制到新范围内
    const min = Math.max(40, this.base - 30);
    const max = Math.min(220, this.base + 50);
    this.current = Math.round(Math.min(max, Math.max(min, this.current)));
  }

  /** 推进一个 tick，返回本次心率值 （0-255 uint8） */
  next(): number {
    // 每 20 次 tick 有机会改变趋势
    if (this.trendTimer <= 0) {
      const r = Math.random();
      if (r < 0.33) this.trend = 1;
      else if (r < 0.66) this.trend = -1;
      else this.trend = 0;
      this.trendTimer = 15 + Math.floor(Math.random() * 25); // 15-40 ticks
    }
    this.trendTimer--;

    // 每 tick 随机小幅跳动 ± [0, 2]
    const noise = Math.round((Math.random() - 0.5) * 4);
    this.current = this.current + this.trend * 0.3 + noise;

    // 限制范围
    const min = Math.max(40, this.base - 30);
    const max = Math.min(220, this.base + 50);
    this.current = Math.round(Math.min(max, Math.max(min, this.current)));

    return this.current;
  }

  get value(): number {
    return this.current;
  }

  get baseValue(): number {
    return this.base;
  }
}

/**
 * 电量模拟器：每 60s 缓慢消耗 1%
 */
export class BatterySimulator {
  private level: number;
  private tickCount: number = 0;
  private readonly ticksPerDrain: number;

  constructor(initialLevel: number, drainIntervalMs = 60_000, tickIntervalMs = 1000) {
    this.level = Math.min(100, Math.max(0, initialLevel));
    this.ticksPerDrain = Math.round(drainIntervalMs / tickIntervalMs);
  }

  /** 重置电量（例如用于配置更新后） */
  reset(newLevel: number): void {
    this.level = Math.min(100, Math.max(0, newLevel));
    this.tickCount = 0;
  }

  /** 推进一个 tick，返回当前电量（0-100） */
  next(): number {
    this.tickCount++;
    if (this.tickCount >= this.ticksPerDrain && this.level > 0) {
      this.level--;
      this.tickCount = 0;
    }
    return this.level;
  }

  get value(): number {
    return this.level;
  }
}
