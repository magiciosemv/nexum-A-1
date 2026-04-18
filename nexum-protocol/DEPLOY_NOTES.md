# Nexum Protocol — 部署注意事项

## 重新编译（安全修复后必须）

上次编译的 .so 文件不包含安全修复。部署前必须重新编译：

```bash
# Docker 编译（WSL2 环境推荐）
docker run -v $(pwd):/workspace -w /workspace postgres:17.5 bash -c '
  apt-get update && apt-get install -y curl build-essential pkg-config libssl-dev &&
  cargo-build-sbf --manifest-path programs/nexum_pool/Cargo.toml &&
  cargo-build-sbf --manifest-path programs/zk_verifier/Cargo.toml &&
  cargo-build-sbf --manifest-path programs/audit_gate/Cargo.toml
'
```

## Program IDs

| Program | Program ID |
|---------|-----------|
| nexum_pool | BpsDqXMPwPz8rpktTec4cnpCtxxj7J1nsU8F45KLVrEN |
| zk_verifier | EArRMxL5MSNTXRt4D9wv5MfrXYifhUSzAXbUiaqKMt3U |
| audit_gate | 6eDHCsfJxJxJyXvtoccuzrbHuHb8PZ21cVeppphC3Xem6H |

## Devnet 部署命令

```bash
solana config set --url devnet
solana airdrop 2  # 获取 SOL（可能需要多次）

solana program deploy target/deploy/zk_verifier.so \
  --program-id EArRMxL5MSNTXRt4D9wv5MfrXYifhUSzAXbUiaqKMt3U \
  --url devnet

solana program deploy target/deploy/nexum_pool.so \
  --program-id BpsDqXMPwPz8rpktTec4cnpCtxxj7J1nsU8F45KLVrEN \
  --url devnet

solana program deploy target/deploy/audit_gate.so \
  --program-id 6eDHCsfJxJxJyXvtoccuzrbHuHb8PZ21cVeppphC3Xem6H \
  --url devnet
```

## 安全修复清单（已完成）

- [x] C1: settle_atomic 不再丢弃 ZK 证明验证结果
- [x] C2: deposit/withdraw 验证 token_program 为真正的 SPL Token
- [x] C3: deposit/withdraw 验证 mint 与 ledger 匹配
- [x] C4: deposit/withdraw 验证 token accounts 所有权
- [x] H2/H3: audit_gate 所有指令验证 PDA seeds
- [x] H4: nexum_pool 验证 zk_verifier program ID
