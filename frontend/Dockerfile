FROM node:22-alpine

WORKDIR /app

# 安装 yarn
RUN npm install -g yarn --force

COPY .yarnrc package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["yarn", "dev", "--", "--host", "0.0.0.0"]
