# Deployment

Three production-grade deployment recipes for BrowseFleet. Pick the one that matches your budget and concurrency needs.

> The public GHCR image (`ghcr.io/therjmurray/browsefleet:latest`) referenced in every recipe lands as part of Phase 3 of the OSS arc. Until then, build the image yourself: `docker build -t browsefleet:local .` from the repo root, then substitute `browsefleet:local` for the GHCR tag in any recipe.

## Resource sizing

Chrome with `STEALTH_DEFAULT=full` wants 200 to 500 MB of RAM per active session under load. The Node process itself is ~150 MB.

| Concurrent sessions | Recommended RAM | Recommended vCPU |
|---------------------|-----------------|------------------|
| 5 | 2 GB | 1 |
| 10 | 4 GB | 2 |
| 30 | 12 GB | 4 |
| 50+ | 24 GB+ | 8+ |

Always run with `--shm-size=2g` (Docker) or ensure `/dev/shm` is at least 2 GB. Chrome crashes silently under memory pressure on the default 64 MB.

## Recipe 1: Hetzner CX22 + docker-compose

Roughly $4/month for ~10 concurrent sessions. The most cost-effective path. Hetzner's smallest x86 VPS, Ubuntu 24.04, docker-compose.

### 1. Provision

Hetzner Cloud → New Project → Add Server.

- Image: Ubuntu 24.04
- Type: CX22 (2 vCPU, 4 GB RAM, 40 GB disk)
- Network: enable IPv4 and IPv6
- SSH key: add yours

### 2. Install Docker

```bash
ssh root@<server-ip>
apt update && apt install -y docker.io docker-compose-plugin
systemctl enable --now docker
```

### 3. Create the compose file

```yaml
# /opt/browsefleet/docker-compose.yml
services:
  browsefleet:
    image: ghcr.io/therjmurray/browsefleet:latest
    container_name: browsefleet
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"   # bind to loopback, proxy with caddy or nginx
    shm_size: 2gb
    environment:
      API_KEYS: "${BF_API_KEYS}"
      MAX_CONCURRENT_SESSIONS: "10"
      STEALTH_DEFAULT: "full"
      LOG_LEVEL: "info"
      CDP_EXTERNAL_HOST: "${BF_PUBLIC_HOST}"
      CDP_EXTERNAL_SCHEME: "wss"
    volumes:
      - browsefleet-data:/app/data
volumes:
  browsefleet-data:
```

```bash
# /opt/browsefleet/.env
BF_API_KEYS=<generate-three-32-char-random-strings-comma-separated>
BF_PUBLIC_HOST=bf.yourdomain.com
```

### 4. Terminate TLS in front

Caddy is one line:

```caddyfile
# /etc/caddy/Caddyfile
bf.yourdomain.com {
    reverse_proxy localhost:3000
}
```

### 5. Start

```bash
cd /opt/browsefleet
docker compose up -d
docker compose logs -f
```

Verify: `curl -H "x-api-key: <one-of-your-keys>" https://bf.yourdomain.com/health`.

### 6. Updates

```bash
docker compose pull && docker compose up -d
```

## Recipe 2: Fly.io

Roughly $15/month for ~20 concurrent sessions. Easier than the VPS path; Fly handles TLS, restarts, regional routing.

### 1. Install flyctl

```bash
curl -L https://fly.io/install.sh | sh
flyctl auth signup    # or: flyctl auth login
```

### 2. Create `fly.toml`

```toml
app = "browsefleet-yourname"
primary_region = "iad"

[build]
  image = "ghcr.io/therjmurray/browsefleet:latest"

[env]
  MAX_CONCURRENT_SESSIONS = "20"
  STEALTH_DEFAULT = "full"
  LOG_LEVEL = "info"
  CDP_EXTERNAL_SCHEME = "wss"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"   # keep the machine warm
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "performance-2x"      # 2 vCPU, 4 GB RAM
  memory_mb = 4096

[[mounts]]
  source = "browsefleet_data"
  destination = "/app/data"
```

The image's `CMD` already runs the server, so no `cmd` override is needed.

### 3. Create the persistent volume

```bash
flyctl volumes create browsefleet_data --region iad --size 1
```

### 4. Set secrets and CDP host, then deploy

```bash
flyctl secrets set \
  API_KEYS=<comma-separated-keys> \
  CDP_EXTERNAL_HOST=browsefleet-yourname.fly.dev
flyctl deploy
```

### 5. Verify

```bash
curl -H "x-api-key: <key>" https://browsefleet-yourname.fly.dev/health
```

Note: Fly's default `--shm-size` is small. The image's startup script bind-mounts a tmpfs to `/dev/shm`; if you see Chrome crashes, increase the VM size or open an issue.

## Recipe 3: AWS ECS Fargate

Roughly $30/month for ~25 concurrent sessions on one Fargate task. Use when you already have AWS infrastructure or need VPC isolation.

### 1. Push the image to ECR

```bash
aws ecr create-repository --repository-name browsefleet
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <acct>.dkr.ecr.us-east-1.amazonaws.com
docker pull ghcr.io/therjmurray/browsefleet:latest
docker tag ghcr.io/therjmurray/browsefleet:latest <acct>.dkr.ecr.us-east-1.amazonaws.com/browsefleet:latest
docker push <acct>.dkr.ecr.us-east-1.amazonaws.com/browsefleet:latest
```

### 2. Task definition (essentials)

```json
{
  "family": "browsefleet",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "8192",
  "executionRoleArn": "arn:aws:iam::<acct>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "browsefleet",
      "image": "<acct>.dkr.ecr.us-east-1.amazonaws.com/browsefleet:latest",
      "essential": true,
      "portMappings": [{ "containerPort": 3000, "protocol": "tcp" }],
      "environment": [
        { "name": "MAX_CONCURRENT_SESSIONS", "value": "25" },
        { "name": "STEALTH_DEFAULT", "value": "full" },
        { "name": "LOG_LEVEL", "value": "info" }
      ],
      "secrets": [
        { "name": "API_KEYS", "valueFrom": "arn:aws:secretsmanager:...:secret:browsefleet/api-keys" }
      ],
      "linuxParameters": {
        "sharedMemorySize": 2048
      },
      "mountPoints": [{ "containerPath": "/app/data", "sourceVolume": "browsefleet-data" }]
    }
  ],
  "volumes": [
    { "name": "browsefleet-data", "efsVolumeConfiguration": { "fileSystemId": "fs-...", "rootDirectory": "/" } }
  ]
}
```

### 3. Service + ALB

Put the task behind an ALB with a target group on port 3000. Health check path `/health`. TLS terminates at the ALB. `CDP_EXTERNAL_HOST` should be the ALB hostname and `CDP_EXTERNAL_SCHEME=wss`.

### 4. Auto-scaling

Configure target tracking on CPU utilization (target 50%) or on the number of active sessions if you publish a CloudWatch metric for it. Note that each new task starts cold and adds latency on first request, so scale up generously.

## Production checklist (all recipes)

- [ ] `API_KEYS` is set to a non-empty list.
- [ ] `HOST=127.0.0.1` if behind a reverse proxy on the same host, or use a firewall otherwise.
- [ ] TLS terminates somewhere in front of BrowseFleet. Do not expose port 3000 directly to the internet.
- [ ] `CDP_EXTERNAL_HOST` and `CDP_EXTERNAL_SCHEME=wss` match how clients reach the CDP proxy.
- [ ] `LOG_LEVEL=info` (not `debug`, not `trace`).
- [ ] `DATA_DIR` is on a persistent volume.
- [ ] `--shm-size=2g` or equivalent is set.
- [ ] Backups: `data/browsefleet.db` and `data/profiles/` are the only durable state.

## What we deliberately do not offer

- A hosted SaaS version. BrowseFleet is the product; running it is on you. See [ADR-0001](https://github.com/theRJMurray/overlord/blob/development/docs/projects/browsefleet-oss/decisions/ADR-0001-pure-oss-mit.md).
- Kubernetes Helm charts. Out of scope for now; PRs welcome.
- A Terraform module. Same.

## See also

- [Configuration](./configuration.md), every env var.
- [Architecture](./architecture.md), what is being deployed.
- [`SECURITY.md`](../SECURITY.md), responsible disclosure.
