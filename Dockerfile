FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY .npmrc ./
# 安装所有依赖（包含 devDependencies），用于构建
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# 构建项目
RUN npm run build
# 构建完成后移除开发依赖，保留生产依赖
RUN npm prune --omit=dev

# 生产阶段镜像
FROM node:20-alpine
WORKDIR /app
# 复制运行所需文件与依赖
COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
