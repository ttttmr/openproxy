# 使用 Node.js 官方镜像作为基础镜像
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制 TypeScript 配置和源代码
COPY tsconfig.json ./
COPY src ./src

# 构建 TypeScript 项目
RUN npm install typescript && npm run build

# 生产阶段
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 复制生产依赖
COPY package*.json ./
RUN npm ci --only=production

# 从构建阶段复制编译后的代码
COPY --from=builder /app/dist ./dist

# 暴露端口
EXPOSE 3000

# 设置环境变量（可选）
ENV NODE_ENV=production

# 启动应用
CMD ["npm", "start"]
