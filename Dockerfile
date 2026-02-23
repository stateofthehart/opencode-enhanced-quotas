FROM node:22-alpine

WORKDIR /app

# Copy built files
COPY dist/ ./dist/
COPY package.json ./

# Install production dependencies only
RUN npm install --production

# Environment variables for provider keys
ENV CEREBRAS_API_KEY=""
ENV FIREWORKS_API_KEY=""
ENV OPENROUTER_API_KEY=""
ENV MISTRAL_API_KEY=""
ENV TOGETHER_API_KEY=""
ENV DEEPINFRA_API_KEY=""
ENV CLOUDFLARE_WORKERS_AI_API_KEY=""
ENV NVIDIA_NIM_API_KEY=""
ENV HF_API_KEY=""

EXPOSE 3000

CMD ["node", "dist/cli.js", "serve", "--host", "0.0.0.0", "--port", "3000"]
