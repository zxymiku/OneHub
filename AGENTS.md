# AGENTS.md — OneHub 多 Agent 开发规范

> 本项目由多个 agent/model 协作开发。**任何 agent 开始工作前必读 `plan.md` + 本文件**;两者冲突时以 `plan.md` 为准,并应在 PR 中指出冲突。

## 0. 铁律(违反即要求返工)

1. **禁止直接提交任何内容到 `main` 分支**(包括文档)。一切变更走功能分支 + Pull Request,由仓库所有者人工审查合并。
2. **禁止提交任何密钥/令牌/密码**:clientSecret、refreshToken、ACCESS_PASSWORD、GATE_SECRET、KV 内容、`.dev.vars`、`.env*` 一律不入库。样例只允许占位符(`<your-client-id>`)。**`worker/wrangler.jsonc` 是生成物不入库**(由 `wrangler.template.jsonc` + `CF_KV_*` 环境变量生成, 开源零标识符);改 Worker 配置请改模板。
3. **禁止把 `.skills/`、`.wrangler/`、`node_modules/`、`dist/` 提交进仓库**(已在 .gitignore)。
4. **禁止在前端代码或响应中暴露凭据**;所有 Graph 调用必须经 Worker 代理。
5. 视觉契约 `endfield × maximal` 不可擅改;**不得复制任何鹰角(Hypergryph)版权资产**(logo、立绘、截图、CDN 资源),只依据 `.skills/ark-ui-skill-main` 做风格重建。
6. 不确定的需求细节:**先问,不要猜**(创建 issue 或在 PR 中列出 Open Questions)。

## 1. 认领与分支流程

```
1. 读 plan.md §7 模块认领表 → 选择未被认领的模块
2. 在 plan.md 认领表把状态改为: @<你的agent名> 进行中(随你的第一个 commit 提交)
3. 切分支:  git checkout -b <类型>/<模块名>   # 分支名见 plan.md §7,不得自造
4. 只改认领范围内的目录 + 必要的共享文件(改动共享契约文件需在 PR 中显著说明)
5. 本地验证(见 §4)全部通过
6. push + gh pr create(用 .github/PULL_REQUEST_TEMPLATE.md)
7. 在 plan.md 认领表把状态改为: 已提PR #N
```

依赖其他 PR 的模块(如 PR-5 依赖 PR-4):若基础 PR 未合并,从该分支切出并在 PR 描述注明 `Depends on #N`。

## 2. 提交与分支命名

- 分支:`feat/*`、`fix/*`、`docs/*`、`chore/*`(必须与 plan.md §7 认领表一致)
- 提交信息:Conventional Commits,如 `feat(worker): 增加账号注册表读取`、`fix(preview): 修复 xlsx 类型判定`。中文描述允许且鼓励。
- 一个 PR 只做一个模块的一件事;禁止夹带无关格式化/重构。

## 3. 代码风格

- 语言:TypeScript(strict);前端 React 函数组件 + hooks,不用 class 组件。
- 模块化:每个 feature 目录自带 `api.ts`(该模块的前后端契约类型)/`components/`/`hooks/`;共享逻辑进 `shared/`,禁止 feature 之间互相 import(经 `shared` 或路由参数协作)。
- 注释:只写"为什么",不复述代码;中文注释。文件一律 UTF-8,换行 LF(`.editorconfig` 已配置)。
- 不引入新依赖前先确认必要性,并在 PR 描述说明理由;能用 Worker/Vite 内置能力就不加包。
- 错误处理:所有 fetch 必须处理非 2xx;用户可见错误文案用中文、面向使用者(参考 `.skills/frontend-design` 文案章节)。

## 4. 每个 PR 的验证清单(全过才能提 PR)

```bash
npm install            # 根目录 workspaces 安装
npm run lint           # eslint(prettier 格式由 eslint 出)
npm run typecheck      # tsc --noEmit(各 workspace)
npm run test           # vitest(worker 单测 mock Graph;frontend 测 fileTypes 等纯逻辑)
npm run build          # frontend 产物 + worker 构建通过
```

前端 PR 额外必做:

```bash
node .skills/ark-ui-skill-main/scripts/audit-ark-ui.mjs frontend/dist/index.html frontend/dist/assets/*.css
```

(样式经 Vite 外置,必须把构建 CSS 一并传入审计,否则四项检查会误报缺失。)

并自查:桌面 1440×900 与竖屏 390×844 无横向溢出/裁剪/碰撞;键盘可完整走通主流程且焦点可见;`prefers-reduced-motion` 下有静态构图;`endfield × maximal` 契约未漂移(密集列表屏降 complex 密度合规)。

后端 PR 额外必做:`npm run dev:worker` 后用 curl 走通 `/api/health`、`/api/gate/status`,并在 PR 中附输出。

PR 描述按模板填写验证结果;CI 红了不许请求审查。

## 5. 契约变更流程

`docs/api.md` 与 `plan.md §8` 是前后端/多 agent 的唯一契约。需要新增/修改接口时:

1. 在你的分支先改契约文档(单独一个 commit,标题 `docs(api): ...`);
2. PR 描述里说明变更原因与影响面;
3. 实现与契约不一致会被要求返工。

## 6. 安全要点(涉及 worker/、scripts/ 的 agent 必读)

- 凭据只出现在:KV 值、Worker secrets、生成物 `worker/wrangler.jsonc`(不入库)、用户本地 `.dev.vars`。
- 日志/错误响应中不得输出 token、secret、完整 KV 值。
- 密码比较用常量时间比较;Cookie 用 HMAC 签名 + HttpOnly + SameSite=Lax;未设 ACCESS_PASSWORD 时所有门端点直接放行。
- 个人版 refresh_token 每次刷新后**必须回写 KV**(Microsoft 会轮换),否则 90 天后静默失效。

## 7. 提 PR 后

- 回复审查意见时在同一分支追加 commit(不要 force-push 重写已审查历史,除非审查者要求);
- 合并由仓库所有者执行;agent 不要自行 merge;
- 合并后删除功能分支。
