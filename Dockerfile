# Staging context layout (created by scripts/fly-deploy.sh):
#   .fly-context/
#     Dockerfile  fly.toml
#     falseworld/ …
#     resuma/ …

FROM rust:1.91-bookworm AS builder
WORKDIR /workspace

COPY resuma/Cargo.toml resuma/Cargo.lock resuma/README.md ./resuma/
COPY resuma/crates/resuma-macros ./resuma/crates/resuma-macros
COPY resuma/crates/resuma ./resuma/crates/resuma
COPY resuma/client-sdk ./resuma/client-sdk
RUN python3 - <<'PY'
from pathlib import Path
import re
p = Path("resuma/Cargo.toml")
t = p.read_text()
t2, n = re.subn(
    r"members\s*=\s*\[[^\]]*\]",
    'members = [\n    "crates/resuma-macros",\n    "crates/resuma",\n]',
    t,
    count=1,
    flags=re.S,
)
if n != 1:
    raise SystemExit(f"failed to patch resuma workspace members (n={n})")
p.write_text(t2)
PY

COPY falseworld/Cargo.toml falseworld/Cargo.lock ./falseworld/
COPY falseworld/crates/falseworld-core ./falseworld/crates/falseworld-core
COPY falseworld/crates/falseworld-wgpu/Cargo.toml ./falseworld/crates/falseworld-wgpu/Cargo.toml
COPY falseworld/src ./falseworld/src
COPY falseworld/static ./falseworld/static
COPY falseworld/public ./falseworld/public

RUN mkdir -p ./falseworld/crates/falseworld-wgpu/src \
    && printf 'fn main() {}\n' > ./falseworld/crates/falseworld-wgpu/src/main.rs \
    && printf '// stub lib for docker web image\n' > ./falseworld/crates/falseworld-wgpu/src/lib.rs

WORKDIR /workspace/falseworld
RUN cargo build --release -p falseworld --bin falseworld

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home falseworld

WORKDIR /app
COPY --from=builder /workspace/falseworld/target/release/falseworld /app/falseworld
COPY --from=builder /workspace/falseworld/public /app/public
COPY --from=builder /workspace/falseworld/src/pages /app/pages
RUN chown -R falseworld:falseworld /app

USER falseworld

ENV RESUMA_ENV=production
ENV RESUMA_ADDR=0.0.0.0:8080
ENV RESUMA_TRUST_PROXY=1
ENV RESUMA_TRUSTED_PROXY_CIDRS=fdaa::/16
ENV RESUMA_PUBLIC_DIR=/app/public
ENV RESUMA_PAGES_ROOT=/app/pages

EXPOSE 8080
CMD ["/app/falseworld"]
