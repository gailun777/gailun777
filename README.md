# Gate.io 自动交易机器人（支持虚拟盘测试）

可以，用你的 Gate API 做**虚拟测试**，默认模式就是 `paper_trading=true`，不会发真实交易单。

## 你提的两个问题

- **可以做测试吗？** 可以。默认就是虚拟盘（Paper Trading），只用 API 拉行情，订单在本地钱包模拟。
- **可以根据个人指标吗？** 可以。当前支持：
  - `sma_cross`（均线交叉）
  - `rsi`（超买超卖）

## 快速开始

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

配置变量：

```bash
export GATE_API_KEY='你的key'
export GATE_API_SECRET='你的secret'
export GATE_PAPER_TRADING=true
export GATE_STRATEGY=sma_cross  # 或 rsi
python gate_bot.py
```

## 指标参数（按你的习惯改）

### SMA（均线交叉）

- `GATE_SHORT_WINDOW=5`
- `GATE_LONG_WINDOW=20`

### RSI

- `GATE_RSI_PERIOD=14`
- `GATE_RSI_BUY_BELOW=30`
- `GATE_RSI_SELL_ABOVE=70`

## 切换到实盘（谨慎）

```bash
export GATE_PAPER_TRADING=false
```

> 强烈建议先连续观察虚拟盘结果，再考虑极小资金实盘。
