/**
 * 骑行动态模拟引擎
 *
 * 提供功率、踏频、速度的拟真模拟，模仿真人骑行时的自然波动。
 * 包含：PowerSimulator、CadenceSimulator、速度物理模型、场景状态机。
 */

import { CyclingSimulationConfig, RidingScenario, RidePhase, RidePhaseType, DEFAULT_RIDE_SCRIPT_PHASES } from './database';

// ─── Constants ───────────────────────────────────────────────────────────────

const GRAVITY = 9.80665;        // m/s²
const AIR_DENSITY = 1.225;      // kg/m³ at sea level

// ─── PowerSimulator ──────────────────────────────────────────────────────────

/**
 * 功率模拟器：围绕基准功率产生拟真波动
 *
 * 算法与 HeartRateSimulator 同源，但参数针对功率特性调优：
 * - 趋势周期更短（功率比心率反应更快）
 * - 噪声幅度更大（真人踩踏功率波动大于心率）
 * - 可选疲劳衰减
 */
export class PowerSimulator {
  private current: number;
  private trend: number = 0;
  private trendTimer: number = 0;
  private base: number;
  private effectiveBase: number;
  private readonly fatigueFactor: number;
  private tickCount: number = 0;
  private readonly tickIntervalMs: number;

  constructor(basePower: number, fatigueFactor = 0, tickIntervalMs = 1000) {
    this.base = basePower;
    this.effectiveBase = basePower;
    this.current = basePower;
    this.fatigueFactor = fatigueFactor;
    this.tickIntervalMs = tickIntervalMs;
  }

  updateBase(newBase: number): void {
    this.base = newBase;
    this.applyFatigue();
    const { min, max } = this.range();
    this.current = Math.round(Math.min(max, Math.max(min, this.current)));
  }

  next(): number {
    this.tickCount++;
    this.applyFatigue();

    // 趋势：每 10-30 tick 变向一次
    if (this.trendTimer <= 0) {
      const r = Math.random();
      if (r < 0.3) this.trend = 1;
      else if (r < 0.6) this.trend = -1;
      else this.trend = 0;
      this.trendTimer = 10 + Math.floor(Math.random() * 20);
    }
    this.trendTimer--;

    // 每 tick 随机噪声 ±5W
    const noise = Math.round((Math.random() - 0.5) * 10);
    this.current = this.current + this.trend * 0.5 + noise;

    // 范围限制
    const { min, max } = this.range();
    this.current = Math.round(Math.min(max, Math.max(min, this.current)));

    return this.current;
  }

  private applyFatigue(): void {
    if (this.fatigueFactor > 0) {
      const elapsedMinutes = (this.tickCount * this.tickIntervalMs) / 60_000;
      const fatigueMultiplier = Math.max(0.5, 1 - this.fatigueFactor * elapsedMinutes);
      this.effectiveBase = Math.round(this.base * fatigueMultiplier);
    } else {
      this.effectiveBase = this.base;
    }
  }

  private range(): { min: number; max: number } {
    return {
      min: Math.max(0, Math.round(this.effectiveBase * 0.7)),
      max: Math.round(this.effectiveBase * 1.4),
    };
  }

  get value(): number { return this.current; }
  get baseValue(): number { return this.base; }
}

// ─── CadenceSimulator ────────────────────────────────────────────────────────

/**
 * 踏频模拟器：围绕基准踏频产生拟真波动
 *
 * 特点：
 * - 比功率变化更平缓（趋势周期更长）
 * - 支持微停顿（模拟短暂滑行/换挡）
 * - 支持功率-踏频耦合
 */
export class CadenceSimulator {
  private current: number;
  private trend: number = 0;
  private trendTimer: number = 0;
  private base: number;
  private effectiveBase: number;
  private readonly microPauseProbability: number;
  private pauseTicksRemaining: number = 0;

  constructor(baseCadence: number, microPauseProbability = 0.005) {
    this.base = baseCadence;
    this.effectiveBase = baseCadence;
    this.current = baseCadence;
    this.microPauseProbability = microPauseProbability;
  }

  updateBase(newBase: number): void {
    this.base = newBase;
    this.effectiveBase = newBase;
    const { min, max } = this.range();
    this.current = Math.round(Math.min(max, Math.max(min, this.current)));
  }

  /**
   * 应用功率-踏频耦合
   * @param powerRatio 当前功率 / 基准功率
   * @param mode 耦合模式
   */
  applyCoupling(powerRatio: number, mode: 'proportional' | 'inverse' | 'independent'): void {
    if (mode === 'independent') {
      this.effectiveBase = this.base;
      return;
    }
    const deviation = powerRatio - 1;
    const couplingFactor = 0.3;
    if (mode === 'proportional') {
      // 功率↑ → 踏频微↑
      this.effectiveBase = this.base * (1 + deviation * couplingFactor);
    } else {
      // 功率↑ → 踏频微↓
      this.effectiveBase = this.base * (1 - deviation * couplingFactor);
    }
    this.effectiveBase = Math.round(Math.max(30, this.effectiveBase));
  }

  next(): number {
    // 微停顿处理
    if (this.pauseTicksRemaining > 0) {
      this.pauseTicksRemaining--;
      this.current = 0;
      return 0;
    }
    if (this.current > 0 && Math.random() < this.microPauseProbability) {
      this.pauseTicksRemaining = 2 + Math.floor(Math.random() * 3); // 2-4 ticks
      this.current = 0;
      return 0;
    }

    // 趋势：每 20-50 tick 变向一次
    if (this.trendTimer <= 0) {
      const r = Math.random();
      if (r < 0.3) this.trend = 1;
      else if (r < 0.6) this.trend = -1;
      else this.trend = 0;
      this.trendTimer = 20 + Math.floor(Math.random() * 30);
    }
    this.trendTimer--;

    // 每 tick 随机噪声 ±1 rpm
    const noise = Math.round((Math.random() - 0.5) * 2);
    this.current = this.current + this.trend * 0.2 + noise;

    // 范围限制（基于 effectiveBase，受耦合影响）
    const { min, max } = this.range();
    this.current = Math.round(Math.min(max, Math.max(min, this.current)));

    return this.current;
  }

  private range(): { min: number; max: number } {
    return {
      min: Math.max(0, Math.round(this.effectiveBase - 15)),
      max: Math.round(this.effectiveBase + 10),
    };
  }

  get value(): number { return this.current; }
  get baseValue(): number { return this.base; }
}

// ─── Speed physics model ─────────────────────────────────────────────────────

interface SpeedParams {
  riderWeightKg: number;
  bikeWeightKg: number;
  crr: number;
  cdA: number;
}

/**
 * 根据功率和坡度计算速度（牛顿迭代法）
 *
 * P = (Crr × m × g × cosθ + m × g × sinθ) × v + 0.5 × ρ × CdA × v³
 */
export function calculateSpeed(
  powerWatts: number,
  gradePercent: number,
  params: SpeedParams,
  windSpeedMs = 0,
): number {
  const m = params.riderWeightKg + params.bikeWeightKg;
  const theta = Math.atan(gradePercent / 100);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const fGravity = m * GRAVITY * sinT;
  const fRolling = params.crr * m * GRAVITY * cosT;
  const fLinear = fGravity + fRolling;

  // 牛顿迭代求解 v
  // f(v) = 0.5 * ρ * CdA * (v + w)² * v + fLinear * v - P = 0
  // f'(v) = 0.5 * ρ * CdA * (3v² + 4wv + w²) + fLinear

  let v = 5.0; // 初始猜测 5 m/s (~18 km/h)
  const rho = AIR_DENSITY;
  const cdA = params.cdA;
  const w = windSpeedMs;

  for (let i = 0; i < 10; i++) {
    const vw = v + w;
    const fv = 0.5 * rho * cdA * vw * vw * v + fLinear * v - powerWatts;
    const dfv = 0.5 * rho * cdA * (3 * v * v + 4 * w * v + w * w) + fLinear;

    if (Math.abs(dfv) < 1e-10) break;
    const vNext = v - fv / dfv;
    if (Math.abs(vNext - v) < 0.001) { v = vNext; break; }
    v = vNext;
  }

  // 负速度（极陡上坡 + 极低功率）→ 0
  v = Math.max(0, v);
  // 转 km/h，上限 120
  const speedKph = Math.min(120, v * 3.6);
  return Math.round(speedKph * 100) / 100;
}

// ─── CyclingSimulationEngine ─────────────────────────────────────────────────

export interface SimulationTick {
  power: number;
  cadence: number;
  speedKph: number;
}

/**
 * 骑行模拟引擎：协调功率、踏频、速度的动态模拟
 *
 * 管理场景状态机，驱动各子模拟器，并计算物理速度。
 */
export class CyclingSimulationEngine {
  private powerSim: PowerSimulator;
  private cadenceSim: CadenceSimulator;
  private config: CyclingSimulationConfig;
  private readonly initialBasePower: number;
  private readonly initialBaseCadence: number;
  private readonly tickIntervalMs: number;

  // 场景状态
  private tickCount = 0;
  private scenarioBasePower: number;
  private freerideNextShiftTick = 0;

  // 骑行剧本状态（ride_script 场景）
  private rideScript: Extract<RidingScenario, { type: 'ride_script' }> | null = null;
  private ridePhase: RidePhase | null = null;
  private ridePhaseIndex = 0;
  private ridePhaseTick = 0;
  private scriptGrade: number | null = null;
  private scriptStopped = false;
  private readonly ticksPerSecond: number;

  // 最近输出缓存
  private lastOutput: SimulationTick;

  constructor(
    basePower: number,
    baseCadence: number,
    config: CyclingSimulationConfig,
    tickIntervalMs = 1000,
  ) {
    this.config = config;
    this.initialBasePower = basePower;
    this.initialBaseCadence = baseCadence;
    this.scenarioBasePower = basePower;
    this.tickIntervalMs = tickIntervalMs;
    this.ticksPerSecond = 1000 / tickIntervalMs;

    this.powerSim = new PowerSimulator(basePower, config.fatigueFactor, tickIntervalMs);
    this.cadenceSim = new CadenceSimulator(baseCadence, config.microPauseProbability);
    this.lastOutput = { power: basePower, cadence: baseCadence, speedKph: 0 };

    this.initScenario();
  }

  /**
   * 推进一个 tick，返回当前功率、踏频、速度
   */
  next(gradePercent: number, windSpeedMs = 0): SimulationTick {
    this.tickCount++;

    // 1. 场景状态机更新功率基准
    this.advanceScenario();

    // 2. 功率模拟
    const power = this.powerSim.next();

    // 3. 功率→踏频耦合（骑行剧本 stop 阶段跳过）
    let cadence: number;
    if (this.scriptStopped) {
      cadence = 0;
    } else {
      const powerRatio = this.scenarioBasePower > 0 ? power / this.scenarioBasePower : 1;
      this.cadenceSim.applyCoupling(powerRatio, this.config.cadenceCoupling);
      cadence = this.cadenceSim.next();
    }

    // 4. 物理速度（踏频为 0 时功率也视为 0；ride_script 用剧本坡度）
    const effectivePower = cadence > 0 ? power : 0;
    const grade = this.scriptGrade ?? gradePercent;
    const speedKph = calculateSpeed(effectivePower, grade, {
      riderWeightKg: this.config.riderWeightKg,
      bikeWeightKg: this.config.bikeWeightKg,
      crr: this.config.crr,
      cdA: this.config.cdA,
    }, windSpeedMs);

    this.lastOutput = { power, cadence, speedKph };
    return this.lastOutput;
  }

  updateBasePower(watts: number): void {
    this.scenarioBasePower = watts;
    this.powerSim.updateBase(watts);
  }

  updateBaseCadence(rpm: number): void {
    this.cadenceSim.updateBase(rpm);
  }

  updateConfig(partial: Partial<CyclingSimulationConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.scenario) this.initScenario();
    if (partial.microPauseProbability !== undefined) {
      this.cadenceSim = new CadenceSimulator(
        this.cadenceSim.baseValue, partial.microPauseProbability,
      );
    }
  }

  /** 重置引擎状态（用于 FTMS Reset 等场景） */
  reset(): void {
    this.tickCount = 0;
    this.powerSim = new PowerSimulator(
      this.initialBasePower, this.config.fatigueFactor, this.tickIntervalMs,
    );
    this.cadenceSim = new CadenceSimulator(
      this.initialBaseCadence, this.config.microPauseProbability,
    );
    this.lastOutput = {
      power: this.initialBasePower,
      cadence: this.initialBaseCadence,
      speedKph: 0,
    };
    this.initScenario();
  }

  get currentPower(): number { return this.lastOutput.power; }
  get currentCadence(): number { return this.lastOutput.cadence; }
  get currentSpeed(): number { return this.lastOutput.speedKph; }
  /** 骑行剧本当前阶段坡度（非剧本场景返回 null） */
  get currentGrade(): number | null { return this.scriptGrade; }
  /** 骑行剧本当前阶段动作类型（非剧本场景返回 null） */
  get currentPhaseType(): RidePhaseType | null { return this.ridePhase?.type ?? null; }

  // ─── Scenario state machine ──────────────────────────────────────────────

  private initScenario(): void {
    const s = this.config.scenario;
    this.scenarioBasePower = this.initialBasePower;
    this.freerideNextShiftTick = 0;
    this.scriptGrade = null;
    this.scriptStopped = false;
    this.rideScript = null;
    this.ridePhase = null;
    this.ridePhaseIndex = 0;
    this.ridePhaseTick = 0;

    if (s.type === 'ride_script') {
      this.rideScript = s;
      const phases = this.rideScriptPhases();
      if (phases.length > 0) this.enterRidePhase(phases[0]);
      return;
    }

    if (s.type === 'warmup_main_cooldown') {
      // 热身阶段从 50% 开始
      this.scenarioBasePower = Math.round(this.initialBasePower * 0.5);
      this.powerSim.updateBase(this.scenarioBasePower);
    }
  }

  /** 骑行剧本阶段列表（未提供时使用默认剧本） */
  private rideScriptPhases(): RidePhase[] {
    const phases = this.rideScript?.phases;
    return phases && phases.length > 0 ? phases : DEFAULT_RIDE_SCRIPT_PHASES;
  }

  /** 进入骑行剧本的某个阶段 */
  private enterRidePhase(phase: RidePhase): void {
    this.ridePhase = phase;
    this.ridePhaseTick = 0;
    this.scriptGrade = phase.grade;
    this.scriptStopped = phase.type === 'stop';

    if (this.scriptStopped) {
      // 停车：功率/踏频归零
      this.powerSim.updateBase(0);
      this.cadenceSim.updateBase(0);
      return;
    }

    this.scenarioBasePower = phase.targetPower;
    this.powerSim.updateBase(phase.targetPower);
    if (phase.cadence !== undefined) this.cadenceSim.updateBase(phase.cadence);
  }

  private advanceScenario(): void {
    const s = this.config.scenario;
    const ticksPerSecond = 1000 / this.tickIntervalMs;

    switch (s.type) {
      case 'steady':
        // 无变化
        break;

      case 'intervals':
        this.advanceIntervals(s, ticksPerSecond);
        break;

      case 'warmup_main_cooldown':
        this.advanceWarmupMainCooldown(s, ticksPerSecond);
        break;

      case 'freeride':
        this.advanceFreeride();
        break;

      case 'ride_script':
        this.advanceRideScript();
        break;
    }
  }

  /** 骑行剧本：按阶段推进，阶段结束时切换下一个动作 */
  private advanceRideScript(): void {
    const phases = this.rideScriptPhases();
    if (phases.length === 0) return;

    const phase = phases[this.ridePhaseIndex];
    const phaseTicks = Math.max(1, Math.round(phase.durationSeconds * this.ticksPerSecond));

    this.ridePhaseTick++;
    if (this.ridePhaseTick < phaseTicks) return;

    // 阶段结束 → 下一个动作
    this.ridePhaseIndex++;
    if (this.ridePhaseIndex >= phases.length) {
      if (this.rideScript?.repeat) {
        this.ridePhaseIndex = 0;
      } else {
        // 无重复：停留在最后一个阶段（通常是 stop）
        this.ridePhaseIndex = phases.length - 1;
        return;
      }
    }
    this.enterRidePhase(phases[this.ridePhaseIndex]);
  }

  private advanceIntervals(
    s: Extract<RidingScenario, { type: 'intervals' }>,
    ticksPerSecond: number,
  ): void {
    const intervalTicks = Math.round(s.intervalSeconds * ticksPerSecond);
    const restTicks = Math.round(s.restSeconds * ticksPerSecond);
    const setTicks = intervalTicks + restTicks;
    const totalTicks = setTicks * s.sets;

    if (totalTicks <= 0) return;

    const t = this.tickCount % totalTicks;
    const setProgress = t % setTicks;

    let targetPower: number;
    if (setProgress < intervalTicks) {
      targetPower = Math.round(this.initialBasePower * s.highPowerFactor);
    } else {
      targetPower = Math.round(this.initialBasePower * s.lowPowerFactor);
    }

    if (targetPower !== this.scenarioBasePower) {
      this.scenarioBasePower = targetPower;
      this.powerSim.updateBase(targetPower);
    }
  }

  private advanceWarmupMainCooldown(
    s: Extract<RidingScenario, { type: 'warmup_main_cooldown' }>,
    ticksPerSecond: number,
  ): void {
    const warmupTicks = Math.round(s.warmupMinutes * 60 * ticksPerSecond);
    const mainTicks = Math.round(s.mainMinutes * 60 * ticksPerSecond);
    const cooldownTicks = Math.round(s.cooldownMinutes * 60 * ticksPerSecond);
    const totalTicks = warmupTicks + mainTicks + cooldownTicks;

    const t = Math.min(this.tickCount, totalTicks);
    let targetPower: number;

    if (t <= warmupTicks) {
      // 热身：50% → 100% 线性渐增
      const progress = warmupTicks > 0 ? t / warmupTicks : 1;
      targetPower = Math.round(this.initialBasePower * (0.5 + 0.5 * progress));
    } else if (t <= warmupTicks + mainTicks) {
      // 主课：按 mainPowerFactor
      targetPower = Math.round(this.initialBasePower * s.mainPowerFactor);
    } else {
      // 冷却：mainPowerFactor → 50% 线性递减
      const progress = cooldownTicks > 0 ? (t - warmupTicks - mainTicks) / cooldownTicks : 1;
      const from = s.mainPowerFactor;
      targetPower = Math.round(this.initialBasePower * (from - (from - 0.5) * progress));
    }

    if (targetPower !== this.scenarioBasePower) {
      this.scenarioBasePower = targetPower;
      this.powerSim.updateBase(targetPower);
    }
  }

  private advanceFreeride(): void {
    if (this.tickCount >= this.freerideNextShiftTick) {
      // 每 60-180 tick 随机偏移基准 ±20%
      const shift = 0.8 + Math.random() * 0.4; // 0.8 – 1.2
      const newBase = Math.round(this.initialBasePower * shift);
      this.scenarioBasePower = newBase;
      this.powerSim.updateBase(newBase);
      this.freerideNextShiftTick = this.tickCount + 60 + Math.floor(Math.random() * 120);
    }
  }
}
