<p align="center"><img src="./icon.png" width="96" alt=""></p>

<h1 align="center">备忘录</h1>

<p align="center">DSH 右侧边栏的一本本地备忘录：清单、目标，和一本由模型代笔的日记。</p>

## 功能

- **清单**：一条待办是标题加可选备注、可选步骤。双击标题改字，备注里放材料、条件、链接；底部输入框回车即添加。
- **目标**：一句话，外加一句可选的衡量标准，时间这类条件直接写进去。卡片里有进度时间线和最近一次复盘，四个图标按钮分别是复盘、记进度、完成、删除。
- **日记**：在目标页写一句今天做了什么，模型用第一人称整理成一页。正文只读，可以按日期翻看。
- **复盘**：读取目标立下以来的全部日记，按选定口吻写一段点评。口吻有四种：毒舌、温柔、机械、自定义。
- **本地**：数据存在 `~/.dsh/storages/dsh-memo`，没有联网与上传。

## 安装

在 profile 的 `package.json` 里加依赖并登记 bundle：

```json
{
  "dependencies": {
    "dsh-sidebar-memo": "github:Alamanes/applesdsh-dev#path:plugins/dsh-sidebar-memo"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-sidebar-memo"]
    }
  }
}
```

然后在 profile 目录安装并重启：

```sh
cd "$DSH_PROFILE_DIR"
pnpm install
```

本地开发时把依赖换成 `file:/absolute/path/to/plugins/dsh-sidebar-memo`，改完重新安装即可。

## 使用

### 清单

输入框写一行，回车添加。双击标题改字；备注块里点铅笔编辑，勾保存。有备注的条目会在副行显示键名摘要，步骤显示完成数。

### 目标

第二个页签。没有目标时直接显示新建表单；已有目标时，卡片下方的 ＋ 打开新表单。

- 刷新：读日记，写复盘
- ＋：记一笔进度
- 勾：标记完成
- ×：删除

复盘口吻在右上角齿轮里改。毒舌只针对进度和行为，不碰外貌、家人和人的价值。

### 日记

目标页底部。输入一句，回车或点 ＋，模型整理后写入当天的页。

写失败时，日记标题右侧出现刷新按钮，素材保留在本地，点一下重试。

## 数据

| 路径 | 内容 |
| --- | --- |
| `todos.json` | 清单 |
| `goals.json` | 目标、进度、复盘 |
| `settings.json` | 复盘口吻 |
| `diary/YYYY-MM-DD.md` | 模型写好的日记 |
| `raw/YYYY-MM-DD.md` | 你口述的素材 |

目录可以用插件配置项的 `dataDir` 改。

## 开发

```text
src/index.js          宿主：系统提示段、工具、面板路由、两笔后台写作
src/host/store.js     清单 / 目标 / 日记 / 素材的文件存储
src/host/tools.js     memo 与 diary 工具
src/host/scribe.js    日记代笔与目标复盘的提示词
src/host/model.js     一次性模型调用：当前模型、最低思考档、不设输出上限
lib/client.js         浏览器半边：右侧边栏标签类型与面板
lib/memo.css          面板样式，由 api/dsh-memo/style 提供
locale/zh.json        插件列表的中文名与描述
locale/en.json        英文基准
```

宿主和前端改动都需要重启 DSH 才会生效。

## 工具

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `memo` | `op`、`text`、`note`、`steps`、`id`、`goal` | 清单；`goal` 是嵌套的目标操作 |
| `diary` | `op`、`date`、`from`、`to`、`text`、`mode` | 按天读写日记 |

`memo.goal` 记用户自己立下的目标，与会话的 Goal 工具不是一回事：

| 字段 | 说明 |
| --- | --- |
| `op` | `set` / `log` / `review` / `done` / `drop` |
| `id` | 目标 ID，省略时作用于最新的未完成目标 |
| `text` / `note` | 目标本身与衡量标准 |
| `log` / `review` | 一条进度，或一段点评 |

## 许可

MIT
