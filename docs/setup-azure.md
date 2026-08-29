# Azure 应用注册教程(OneDrive 授权前置)

OneHub 通过 Microsoft Graph 读取您的 OneDrive。按账号类型需要注册不同的 Azure 应用。**全程免费**,10 分钟左右完成。

## A. 个人版 OneDrive(outlook/hotmail 等个人账号)

> 原理:公共客户端 + 设备码流,授权一次获得 refresh_token 存入 Cloudflare KV,之后 Worker 自动刷新。

1. 登录 [Azure Portal](https://portal.azure.com)(个人账号即可),搜索 **应用注册**(App registrations)→ **新注册**:
   - 名称:`OneHub-Personal`(任意)
   - 受众类型:选 **任何组织目录中的账户和个人 Microsoft 账户**
   - 重定向 URI:平台选 **移动应用程序和桌面应用程序**,地址填
     `https://login.microsoftonline.com/common/oauth2/nativeclient`
2. 注册后,**概述**页复制 **应用程序(客户端) ID** —— 脚本加账号时会用到。
3. **API 权限** → 添加权限 → **Microsoft Graph** → **委托的权限**,勾选:
   - `Files.Read.All`
   - `offline_access`(刷新令牌必需)
   - `User.Read`
4. **身份验证** → 页面底部 **高级设置** → **允许公共客户端流** 设为 **是**,保存。
   (不开这一步,设备码授权会报 `AADSTS7000218`)
5. 个人账号对委托权限自行同意即可,无需管理员。

## B. E5 / E3 / 企业版(OneDrive for Business)

> 原理:client credentials(应用密钥),Worker 直接以应用身份读目标用户的 drive。**每个租户注册一个应用**;E3/E5 开发者订阅里您就是管理员。

1. 登录目标租户的 [Azure Portal](https://portal.azure.com) → **应用注册** → **新注册**:
   - 名称:`OneHub-Business`
   - 受众类型:选 **仅此组织目录中的账户**(单租户)
   - 重定向 URI:留空(client credentials 不需要)
2. **概述**页记录三项:**目录(租户) ID**、**应用程序(客户端) ID**。
3. **证书和密码** → **新客户端密码** → 描述任意、有效期选最长 → **立即复制 Value(不是 ID,只显示一次!)**。
4. **API 权限** → 添加权限 → **Microsoft Graph** → **应用程序权限**:
   - 勾选 `Files.Read.All`
   - 点击 **代表 <租户> 授予管理员同意**(必须,否则取 token 报 403)
5. 确定要展示哪个用户的网盘,记录其 **UPN**(登录邮箱,如 `admin@xxxx.onmicrosoft.com`)。

> **最小权限替代方案**(可选,适合多用户大租户):把上面的 `Files.Read.All` 换成 `Sites.Selected` 应用权限,并用 Graph API 给应用单独授权目标 SharePoint 站点。配置较繁琐,家用 E5 没必要。

## 常见报错

| 报错 | 原因 | 解决 |
|---|---|---|
| `AADSTS7000218` | 个人版未开公共客户端流 | 步骤 A-4 |
| `AADSTS65001` / Graph 403 | 企业版未授予管理员同意 | 步骤 B-4 |
| `AADSTS900021` / token 端点 400 | 租户 ID 写错或应用不在该租户 | 核对步骤 B-2 |
| `Access denied`(列文件 403) | UPN 写错或该用户无 OneDrive | 核对 UPN;让该用户登录一次 OneDrive 网页版 |
