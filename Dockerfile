# There is no dependency install step, because there are no dependencies.
FROM node:22-alpine

WORKDIR /app
COPY . .

# node:sqlite writes here; mount a volume to keep stock data between restarts
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV PORT=8080 DATA_DIR=/app/data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
