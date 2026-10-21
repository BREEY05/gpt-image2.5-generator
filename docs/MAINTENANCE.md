# 维护与更新指南

这份文档回答一件事：**OpenAI 出了新模型、或者 API 有新变化时，改哪里、怎么验证、怎么重新打包发版。**

---

## 0. 先分清是哪一类更新

| 变化 | 要改什么 | 要重新打包吗 |
|---|---|---|
| 只是自己用新模型 | 界面「模型」输入框直接填新 model id | 不用 |
| 新模型需要正确的尺寸/画质选项 | `server/models.mjs` | 源码版重启即可；安装版要重打包 |
| 新模型有新参数（新 quality 档位、新开关） | `web/src/components/Composer.tsx` + `server/index.mjs` | 要重打包 |
| 接口路径/返回结构变了 | `server/openai.mjs` | 要重打包 |
| 余额查询接口变了 | `server/quota.mjs` | 要重打包 |
| 只改文案/主题/UI | `web/**` | 要重打包 |

关键认知：**模型名不是硬编码的**。界面可以直接输入任意 model id，能力表只决定「下拉框里有哪些尺寸/画质」。所以新模型发布当天，不改代码也能先用起来。

---

## 1. 最常见场景：新增一个模型

### 1.1 先确认官方参数

看 OpenAI 文档里新模型支持什么：

- model id（例如 `gpt-image-3`）
- 尺寸：固定几档，还是允许自定义 WxH
- 画质档位：`low / medium / high`，还是有 `xhigh / max`
- 是否支持编辑（/images/edits）、是否支持 mask
- 返回是不是只有 base64
- 数量上限 n

### 1.2 加到能力表

编辑 `server/models.mjs` 里的 `PRESET_MODELS`，追加一条：

```js
{
  id: "gpt-image-3",
  label: "GPT-Image-3",
  note: "新一代，细节更好",
  family: "3",
  quality: ["low", "medium", "high"],
  customSize: true,
  maxN: 10,
  formats: ["png", "jpeg", "webp"],
  background: true,
  edit: true
}
```

字段含义：

| 字段 | 作用 |
|---|---|
| id | 真正发给 API 的 model 名 |
| label / note | 下拉框显示的文字与说明 |
| family | 模糊匹配用：填 "3" 能兜住 gpt-image-3-mini 这类名字 |
| quality | 画质下拉框的选项 |
| customSize | 是否允许自定义宽高（false 时只显示 3 个预设尺寸） |
| maxN | 一次最多生成几张 |
| formats | 支持的输出格式 |
| background | 是否支持 transparent |
| edit | 是否支持编辑 |

匹配顺序（`capsFor`）：精确 id → 前缀 → `image-<family>` → 含 `gpt-image` → 通用兜底 `DEFAULT_CAPS`。没收录的模型也不会崩，只是参数按通用能力给。

### 1.3 验证

```powershell
pnpm smoke                 # 不花钱，验证服务端逻辑没坏
node server/index.mjs      # 源码版重启即可，前端能力表来自 /api/state，无需重新 build
```

打开界面 → 模型框输入新 id（或从下拉框选）→ 拉取模型列表确认 → 用真实 Key 出一张图。

> 安装版用的是打包进去的 `server/models.mjs`，所以必须重新打包才会生效。

---

## 2. 新模型多了新参数

例如官方加了 `style` 或 `seed` 字段。

1. `web/src/types.ts`：给 `Params` 加字段
2. `web/src/components/Composer.tsx`：仿照「画质 / 背景」加一个控件
3. `server/index.mjs` 的 `handleGenerate`：把字段拼进请求体（**只在有值时传**，避免旧模型报 400）

```js
if (params.style) fields.style = String(params.style);
```

4. 需要新端点时在 `server/openai.mjs` 加函数，再到 `index.mjs` 挂路由
5. `web/src/api.ts` / `types.ts` 补类型

**临时办法**：界面「高级参数（JSON）」可以直接透传任意字段，改代码前先用它试效果。

---

## 3. 接口 / 余额查询变化

- 出图接口字段变化 → `server/openai.mjs`（generateImages / editImages）
- 返回结构变化 → `collectImages` 里适配（b64_json / url / 其他）
- 上游余额接口变化 → `server/quota.mjs`，按现有顺序加一段 probe，返回统一结构：

```js
{ available: true, source: "xxx", label: "显示名", currency: "USD",
  limit: 100, used: 12.3, remaining: 87.7, checkedAt: Date.now(), message: "来源说明" }
```

---

## 4. 改完后的验证清单

```powershell
node --check server/index.mjs
node --check server/openai.mjs
node --check server/quota.mjs
pnpm exec tsc --noEmit       # 前端类型
pnpm smoke                   # 31 项端到端断言（自动起 mock，不花钱）
pnpm build                   # 前端构建
```

再手动做一次：真实 Key → 生成 1 张 → 检查历史、额度条、下载。

---

## 5. 重新打包（重点）

### 5.1 一条命令

```powershell
pnpm release              # 不改版本，构建 + 打包 + 验证
pnpm release patch        # 0.1.0 -> 0.1.1（自动改 package.json）
pnpm release minor        # 0.1.0 -> 0.2.0
pnpm release 0.3.0        # 指定版本
```

它会依次做：vite build → electron-builder --win nsis → verify-release，最后打印安装包路径和体积。

### 5.2 手动等价命令

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
node node_modules/vite/bin/vite.js build
node node_modules/electron-builder/cli.js --win nsis
node scripts/verify-release.mjs
```

镜像变量很重要：不设置时 electron-builder 会去 GitHub 下载 Electron，国内网络经常超时（本项目踩过）。脚本里已默认带上镜像。

### 5.3 打包前检查

```powershell
# 结束残留进程，否则 release/ 里的 exe 被占用会报 EBUSY
Get-Process | Where-Object { $_.ProcessName -like '*GPT Image*' } | Stop-Process -Force
```

产物：`release/GPT-Image-Studio-<version>-Setup.exe`（约 97 MB），`release/` 已被 .gitignore 忽略。

---

## 6. 发布新版本

```powershell
git add -A
git commit -m "release: v0.1.1"
git tag v0.1.1
git push origin main --tags
```

然后到 GitHub 仓库 → Releases → Draft a new release → 选 tag `v0.1.1` → 把 Setup.exe 拖进 Assets → Publish。

- 用户覆盖安装即可升级（NSIS 会替换程序文件）
- **用户数据不会丢**：数据在 `%APPDATA%\GPT Image Studio\data`，升级和卸载都保留
- 版本号只影响安装包文件名和信息显示，不改变数据格式；若改了数据库结构，记得在 `server/db.mjs` 的 `migrate()` 里做兼容迁移

---

## 7. 常见问题

| 问题 | 处理 |
|---|---|
| electron-builder 卡住/超时 | 确认设置了两个 MIRROR 环境变量（脚本已默认） |
| EBUSY: 文件被占用 | 结束 GPT Image Studio 进程，或删掉 release/ 再打 |
| pnpm 脚本报 ERR_PNPM_IGNORED_BUILDS | 检查 pnpm-workspace.yaml 的 allowBuilds 配置 |
| 改了界面但安装包里没变化 | 打包前要 pnpm build（或直接用 pnpm release） |
| 改了模型但界面没变 | 源码版重启服务；安装版必须重打包 |
| 安装包被 SmartScreen 拦截 | 未签名属正常，点「更多信息 → 仍要运行」；想彻底消除需代码签名证书 |
| 打包后体积突然变大 | 检查 resources/app 是否混入 node_modules（afterPack 会删，正常 0.42 MB） |

---

## 8. 数据与发布安全

- 仓库和安装包**都不包含** `data/`；每次打包后跑 `pnpm verify:release` 确认
- 发布前跑 `pnpm check:secrets`，避免把 Key 写进代码或文档
- 本地 `data/`（含真实 Key）永远不会被提交；但**不要压缩整个项目文件夹上传**
