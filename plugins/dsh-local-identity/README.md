# dsh-local-identity

DSH Web 界面左下角那个账号芯片（现在是你的 DeepSeek 账号名与头像）改成**本机配置的本地身份**，并在**设置 → 通用设置**里给它一行配置界面。

| 位置 | 处理 |
| --- | --- |
| 侧栏左下角账号芯片的名字 | 显示配置的昵称；没配时显示「未配置用户昵称」 |
| 侧栏左下角账号芯片的头像（24px 圆形） | 显示配置的头像；没配头像时用昵称首字占位，再没有就只剩中性圆底 |
| 折叠侧栏（只剩头像的 36×36 按钮） | 同上 |
| 设置 → 通用设置 →「本地身份」 | 昵称与头像的配置界面（两个输入框 + 圆形预览） |
| 设置页「账号」区、余额、UID、退出登录 | 完全不动 |
| 未登录时的「更多」行 | 不动（那行是入口，不是身份） |

## 配置

打开 **设置 → 通用设置**，最后一行就是「本地身份」：

- **昵称**：留空时芯片显示占位文案「未配置用户昵称」。输入框自身的 placeholder 也是这句。
- **头像**：留空表示没有头像。可填本机绝对路径、`~/` 开头的路径、相对家目录的路径、`http(s)` 地址或 `data:` URL。
- 两个输入框都在**失焦或回车**时提交；把内容清空再提交等于清除该值（回到未配置）。

值保存在 profile 的 `cordis.patch.yml` 里（`configEditor` 追加该行的 `config:`，文件里既有的注释与 `!!js` 表达式保留），所以重启、换会话都不丢，也可以直接在文件里改：

```yaml
- id: dsh-local-identity
  name: "dsh-local-identity"
  config:
    name: 你的昵称
    avatar: ~/Pictures/me.png
```

规则：

- 头像路径由插件的 host 半边读盘并走 `/dsh-local-identity/avatar` 下发，扩展名决定 `Content-Type`，扩展名不认识时按魔数判断（PNG / JPEG / GIF / WebP / AVIF / SVG）。GIF 动图照常动。
- 换掉同一路径下的头像文件后，URL 里的 mtime+size 版本号会变，页面在 30 秒内或刷新时自动换成新图。
- 头像文件读不到（路径错、不是文件、空文件、超过 16MB）时，芯片回退到首字占位，设置页那一行同时显示原因，不会给页面一个坏 URL。
- 昵称与头像都留空时，芯片显示「未配置用户昵称」和中性圆底——**不会退回账号自己的名字与头像**。

## 安装

profile 的 `package.json` 按此登记：

```json
"dependencies": {
  "dsh-local-identity": "github:Alamanes/applesdsh-dev#path:plugins/dsh-local-identity"
},
"dsh": {
  "profile": {
    "bundles": ["...", "dsh-local-identity"]
  }
}
```

再在该 profile 目录执行 `pnpm install` 装好 `node_modules`，重启 DSH（或经插件页启用该行）后生效。停用只需从 `bundles` 里删掉 `dsh-local-identity`。

**本地开发**用 `file:` 直接指到插件目录：

```json
"dependencies": {
  "dsh-local-identity": "file:/path/to/dsh-local-identity"
}
```

在 profile 目录 `pnpm add "dsh-local-identity@file:$HOME/.dsh/plugins/dsh-local-identity"` 完成第一次链接（`nodeLinker: hoisted` 下落成实体目录，不是软链）。之后改源码需要把实体文件复制进 profile：pnpm 对 `file:` 目录依赖只在链接那一步按硬链接复制一次，源码换 inode（多数编辑器保存都是写新文件再改名）时它不会自己跟上，`pnpm install` 对已存在的链接也是空操作。

```sh
cp -R ~/.dsh/plugins/dsh-local-identity/. ~/.dsh/profiles/desktop/node_modules/dsh-local-identity/
```

## 为什么长这样

**为什么身份走 HTTP 路由。** 浏览器侧的插件包是被 boot graph 以 `{ id, url, rev }` 行投放、再以 `{ name: id }` 建 Loader 条目挂载的，**config 不随行下发**——`apply(ctx, config)` 在浏览器半边永远拿到空对象（`dsh-client-modules` 的 `ClientEntries.create`）。配置只有 host 半边能看到，所以名字与头像由 host 读、由 `/dsh-local-identity/*` 两条 exact 路由发布给页面：

| 路由 | 内容 |
| --- | --- |
| `GET /dsh-local-identity/identity.json` | `{ ok, name, avatarUrl, avatarError }`，即 host 解析后的结果 |
| `GET /dsh-local-identity/avatar` | 头像文件字节，`Cache-Control: no-store` |

两条路由都只认 GET/HEAD、拒绝 `Sec-Fetch-Site: cross-site`，并优先委托宿主的浏览器信任栅栏（`connection.requestRejection`），该服务不可用时退回自带的回环 Host 校验。头像路径只来自配置，**任何请求都不能指定文件**，所以这两条路由不构成任意路径读取。

**为什么配置界面能读写。** host 半边的 `Config` 用 schemastery 声明了两个 `.volatile()` 字段：

```js
export const Config = Schema.object({
  name: Schema.string().volatile(),
  avatar: Schema.string().volatile(),
})
```

`dsh-settings` 会为每个「声明了 volatile 字段且在运行中的 profile 条目」投影一份表单（命名空间就是 loader 行 id `dsh-local-identity`），volatile 字段的改动由 loader 直接提交进正在运行的引用、不重挂插件；写盘走 `configEditor`，落到 profile patch。浏览器半边通过 `ctx.configForms.get('dsh-local-identity')` 读写这份表单：`getSnapshot().value` 取值，`set` / `unset(field, …)` 提交。因为 host 每次请求都重新读这两个引用，设置里保存后芯片下一次刷新即为新值。

**为什么改 DOM 而不是占槽位。** 芯片所在的 `settings.launcher` 是单占槽、占位者是官方 `AccountMenu`，注册进去等于把整个菜单（含退出登录流程）接管过来。插件改为原地改写芯片：官方组件照旧更新它自己的节点，插件在 React 重写后补回本地身份（rAF 节流的 `MutationObserver`）。设置页那一行则走正规槽位 `settings.general.item`（与外观、字号、回车行为同桌）。

**锚点。** 芯片用 `[data-slot="settings.launcher"]` 加它自身的状态属性 `button[data-collapsed][aria-haspopup="menu"]`；名字与头像两个座位用 class 名后缀 `_label`、`_avatar` 定位（CSS module 的哈希前缀每次构建都变，后缀跟着组件名走）。官方若改这些结构与属性，只需改 `lib/client.js` 顶部那几个常量。

## 依赖与边界

- host 半边 `import Schema from '@deepseek-ai/schemastery'`：靠 profile 根 node_modules 里已存在的 schemastery（`nodeLinker: hoisted` 下必然被提升到根）解析，不额外声明依赖。schemastery 走 Standard Schema 接口（`~standard`），与宿主自己那份不同实例也兼容。
- 浏览器半边只 `require` 三个静态平台模块：`react`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-primitives`，它们都在 shell 的静态模块表里，不需要 `dsh.client.external`，也没有构建步骤。
- 只改侧栏芯片。设置页「账号」区仍显示真实的账号名与 32px 头像——那里同时有 UID、余额与充值入口，整套信息属于账号本身。
- 依赖的官方内部契约：`data-slot` 槽标记、账号芯片的 `data-collapsed` / `data-signed-out` / `aria-haspopup` 属性、`_avatar` / `_label` class 后缀、host 服务 `webServer.register`、client 服务 `configForms`、client 槽 `settings.general.item`。在 DSH 0.2.0-rc.2 上按源码核对过。
