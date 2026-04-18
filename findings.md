# 发现与决策 — Nexum Protocol

## 需求
- Colosseum Frontier 黑客松 ZK 赛道项目
- Solana 上基于 Baby Jubjub 加密余额池的机构合规暗池 OTC 结算协议
- 从零到 Devnet 完整演示
- 核心演示绝杀：浏览器 3 秒生成 Groth16 证明 → 单笔交易 ≈196,400 CU 完成双证明链上验证

## 环境检查结果
| 工具 | 要求版本 | 实际版本 | 兼容性 |
|------|---------|---------|--------|
| Node.js | >= 20.0.0 | v20.20.0 | OK |
| Rust | 1.79.0 | 1.92.0 | OK（更新版本） |
| Solana CLI | 1.18.x | 2.0.0 | 需验证（大版本差异） |
| Anchor CLI | 0.30.1 | 0.32.1 | 需验证（小版本差异） |
| Circom | 2.1.9 | 2.2.3 | OK |
| snarkjs | 0.7.4 | 0.7.6 | OK |

## 技术决策
| 决策 | 理由 |
|------|------|
| 使用当前安装的工具版本 | 版本差异可控，如遇兼容性问题再降级 |
| TEE 预言机使用本地模拟版 | 黑客松不需要完整 AWS Nitro Enclave |
| 按实施文档严格顺序执行 | 模块间有硬依赖：电路产出 → 验证密钥 → 合约 → SDK → 前端 |
| 放弃 P7 agent 委派 | 3 个 agent 全部失败（API 429 / 无写入权限），手动编写更可靠 |
| 先完成代码再解决编译 | WSL2 编译问题是环境问题非代码问题，优先产出可编译的代码 |

## 架构要点
- **隐私层**：Baby Jubjub ElGamal（BN254 同域，电路约束可控）
- **ZK 电路**：balance_transition.circom，≈12,778 约束，Powers of Tau size 15
- **合约架构**：3 个 Anchor 程序（nexum_pool, audit_gate, zk_verifier）
- **SDK 架构**：双 Worker（CryptoWorker + ProverWorker），主线程零阻塞
- **CU 预算**：settle_atomic ≈ 198,000 CU（400,000 上限，余量充足）
- **隔离账本**：每用户每资产独立 PDA，解决并发写锁问题

## 遇到的问题

### 问题 1：WSL2 下 anchor build SIGSEGV
- **现象：** 编译 proc-macro2/syn/anchor-syn 时 Solana rustup toolchain (rustc) 崩溃
- **尝试：** RUST_MIN_STACK=16/32/64MB, --jobs 1/2/4, rm -rf target — 全部无效
- **根因：** WSL2 下 Solana custom toolchain 不稳定，非代码问题
- **解决方案：** 需要在原生 Linux 或 Mac 环境编译，或升级 Solana toolchain
- **影响：** 阶段 8 被阻塞

### 问题 2：cargo-build-sbf edition2024 错误
- **现象：** platform-tools v1.41 的 rustc 1.75.0 编译 toml_datetime 时要求 edition2024
- **根因：** Solana BPF platform-tools 中的 Rust 编译器版本太旧
- **解决方案：** 升级 platform-tools（`--force-tools-install`）或换环境
- **影响：** 同问题 1，阶段 8 被阻塞

### 问题 3：P7 subagent 全部失败
- **现象：** 3 个 P7 subagent（ZK 电路 / Anchor 合约 / TypeScript SDK）全部失败
- **原因：** API 429 rate limit / agent 无 Bash 写入权限
- **解决方案：** 放弃 agent 委派，手动直接编写全部代码
- **影响：** 进度变慢但代码质量更可控

### 问题 4：版本兼容性待验证
- **现象：** Solana CLI 2.0.0 vs 文档要求 1.18.x，Anchor 0.32.1 vs 0.30.1
- **风险：** alt_bn128 syscall API 可能有差异，Anchor 宏语法可能变化
- **解决方案：** 编译时根据错误调整，必要时降级
- **影响：** 阶段 8 编译时可能暴露

## 待验证事项
1. circomlib 2.0.5 中 Baby Jubjub 相关模板名是否与代码一致
2. @noble/curves twistedEdwards Baby Jubjub 参数配置是否正确
3. Anchor 0.32.1 API 与代码中使用的 0.30.1 API 是否兼容
4. Solana 2.0.0 alt_bn128 syscall 与 1.18.x 行为差异
5. settle_atomic 198,000 CU 估算在 Solana 2.0.0 下是否仍然成立

## Skill × 模块映射
| 模块 | Skills |
|------|--------|
| ZK 电路 | `software-crypto-web3`, `rust-pro` |
| Anchor 合约 | `solana-dev`, `rust-pro`, `systems-programming-rust-project`, `solana-vulnerability-scanner` |
| TypeScript SDK | `software-crypto-web3`, `solana-dev`, `solana-kit`, `vercel-react-best-practices` |
| 前端 UI | `frontend-design`, `tailwind-css`, `vercel-react-best-practices`, `solana-dev` |
| TEE 预言机 | `rust-pro`, `systems-programming-rust-project`, `software-crypto-web3` |
| 测试部署 | `solana-dev`, `solana-vulnerability-scanner`, `code-review-excellence` |

## 资源
- 设计文档：`/home/magic/Nexum-hackathon/Nexum Protocol — 黑客松设计文档.md`
- 实施文档：`/home/magic/Nexum-hackathon/nexum-实施方案文档-a.md`
- Skill 映射：`/home/magic/.claude/projects/-home-magic-Nexum-hackathon/memory/nexum-skill-mapping.md`

---
*每次工作前读取此文件刷新上下文*
