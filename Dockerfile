FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install only production dependencies
RUN npm install --production

# Copy worker source
COPY indexnow-worker.js .

# Environment
ENV NODE_ENV=production

# Run the worker
CMD ["node", "indexnow-worker.js"]
