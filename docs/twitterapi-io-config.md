# twitterapi.io API Key 配置说明

本项目通过系统环境变量读取 twitterapi.io Key，变量名为：

```text
TWITTERAPI_IO_KEY
```

不要把真实 Key 写入 `.env`、Markdown、代码或 Git 仓库中。

## 推荐方式：写入 Windows 用户环境变量

打开 PowerShell，执行：

```powershell
[Environment]::SetEnvironmentVariable("TWITTERAPI_IO_KEY", "你的_twitterapi_io_key", "User")
```

执行后需要重启：

- 当前 PowerShell / 终端
- Next.js 开发服务
- 必要时重启 Codex 桌面应用

验证是否写入成功：

```powershell
[Environment]::GetEnvironmentVariable("TWITTERAPI_IO_KEY", "User")
```

如果命令能输出你的 Key，说明用户级环境变量已配置成功。

## 当前会被项目读取的位置

项目代码会通过下面方式读取：

```ts
process.env.TWITTERAPI_IO_KEY
```

对应采集器文件：

```text
src/lib/collectors/twitterapi-io.ts
```

## 配置后如何测试

重启开发服务后，可以调用：

```powershell
$body = @{ collectors = @("twitterapi-io"); limit = 5 } | ConvertTo-Json
Invoke-WebRequest -Uri http://127.0.0.1:3000/api/collect -Method POST -ContentType "application/json" -Body $body -UseBasicParsing
```

如果 Key 未配置，接口会返回：

```text
TWITTERAPI_IO_KEY is not configured
```

如果 Key 配置正确，会开始调用 twitterapi.io 的 advanced search 接口，并将结果保存到数据库。

