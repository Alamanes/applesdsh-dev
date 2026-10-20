# dsh-codex-reasoning-effort-slider

> **Vendored into [applesdsh-dev](https://github.com/Alamanes/applesdsh-dev) at `plugins/dsh-codex-reasoning-effort-slider`**
> from [bakabaicai/DSH-Codex-reasoning-effort-slider](https://github.com/bakabaicai/DSH-Codex-reasoning-effort-slider),
> which remains the upstream. The package name and the client module id were renamed from
> `@local/dsh-codex-reasoning-effort-slider` to `dsh-codex-reasoning-effort-slider`, the exact
> `peerDependencies` pin on `@deepseek-ai/dsh` became a range in `engines`, and the hardcoded
> Codex level set was widened to every pi-ai thinking level so the slider no longer drops
> levels the host reports.

**Codex 风格推理强度滑块**，1:1 复刻 Codex 桌面版的推理深度调节：点开会话输入栏下方的模型名称，弹层里出现滑块，拖动即可切换该模型的推理档位。

| Codex 原版 | 本插件 |
| :---: | :---: |
| ![Codex 原版](gif/Codex.gif) | ![本插件](gif/Deepseek%20Harness.gif) |

## 安装

本仓库以 GitHub 子目录说明符作为更新源，登记进 profile 的 `package.json`：

```json
{
  "dependencies": {
    "dsh-codex-reasoning-effort-slider": "github:Alamanes/applesdsh-dev#path:plugins/dsh-codex-reasoning-effort-slider"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-codex-reasoning-effort-slider"]
    }
  }
}
```

改完仓库推上去后，在 profile 目录重跑 `pnpm install` 即取到新版本。

也可以直接在 Harness 的 **插件 → 添加插件** 里粘贴本仓库地址，装完点 **立即启用**，按提示重启 Harness。

## 功能

- 滑块嵌在模型选择器弹层里：档位跟随宿主上报的等级渲染，可以是 pi-ai 的全等级 Off / Minimal / Low / Medium / High / Xhigh / Ultra，Ultra 对应 DeepSeek 的 `max` 推理等级
- 最高档带紫色渐变、细小闪点与粒子动画，圆形手柄与胶囊轨道按 Codex 桌面版的尺寸复刻
- Fast（1.5 倍速）开关，弹层内同时提供模型切换
- 键盘操作：←/→ 或 ↑/↓ 切换档位，滚轮同样可切换
- 切换模型时自动携带当前档位；目标模型不支持该档位时回退到默认档位
- 中英双语，跟随宿主语言；仅做客户端渲染，不发网络请求

Fast 模式只改变视觉动画，不会让模型加速，也不改变实际用量。

## 卸载

在 **插件** 页面关闭或卸载本插件，或从 profile 的 `package.json` 里去掉这一行后重跑 `pnpm install`。

## 来源与许可

MIT，版权归上游作者所有。代码取自上游仓库主分支，除包名、客户端模块 id、引擎声明，以及档位白名单由 Codex 四档扩宽为 pi-ai 全等级外，未作改动。
上游 README 更完整，包含 Windows 11 上的测试记录与更细的安装步骤。
