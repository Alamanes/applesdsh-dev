# dsh-agent-room

右侧边栏里的多角色群聊。说一句话，房间里的角色按顺序接话，后说的看得到前面说的。

## 它是什么

- 一个 `sidebar.right.pane.tab`：跟文件、终端共用宿主右侧栏的 tab 条，不另开页面。
- 三个默认角色：Chief（主持）、Coder（工程）、Critic（审查），人设写在 `lib/index.js` 的 `DEFAULT_BOTS`。
- 每个角色一次独立的模型调用，串行发言，所以每句都建立在前面的对话上。
- 房间发言落盘在 `$DSH_HOME/storages/dsh-agent-room/room.json`，刷新页面不丢。

## 怎么用

安装后重启 DSH：

```sh
dsh plugin --profile desktop add "file:$PWD"
```

然后把 `dsh-agent-room` 加进 profile 的 `dsh.profile.bundles`。

会话 header 右侧会出现「群聊」按钮，点开就是右栏的房间；也可以从右栏的 + 里打开。

## 配置

| 字段 | 说明 |
| --- | --- |
| `provider` / `model` | 固定模型；留空则取第一个已挂载适配器的第一个模型 |
| `bots` | 整组替换角色，每项 `{ id, name, role, color, persona }` |

## 边界

实验版：没有 @ 定向、没有群记忆、没有成本统计。角色说两到三句，不展开长文。
