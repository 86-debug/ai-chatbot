# Luma Chat：零基础云部署指南

本指南针对这个项目编写：**FastAPI 后端 + static 网页 + DeepSeek API**。代码入口是 `app.py` 里的 `app`，因此命令必须写 `app:app`。页面和 API 由同一服务提供，无需另建前端站点。

## 先选平台

推荐先使用 **Render → Web Service → Python 3 → Free**。

截至 2026-11-10 核对的官方文档：Render 提供 Free Web Service；Hugging Face 新建 Docker / Gradio Space 需要付费计划，CPU Basic 没有按小时费用，但不代表免费账号能新建 Docker Space。免费的 Static Space 无法运行本项目的 Python 后端。因此 Hugging Face 作为已有相应权限时的备选，不作为本指南的完全免费路线。[Render 免费说明](https://render.com/docs/free)、[Hugging Face 当前政策](https://huggingface.co/docs/hub/spaces-overview#creating-a-new-space)。

免费托管只针对服务器资源，**DeepSeek API 的调用费用仍由你的 DeepSeek 账户承担**。本项目添加了网站访问密码，避免任何访客都能使用你的额度；适合个人或少量可信用户共享使用。

## 1. 这些文件已经准备好

| 文件 | 用途 |
| --- | --- |
| `requirements.txt` | 已有，安装 FastAPI、Uvicorn、HTTPX、dotenv；无需上传虚拟环境 |
| `Procfile` | 新增，提供通用 Linux 平台启动命令 |
| `render.yaml` | 新增，Render Blueprint 配置，已指定 Free、启动命令与健康检查 |
| `.python-version` | 新增，使用 Python 3.13 系列 |
| `Dockerfile` | 新增，Hugging Face Docker 备选配置，端口 7860，非 root 用户运行 |
| `.dockerignore` | 新增，排除本地密钥、虚拟环境与缓存 |
| `README.md` 顶部 YAML | 已补齐 Hugging Face 的 `sdk: docker`、`app_port: 7860` |
| `.gitignore` | 已增强，忽略 `.env`、`.env.*`、虚拟环境和部署压缩包；保留 `.env.example` |

已修复两个直接影响云运行的地方：自动接纳平台分配的域名；启动命令信任平台代理头，从而能正确校验 HTTPS 下的同源聊天请求。云平台未设置 `ACCESS_PASSWORD` 时，网站返回 503，健康检查仍可访问。

`Procfile` 文件名没有扩展名，第一行内容是：

```text
web: uvicorn app:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips '*'
```

**Render 手动新建 Web Service 时，仍按下面步骤填写 Start Command；Procfile 不代替表单配置。** `render.yaml` 通过 Blueprint 流程使用。

## 2. 把代码上传到 GitHub

### 最省事：使用部署包

本地 `dist/luma-deploy.zip` 是为上传准备的代码包，不含 `.env`、`.venv`、缓存或真实密钥。

1. 解压 `dist/luma-deploy.zip` 到一个新文件夹。
2. 打开 [GitHub 新建仓库](https://github.com/new)，登录。
3. Repository name 填 `luma-chat`，建议选择 **Private**。
4. 勾选添加 README 也可以，后面用项目 README 覆盖它。
5. 点击 **Create repository**。
6. 空仓库页面点击 **uploading an existing file**；已有仓库用 **Add file → Upload files**。
7. 打开刚解压的文件夹，选中里面的文件及 `static`、`tests` 文件夹，拖到网页上传区域。上传的是 ZIP 里面的内容，**不要把 ZIP 文件本身上传到仓库**。
8. 确认隐藏文件 `.python-version`、`.gitignore`、`.dockerignore` 也上传了。Windows 资源管理器可通过「查看 → 显示 → 隐藏的项目」显示它们。
9. 点击 **Commit changes**。

上传完成后的仓库首页应像这样（目录示意）：

```text
luma-chat /                       ← 仓库根目录
├── app.py                        ← 这里应直接看到 app.py
├── run.py
├── connection.py
├── requirements.txt
├── Procfile
├── render.yaml
├── .python-version
├── Dockerfile
├── .dockerignore
├── .gitignore
├── .env.example                  ← 仅有示例值，可以上传
├── README.md
├── DEPLOY.md
├── tests/
└── static/
    ├── index.html
    ├── style.css
    ├── app.js
    └── favicon.svg
```

还会包含本地启动和诊断脚本，它们无需在云平台运行。不要上传真实 `.env`、`.venv/`、`__pycache__/`。**网页手动上传不会替你执行 `.gitignore` 过滤**；使用部署包可减少误选文件。

如果你直接从原项目目录上传，请逐个选择上面的文件和代码文件夹，不要整文件夹拖入。若误上传真实密钥，先在 DeepSeek 控制台撤销旧密钥、生成新密钥，再清理仓库及历史记录；仅删除当前文件无法消除 Git 历史。

### 已经习惯 CLI 的可选方式

本项目目录当前尚未初始化 Git。先在 GitHub 新建一个**空仓库**，不要初始化 README，然后在项目文件夹的 PowerShell 里运行下面命令，将最后的仓库 URL 换成自己的：

```powershell
git init
git branch -M main
git add app.py run.py connection.py requirements.txt static tests Procfile render.yaml .python-version Dockerfile .dockerignore .gitignore .env.example README.md DEPLOY.md start.bat restart.bat restart.ps1 diagnose.py diagnose.bat
git diff --cached --name-only
# 只核对上面的文件名列表：不应包含 .env 或 .venv。
git commit -m "Prepare cloud deployment"
git remote add origin https://github.com/YOUR_USERNAME/luma-chat.git
git push -u origin main
```

第一次使用 Git 可能需要按提示设置用户名、邮箱并登录 GitHub。已经存在 Git 历史或 remote 的项目不要重复执行初始化步骤。

## 3. Render：创建免费 Web Service

1. 打开 [Render 控制台](https://dashboard.render.com/)，注册或登录。
2. 点击 **New + → Web Service**。本项目需要 Python 后端，选择 Web Service。
3. 选择 **Git Provider**，连接 GitHub；授权访问刚建的 `luma-chat` 仓库即可。
4. 选择 `luma-chat` 仓库并连接。
5. 按下表填写。由于项目包含 Dockerfile，若页面自动选择 Docker，**手动把 Language / Runtime 改为 Python 3**。

以下是字段示意，具体按钮位置以平台当前页面为准：

```text
┌─ New Web Service ────────────────────────────────┐
│ Name            luma-chat（重名时加后缀）        │
│ Language        Python 3                        │
│ Branch          main（或实际存放代码的分支）     │
│ Region          选择可用区域                    │
│ Root Directory  留空                            │
│ Build Command   pip install -r requirements.txt │
│ Start Command   复制下面完整的一行              │
│ Instance Type   Free                            │
└─────────────────────────────────────────────────┘
```

| 字段 | 填什么 |
| --- | --- |
| Name | `luma-chat`，若冲突换个名字 |
| Language / Runtime | **Python 3** |
| Branch | `main`，或你的实际分支 |
| Region | 任选可用区域 |
| Root Directory | **留空**，前提是仓库根目录直接有 `app.py` 和 `requirements.txt` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | 复制下方完整命令 |
| Instance Type / Plan | **Free** |
| Health Check Path | `/api/health`，可能位于 Advanced 区域 |

**Start Command 填这一整行：**

```bash
uvicorn app:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips '*'
```

这里不加 `web:`，不写 `python app.py`，也不加 `--reload`。`app.py` 只有应用定义，没有直接启动服务器的入口；`python run.py` 默认监听本机地址，云上优先使用上面的明确命令。

`$PORT` 原样填写，Render 会在 Linux 启动环境中替换它，无需手动设置 PORT。此命令复制到本机 PowerShell 时变量语法不同；本地继续双击 `start.bat` 即可。

代理参数供云平台反向代理后的服务使用，用于识别外部 HTTPS，保持聊天接口的同源校验。[Render 官方 FastAPI 部署说明](https://render.com/docs/deploy-fastapi)、[FastAPI 代理说明](https://fastapi.tiangolo.com/advanced/behind-a-proxy/)。

## 4. Render：填写环境变量

在创建页找到 **Environment Variables → Add Environment Variable**；若已经创建服务，在服务页 **Environment** 中填写并保存部署。不要把本地 `.env` 文件上传到 GitHub。

| Key | Value | 是否必须 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 你自己的真实 DeepSeek API Key | 必须，在平台后台填写 |
| `ACCESS_USERNAME` | `admin` | 建议显式填写，这是网站登录用户名 |
| `ACCESS_PASSWORD` | 自己设置的随机长密码，建议至少 16 位英文字母、数字和符号 | 必须，这是网站登录密码，和 API Key 无关 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 建议填写；不加 `/chat/completions` |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro`，或你账户当前可用的模型 ID | 建议填写；API 兼容性以提供方为准 |

不要给值加引号，也不要写成 `DEEPSEEK_API_KEY=...` 放进 Value 框；Key 和 Value 分开填。网站访问密码使用英文字符；浏览器原生 Basic 登录对中文密码的兼容性有限。

无需设置 `HOST`、`PORT`、`RENDER`、`RENDER_EXTERNAL_HOSTNAME`。默认平台域名自动识别。`.python-version` 已选择 Python 3.13 系列；不必额外设置 `PYTHON_VERSION`。如自行设置该变量，Render 要求填写完整版本号。[Python 版本说明](https://render.com/docs/python-version)。

自定义域名是后续可选项：在 Render 完成域名绑定后，增加 `ALLOWED_HOSTS=chat.example.com`，多个域名用逗号分隔，填写主机名，不加 `https://`、端口或路径。健康检查也可能使用自定义域名，别漏掉。[Render 健康检查说明](https://render.com/docs/health-checks)。

## 5. Render：部署和验收

1. 点击 **Create Web Service / Deploy Web Service**。
2. 在 **Logs / Events / Deploys** 看构建进度。安装依赖后，应能看到 Uvicorn 启动日志，例如 `Uvicorn running on http://0.0.0.0:10000`，端口以日志为准。
3. 等平台显示 **Live**，点击服务顶部的 `https://你的服务名.onrender.com`。
4. 浏览器弹出登录框时，用户名填 `admin`（或你设置的 `ACCESS_USERNAME`），密码填 `ACCESS_PASSWORD`。这是你的网站密码，不是 Render 账号密码，也不是 DeepSeek Key。
5. 页面加载后发送一句“你好”，确认能逐步显示回复，再测试一次深度思考和停止生成。**这一步会产生正常 API 调用费用**。
6. 打开 `https://你的服务名.onrender.com/api/health`，预期看到下面结构：

```json
{"status":"ok","configured":true,"model":"deepseek-v4-pro"}
```

`configured: true` 仅说明配置了非空密钥，不能证明密钥有效或账户有余额；实际聊天才验证调用链。健康检查无需密码，不会调用模型，也不会返回密钥。

页面的静态资源和 `/api/chat` 都受网站密码保护。把链接分享给可信用户时，需要同时提供网站账号密码；对方使用的模型调用仍由你的 DeepSeek 账户结算。密码不是多用户配额系统。

## 6. Render Blueprint：更少手填的备选

如果选择 Blueprint，就不用再用上述手动流程创建第二个同样的服务。

1. 同样先上传代码到 GitHub。
2. Render 点击 **New + → Blueprint**，连接该仓库。
3. Render 读取根目录 `render.yaml`。确认服务名、`plan: free` 和 Python runtime。
4. 按提示填写 `DEEPSEEK_API_KEY`、`ACCESS_PASSWORD`；这两个值不会写进配置文件。
5. 点击部署。默认用户名 `admin`，健康检查 `/api/health`。

以后更换密钥或密码，在服务 **Environment** 中修改并重新部署。Blueprint 的 `sync: false` 密钥提示只在初次创建时出现。[Blueprint 官方说明](https://render.com/docs/blueprint-spec#prompting-for-secret-values)。

## 7. Hugging Face：已有 Docker Space 权限时使用

**先检查账号套餐。** 当前官方要求新建 Docker Space 具备相应付费计划；没有权限时，继续用 Render 免费方案。Static Space 无法运行 Python 后端，不适合把整个项目直接上传运行。

1. 打开 [Create a new Space](https://huggingface.co/new-space)。
2. 选择拥有者，名称例如 `luma-chat`。
3. **SDK 选择 Docker**；如果出现模板选择，选择 **Blank**。
4. Hardware 选择 **CPU Basic**；不要误选收费的 GPU 或 CPU Upgrade。
5. Visibility：自己使用可选 **Private**；需要分享给外部用户则按平台权限选择相应可见性。Private Space 的运行页面也只供拥有者与协作者访问。
6. 创建 Space，进入 **Files → Add file → Upload files**，上传部署包解压后的文件，保持仓库根目录有 Dockerfile 和项目 README。
7. **保留本项目 README 顶部的 YAML**，其中 `sdk: docker`、`app_port: 7860` 是运行配置。若平台生成了 README，使用项目 README 替换它，避免丢失配置。
8. **Settings → Variables and secrets**：
   - 通过 **New secret** 添加 `DEEPSEEK_API_KEY` 与 `ACCESS_PASSWORD`。
   - 通过 **New variable** 添加 `ACCESS_USERNAME=admin`、`DEEPSEEK_BASE_URL=https://api.deepseek.com`、`DEEPSEEK_MODEL=deepseek-v4-pro`。
9. 等待 Space 构建并启动。环境变量修改后让 Space 重启，确认运行的是新配置。
10. 通过平台提供的直接应用链接 `https://你的实际子域名.hf.space` 打开，输入网站账号密码，再测试聊天。实际地址以平台给出的链接为准，不要根据用户名自行猜。

**Hugging Face 不用填写 Render 的 Start Command。** Dockerfile 已写好启动过程，实际等价于：

```bash
uvicorn app:app --host 0.0.0.0 --port 7860 --proxy-headers --forwarded-allow-ips '*'
```

不用配置 `PORT`。如果自行修改端口，要让 Docker 启动命令和 README 的 `app_port` 一致。

本项目保留禁止 iframe 嵌入的页面保护，因此 Hugging Face 页面内的 App 嵌入视图可能空白或显示拒绝连接；**使用直接的 `.hf.space` 链接打开**即可。[Docker Space 配置与 Secrets](https://huggingface.co/docs/hub/spaces-sdks-docker)、[Space 可见性说明](https://huggingface.co/docs/hub/spaces-overview#space-visibility)。

## 8. 常见问题对照

| 现象 | 处理办法 |
| --- | --- |
| 找不到 `requirements.txt` / `app.py` | 检查是否把整个外层文件夹上传了；让文件直接出现在仓库根目录，或正确设置 Root Directory |
| Render 自动进入 Docker 构建 | 本指南主路线选择 Python 3 runtime；已有服务在 Settings 检查配置 |
| `Could not import module app` | Start Command 使用 `app:app`，确认根目录存在 `app.py` |
| `No open ports detected` | 使用本指南完整启动命令，确保 `--host 0.0.0.0 --port $PORT` |
| `Invalid host header` | 确认部署了修改后的 `app.py`；默认云域名自动读取，自定义域名增加 `ALLOWED_HOSTS` 后重启 |
| 网页 503，提示设置 `ACCESS_PASSWORD` | 在平台后台设置网站访问密码，再保存部署 |
| 登录反复弹出 / 401 | 核对 `ACCESS_USERNAME` 和 `ACCESS_PASSWORD`；默认用户为 admin；使用英文密码；更新密码后可开无痕窗口重试 |
| 网页能开，发消息 403 | 使用 HTTPS 站点本身发消息；核对启动命令包含两个代理参数；不要从其他域名页面调用 API |
| `/api/health` 显示 `configured: false` | 环境变量名必须为 `DEEPSEEK_API_KEY`，填写真实密钥并保存部署 |
| 聊天提示 API Key 无效 / 账户余额不足 | 前者检查平台密钥；后者检查 DeepSeek 账户余额；与 Render 网站登录密码无关 |
| 聊天提示模型或接口不存在 | 核对 `DEEPSEEK_BASE_URL` 和当前账户可用的 `DEEPSEEK_MODEL`，然后重启 |
| 第一次打开很慢 | Render Free 无流量约 15 分钟会休眠，下次访问启动大约需要一分钟 |
| Hugging Face 提示需要升级计划 | 当前 Docker Space 创建政策所致；要免费托管此项目，选择 Render |
| Hugging Face App 标签页拒绝连接 | 用平台提供的直接 `.hf.space` 地址打开，避免 iframe 嵌入 |
| CDN 资源加载失败、界面提示组件不可用 | 浏览器需要能访问 `cdn.jsdelivr.net`；后端需要能访问 DeepSeek API |
| 换浏览器或换站点域名后历史没了 | 历史在该浏览器、该站点的 localStorage 中，不会自动跨设备或域名同步；重要聊天先导出 |

Render Free 受工作区每月免费运行小时数、流量与构建额度约束，本地文件系统也不持久；这是个人演示部署。共享免费额度或绑定付款方式后的超额处理以平台后台为准。[Render Free 限制](https://render.com/docs/free)。

以后更新代码：GitHub 提交变更后，已启用自动部署的 Render 会重新部署；如未自动部署，在服务页使用 **Manual Deploy → Deploy latest commit**。不要用重新上传 `.env` 的方式更新密钥，直接修改平台环境变量。
