#!/bin/bash
# 一键部署脚本 (One-click deployment script)

# 确保脚本在遇到错误时停止执行
set -e

echo "======================================"
echo "开始部署 suiyunzou-hot-monitor"
echo "======================================"

# 1. 拉取最新代码
echo "=> 1/6 拉取最新代码 (git pull)..."
git pull origin main

# 2. 安装依赖包
echo "=> 2/6 安装依赖包 (npm install)..."
npm install

# 3. 生成 Prisma Client
echo "=> 3/6 生成 Prisma Client (npm run prisma:generate)..."
npm run prisma:generate

# 4. 执行数据库迁移（这里使用项目中定义的 db:apply）
echo "=> 4/6 执行数据库迁移 (npm run db:apply)..."
npm run db:apply

# 5. 构建 Next.js 项目
echo "=> 5/6 构建项目 (npm run build)..."
npm run build

# 6. 重启 PM2 进程，并指定运行在 3000 端口
echo "=> 6/6 重启应用服务 (pm2)..."
# 如果使用了 PM2 来守护进程，这里会自动重载；如果应用尚未启动，则会使用 npm start 启动，并强制指定端口为 3000
pm2 reload suiyunzou-hot-monitor 2>/dev/null || PORT=3000 pm2 start npm --name "suiyunzou-hot-monitor" -- start

echo "======================================"
echo "部署完成！🎉"
echo "======================================"
