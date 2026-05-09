#!/usr/bin/env python3
"""Gate.io 自动交易机器人（默认虚拟盘）。"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from typing import Any

import requests

BASE_URL = "https://api.gateio.ws/api/v4"


@dataclass
class BotConfig:
    api_key: str
    api_secret: str
    currency_pair: str = "BTC_USDT"
    quote_amount: float = 20.0
    poll_seconds: int = 30
    paper_trading: bool = True
    strategy: str = "sma_cross"
    short_window: int = 5
    long_window: int = 20
    rsi_period: int = 14
    rsi_buy_below: float = 30.0
    rsi_sell_above: float = 70.0


class GateClient:
    def __init__(self, api_key: str, api_secret: str) -> None:
        self.api_key = api_key
        self.api_secret = api_secret.encode()

    def _sign(self, method: str, path: str, query: str = "", body: str = "") -> dict[str, str]:
        ts = str(int(time.time()))
        body_hash = hashlib.sha512(body.encode()).hexdigest()
        payload = "\n".join([method, path, query, body_hash, ts])
        sign = hmac.new(self.api_secret, payload.encode(), hashlib.sha512).hexdigest()
        return {"KEY": self.api_key, "Timestamp": ts, "SIGN": sign, "Content-Type": "application/json"}

    def get_ticker(self, pair: str) -> float:
        path = f"/spot/tickers?currency_pair={pair}"
        r = requests.get(f"{BASE_URL}{path}", timeout=10)
        r.raise_for_status()
        return float(r.json()[0]["last"])

    def place_market_order(self, pair: str, side: str, amount: float) -> dict[str, Any]:
        path = "/spot/orders"
        body = json.dumps(
            {"currency_pair": pair, "type": "market", "side": side, "amount": str(amount), "time_in_force": "ioc"}
        )
        headers = self._sign("POST", path, "", body)
        r = requests.post(f"{BASE_URL}{path}", data=body, headers=headers, timeout=10)
        r.raise_for_status()
        return r.json()


class PaperWallet:
    def __init__(self, initial_usdt: float = 1000.0) -> None:
        self.usdt = initial_usdt
        self.base = 0.0
        self.last_price = 0.0

    def execute(self, side: str, quote_amount: float, price: float) -> str:
        self.last_price = price
        if side == "buy":
            spend = min(self.usdt, quote_amount)
            if spend <= 0:
                return "[PAPER] USDT 不足，跳过买入"
            qty = spend / price
            self.usdt -= spend
            self.base += qty
            return f"[PAPER] BUY {qty:.6f} @ {price:.4f}; usdt={self.usdt:.2f}, base={self.base:.6f}"

        if side == "sell":
            qty = min(self.base, quote_amount / price)
            if qty <= 0:
                return "[PAPER] 持仓不足，跳过卖出"
            received = qty * price
            self.base -= qty
            self.usdt += received
            return f"[PAPER] SELL {qty:.6f} @ {price:.4f}; usdt={self.usdt:.2f}, base={self.base:.6f}"

        return "[PAPER] 未知交易方向"


class IndicatorStrategy:
    def __init__(self, cfg: BotConfig) -> None:
        self.cfg = cfg
        self.position = "flat"
        self.prices: list[float] = []

    def _sma_signal(self) -> str | None:
        if self.cfg.short_window >= self.cfg.long_window:
            raise ValueError("GATE_SHORT_WINDOW 必须小于 GATE_LONG_WINDOW")
        if len(self.prices) < self.cfg.long_window:
            return None
        hist = self.prices[-self.cfg.long_window :]
        short_ma = sum(hist[-self.cfg.short_window :]) / self.cfg.short_window
        long_ma = sum(hist) / self.cfg.long_window
        if short_ma > long_ma and self.position != "long":
            self.position = "long"
            return "buy"
        if short_ma < long_ma and self.position != "flat":
            self.position = "flat"
            return "sell"
        return None

    def _rsi_signal(self) -> str | None:
        p = self.cfg.rsi_period
        if len(self.prices) < p + 1:
            return None
        changes = [self.prices[i] - self.prices[i - 1] for i in range(len(self.prices) - p, len(self.prices))]
        gains = sum(max(c, 0) for c in changes) / p
        losses = sum(max(-c, 0) for c in changes) / p
        if losses == 0:
            rsi = 100.0
        else:
            rs = gains / losses
            rsi = 100 - (100 / (1 + rs))

        if rsi <= self.cfg.rsi_buy_below and self.position != "long":
            self.position = "long"
            return "buy"
        if rsi >= self.cfg.rsi_sell_above and self.position != "flat":
            self.position = "flat"
            return "sell"
        return None

    def on_price(self, price: float) -> str | None:
        self.prices.append(price)
        if self.cfg.strategy == "sma_cross":
            return self._sma_signal()
        if self.cfg.strategy == "rsi":
            return self._rsi_signal()
        raise ValueError("GATE_STRATEGY 仅支持 sma_cross 或 rsi")


def load_config() -> BotConfig:
    api_key = os.getenv("GATE_API_KEY", "")
    api_secret = os.getenv("GATE_API_SECRET", "")
    if not api_key or not api_secret:
        raise RuntimeError("请设置 GATE_API_KEY 和 GATE_API_SECRET（即便纸上交易也会使用行情接口）")

    return BotConfig(
        api_key=api_key,
        api_secret=api_secret,
        currency_pair=os.getenv("GATE_PAIR", "BTC_USDT"),
        quote_amount=float(os.getenv("GATE_QUOTE_AMOUNT", "20")),
        poll_seconds=int(os.getenv("GATE_POLL_SECONDS", "30")),
        paper_trading=os.getenv("GATE_PAPER_TRADING", "true").lower() == "true",
        strategy=os.getenv("GATE_STRATEGY", "sma_cross").lower(),
        short_window=int(os.getenv("GATE_SHORT_WINDOW", "5")),
        long_window=int(os.getenv("GATE_LONG_WINDOW", "20")),
        rsi_period=int(os.getenv("GATE_RSI_PERIOD", "14")),
        rsi_buy_below=float(os.getenv("GATE_RSI_BUY_BELOW", "30")),
        rsi_sell_above=float(os.getenv("GATE_RSI_SELL_ABOVE", "70")),
    )


def main() -> None:
    cfg = load_config()
    client = GateClient(cfg.api_key, cfg.api_secret)
    strategy = IndicatorStrategy(cfg)
    wallet = PaperWallet()

    mode = "PAPER" if cfg.paper_trading else "LIVE"
    print(f"启动机器人: pair={cfg.currency_pair}, mode={mode}, strategy={cfg.strategy}")
    while True:
        try:
            price = client.get_ticker(cfg.currency_pair)
            signal = strategy.on_price(price)
            print(f"price={price:.4f}, signal={signal}")

            if signal:
                if cfg.paper_trading:
                    print(wallet.execute(signal, cfg.quote_amount, price))
                else:
                    result = client.place_market_order(cfg.currency_pair, signal, cfg.quote_amount)
                    print("[LIVE] order result:", result)
        except Exception as exc:  # noqa: BLE001
            print("发生错误:", exc)

        time.sleep(cfg.poll_seconds)


if __name__ == "__main__":
    main()
