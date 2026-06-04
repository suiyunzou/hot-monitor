# OpenRouter API Key 配置说明

本项目通过系统环境变量读取 OpenRouter Key，变量名为：

```text
OPENROUTER_API_KEY
```

默认模型变量为：

```text
OPENROUTER_MODEL=deepseek/deepseek-v4-flash
```

不要把真实 Key 写入 `.env`、Markdown、代码或 Git 仓库中。

## 推荐方式：写入 Windows 用户环境变量

打开 PowerShell，执行：

```powershell
[Environment]::SetEnvironmentVariable("OPENROUTER_API_KEY", "你的_openrouter_key", "User")
[Environment]::SetEnvironmentVariable("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash", "User")
```

执行后需要重启：

- 当前 PowerShell / 终端
- Next.js 开发服务
- 必要时重启 Codex 桌面应用

验证是否写入成功：

```powershell
[Environment]::GetEnvironmentVariable("OPENROUTER_API_KEY", "User")
[Environment]::GetEnvironmentVariable("OPENROUTER_MODEL", "User")
```

## 当前会被项目读取的位置

项目代码会通过下面方式读取：

```ts
process.env.OPENROUTER_API_KEY
process.env.OPENROUTER_MODEL
```

## 配置后如何测试

重启开发服务后，可以调用：

```powershell
$body = @{ limit = 3 } | ConvertTo-Json
Invoke-WebRequest -Uri http://127.0.0.1:3000/api/analyze -Method POST -ContentType "application/json" -Body $body -UseBasicParsing
```

如果 Key 未配置，接口会返回：

```text
OPENROUTER_API_KEY is not configured
```

如果 Key 配置正确，系统会读取未分析的 RawItem，调用 OpenRouter 生成热点分析结果并保存到数据库。

