# Cloudflare 配置教程(Workers + KV + 部署)

## 1. 准备

- 注册 [Cloudflare](https://dash.cloudflare.com) 账号(免费版即可,Workers 免费 10 万请求/天,KV 免费 10 万读/天,本项目绰绰有余)。
- 本地安装 Node.js ≥ 20 与 Git;在仓库根目录 `npm install`。
- 登录 wrangler(Cloudflare 官方 CLI,已含在 devDependencies,用 `npx wrangler` 调用):

```bash
npx wrangler login        # 会打开浏览器授权
```

## 2. 创建 KV 命名空间

```bash
npx wrangler kv namespace create ACCOUNTS   # 账号注册表(含凭据)
npx wrangler kv namespace create GATE       # 密码门限速计数
```

把命令输出的 `id` 填入 `worker/wrangler.jsonc` 对应的 `<KV_NAMESPACE_ID>` / `<KV_NAMESPACE_ID_2>` 占位符。

## 3. 配置访问密码(可选,但强烈建议)

不设置则网站完全公开;设置后访客需先输入密码:

```bash
npx wrangler secret put ACCESS_PASSWORD     # 输入你想要的访问密码
npx wrangler secret put GATE_SECRET         # 输入一段随机长字符串(HMAC 密钥), 例: openssl rand -hex 32
```

本地开发则在 `worker/.dev.vars`(已 gitignore)里写:

```
ACCESS_PASSWORD=dev123
GATE_SECRET=dev-secret-change-me
```

## 4. 添加 OneDrive 账号

先完成 `docs/setup-azure.md` 的应用注册,然后:

```bash
# 个人版(会给出设备码, 浏览器打开 microsoft.com/devicelogin 输入并登录)
npm run account:add -- --name 一号机 --type personal --client-id <应用程序ID>

# 企业版 E5/E3
npm run account:add -- --name 账号2 --type business \
  --client-id <应用程序ID> --tenant-id <租户ID> \
  --client-secret <密钥Value> --upn admin@xxxx.onmicrosoft.com

npm run account:list                 # 查看已添加账号(不显示密钥)
npm run account:remove -- --id <id>  # 移除账号
```

> 本地开发时脚本写入的是**本地 KV 预览数据**(`wrangler dev` 的本地模拟),部署前用 `--remote` 写入线上 KV,详见脚本 `--help`。

## 5. 本地开发

```bash
npm run dev:worker    # 终端1: wrangler dev, API 在 http://localhost:8787
npm run dev:web       # 终端2: vite 开发服务器 http://localhost:5173 (已代理 /api → 8787)
```

## 6. 部署上线

```bash
npm run build:web     # 构建 frontend/dist
npm run deploy        # wrangler deploy, 输出形如 https://onehub.<你的子域>.workers.dev
```

- 更新版本:拉取最新代码后重复第 6 步即可(账号与配置都在 Cloudflare 侧,不受影响)。
- **自定义域名(可选)**:Dashboard → Workers & Pages → onehub → Settings → Domains & Routes → Add Custom Domain(域名需已托管在该 Cloudflare 账号)。
- **CI 自动部署(可选)**:在 GitHub 仓库 Settings → Secrets 添加 `CLOUDFLARE_API_TOKEN`(模板 "Edit Cloudflare Workers",权限 Workers Scripts:Edit + Account Settings:Read)与 `CLOUDFLARE_ACCOUNT_ID`,然后取消 `.github/workflows/deploy.yml` 的注释启用。默认关闭,部署以手动 `npm run deploy` 为准。

## 7. 验证清单

- [ ] `curl https://<部署域名>/api/health` 返回 `{"ok":true}`
- [ ] 首页能看到所有已添加账号的展示名
- [ ] 任一账号能进入并列出文件;点文件可下载(浏览器直接开始下载)
- [ ] `.md`、`.mp4`、`.docx` 各自能预览;`.exe` 之类显示"不支持在线预览"
- [ ] (若设了密码)未登录时接口返回 401,输入密码后正常
