FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
