# Modules — 總覽

> 狀態：優化中 / Tuning。API 已穩定；預設值跟人因設計還在隨著真實 app 試跑微調。文案跟預設值的變動會比函式 signature 多。

dddk **module** 是 opt-in、可 attach 的功能包，給 `DotDotDuck` instance 加一個功能，但不動 orchestrator。每個 module 都長同一個樣：

```ts
import { SomeModule } from '@perhapxin/dddk';

const m = new SomeModule({ /* config */ });
m.attachTo(dddk);

// 多半是 runtime 切換用的：
m.setEnabled(false);
m.destroy();
```

這個 pattern（不是把所有東西塞進 `new DotDotDuck({ inline: true, dwell: true, ... })`）是刻意的：

- **獨立開關。** Host 只 ship 用得到的 module；其他被 tree-shake 掉。
- **自管 lifecycle。** 每個 module 自己接 listener、mount DOM、自己拆。Orchestrator 不用知道。
- **可替換。** Host 想做自家 InlineAgent UI 就寫一個對 `DotDotDuck` 同樣 API 的 sibling module，dddk 其他部分不受影響。

Module **不同於** [triggers](../triggers/overview.md)（palette、Spotter、手勢 — 永遠存在，由 orchestrator 接線）跟 [skills](../skills/overview.md)（host 自己定義的 agent 任務）。Module 夾在中間：內建功能，host 自己從菜單裡挑。

## 命名公約:import 跟顯示用不同形式

每個 module 在不同 context 會看到不同寫法:

- **Class 名稱**(你 `import` 用的): PascalCase — `ImmersiveTranslate`、`VoiceModule`、`InlineAgent`、`Dwell`。
- **Palette 指令 / 文件檔名**: kebab-case — `/immersive-translate`、`voice`、`dwell`、`inline-agent`。

文章裡寫「dwell 模組」、`new Dwell(...)`、`/dwell` 指的是同一件事 — 三個不同視角而已。下表「Class」欄是 canonical 的 import 名稱,其他都是顯示時的別名。

## 目前的 module 清單

| 檔案 | Class | 一句話 |
| --- | --- | --- |
| [voice](./voice.md) | `VoiceModule` | 長按空白鍵 STT、可選 TTS、語音 cleanup LLM pass。 |
| [subtitle](./subtitle.md) | `Subtitle` | 底部 prompt bar — agent 旁白、語音狀態、accept / reject。 |
| [dwell](./dwell.md) | `Dwell` | 長按鎖定 DOM 元素，作為下一個互動的 context。 |
| [inline-agent](./inline-agent.md) | `InlineAgent` | `<input>` / `<textarea>` / contenteditable 裡的浮動選單。 |
| [immersive-translate](./immersive-translate.md) | `ImmersiveTranslate` | 整頁雙語渲染。 |
| [agent-cursor](./agent-cursor.md) | `AgentCursor` | agent 操作時看得見的大游標 + 點擊前停頓。 |
| [mobile-trigger](./mobile-trigger.md) | `MobileTrigger` | 觸控裝置的 FAB + 上下滑 chrome bar。 |
| [form-assist](./form-assist.md) | `FormAssistModule` | 偵測到的每個 `<form>` 旁邊放「AI 幫填」按鈕。 |
| [onboarding](./onboarding.md) | `OnboardingModule` | 首次造訪自動跑 `ScriptSkill`，含「看過」旗標。 |
| [theme-language](./theme-language.md) | `ThemeToggleModule` + `LanguageSwitcherModule` | 兩個小工具 module — palette 指令給主題跟語言。 |

## 跨 tab session 同步

不是 module — 是 `DotDotDuck` 的 config flag。會列在這裡是因為它是功能開關，歷史上也在這份文件裡：

```ts
new DotDotDuck({
  llm,
  webAgent: { crossTabSync: true },   // 預設 false
});
```

設成 `true` 時 agent session 會 mirror 到 `localStorage` 並用 `BroadcastChannel` 廣播。同 origin 開新 tab 就能接著前一個的進度。只限同 origin — 看 [agent / session-continuity](../agent/session-continuity.md)。

## Tear-down

你的 app unmount 時（離開頁面、host SPA route 切換） — 一定要：

```ts
dotdotduck.destroy();
// + 任何你 instantiate 的 module:
voice.destroy();
dwell.destroy();
inline.destroy();
immersive.disable();          // 移除注入的譯文
agentCursor.destroy();
mobile.destroy();
```

之後沒 `destroy` 就再 call 一次 `mount()` 會讓 listener 綁兩份。
