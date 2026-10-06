FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir data && chown node:node data
COPY server ./server
COPY public ./public
COPY scripts ./scripts
ENV HOST=0.0.0.0 PORT=8761
USER node
EXPOSE 8761
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8761/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
