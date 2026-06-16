# 從 0.1.1 升級到 0.1.2

**沒東西要改**。v0.1.2 是純 runtime bug fix — 沒有設定要動、沒有 API 要 rename、沒有 envelope 要改。

## 1. 升級套件

```bash
npm install @perhapxin/dddk@0.1.2
```

整個升級就這樣。所有 v0.1.1 host 設定繼續沿用。

## 2. 升級後 runtime 行為變化

按 Space 過完兩個 narrate 之間的 streaming pause hint 之後，subtitle bar 會先消失、立刻浮出 thinking pip、等下一段 narrate stream 進來時 pip 被新的 streaming bar 蓋掉。之前是 bar 殼留著但文字清空，下一輪 LLM call 那 1-3 秒（`gpt-5.4-nano` 的 TTFT）使用者會看到空 bar 然後以為 agent 壞了。詳細根因看 [release notes](./release-notes)。

## 3. 從 0.1.0 直接升上來

如果你完全跳過 0.1.1，先看 0.1.0 → 0.1.1 migration guide，那份才是真的有東西要動。0.1.1 → 0.1.2 這步疊上去等於沒事。
