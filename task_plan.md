# 任务计划：Nexum Protocol 黑客松 MVP

## 目标
从零构建 Nexum Protocol — Solana 上基于 Baby Jubjub 加密余额池的机构合规暗池 OTC 结算协议，完成 Devnet 部署和完整演示流程。

## 当前阶段
阶段 8（集成测试与部署）— 阶段 0-7 代码已写完，SBF 编译通过，SDK 测试通过

## 总体进度
| 阶段 | 代码 | 编译 | 测试 | 状态 |
|------|------|------|------|------|
| 0. 环境准备 | done | n/a | n/a | complete |
| 1. ZK 电路 | done | done | done | complete |
| 2. zk_verifier | done | done | todo | compiled |
| 3. nexum_pool | done | done | todo | compiled |
| 4. audit_gate | done | done | todo | compiled |
| 5. SDK | done | n/a | done | tested |
| 6. 前端 | done | n/a | todo | code_done |
| 7. 预言机 | done | todo | n/a | code_done |
| 8. 集成测试 | in_progress | done | todo | in_progress |
| 9. 安全审查 | todo | n/a | todo | pending |

## 各阶段

### 阶段 0：环境准备与项目初始化
- [x] 检查开发环境版本兼容性（Rust/Solana/Anchor 版本差异处理）
- [x] 初始化 Anchor 工作区（`anchor init nexum-protocol`）
- [x] 创建目录结构（circuits/sdk/app/oracle/tests）
- [x] 创建额外的 Anchor 程序（audit_gate, zk_verifier）
- [x] 配置根 package.json（monorepo）、Anchor.toml、Cargo.toml（workspace）
- [ ] 下载 Powers of Tau（Phase 1）— build.sh 自动下载
- [x] anchor keys sync 同步 Program IDs
- **状态：** complete（环境就绪，编译环境待修复）
- **Skills：** `systems-programming-rust-project`

### 阶段 1：ZK 电路（circuits/）
- [x] 安装 circomlib 依赖（package.json: circomlib 2.0.5）
- [x] 编写 balance_transition.circom（179行：ElGamalVerify + BalanceTransition + 30 公开输入）
- [x] 编写编译脚本 build.sh（54行：编译→约束检查→trusted setup→导出vkey）
- [x] 编译电路，验证约束数（实际 64,970，高于预估 12,778）
- [x] 执行 Phase 2 可信设置（groth16 setup + contribute）
- [x] 导出验证密钥（verification_key.json）
- [x] 编写电路单元测试（5 个测试用例）
- [x] 运行测试通过
- **状态：** code_done（代码完成，需编译验证）
- **Skills：** `software-crypto-web3`, `rust-pro`
- **关键文件：** `circuits/src/balance_transition.circom`, `circuits/build.sh`

### 阶段 2：Anchor 合约 — zk_verifier
- [x] 实现 zk_verifier/src/lib.rs（131行：Groth16 验证，alt_bn128 syscall）
- [x] 实现 negate_g1 辅助函数（BN254 基域素数减法）
- [x] 编写验证密钥硬编码占位模块（vk 模块，待 trusted setup 后填充）
- [x] 编写 gen_vk_rs.js 脚本（从 verification_key.json 生成 Rust 常量）
- [x] 单元测试验证逻辑
- [x] anchor build 编译通过（SBF, Docker cargo-build-sbf）
- **状态：** code_done（代码完成，vk 待填充，需编译）
- **Skills：** `solana-dev`, `rust-pro`
- **关键文件：** `programs/zk_verifier/src/lib.rs`

### 阶段 3：Anchor 合约 — nexum_pool
- [x] 实现状态定义（ProtocolConfig, UserLedger, SettlementRecord, LedgerStatus）
- [x] 实现 errors.rs（NexumError 枚举，10 个错误码）
- [x] 实现 constants.rs（PDA seed 常量）
- [x] 实现 initialize_pool 指令
- [x] 实现 create_user_ledger 指令
- [x] 实现 deposit 指令（框架）
- [x] 实现 settle_atomic 指令（294行：双证明验证 + 金额一致性 + 原子更新）
- [x] 实现 withdraw 指令（框架）
- [x] 实现 lib.rs 指令路由（5 个指令）
- [ ] 实现 emergency_recover 指令（设计文档中有，代码未实现）
- [x] anchor build 编译通过（SBF, Docker cargo-build-sbf）
- **状态：** compiled（SBF 编译通过，settle_atomic 有栈溢出警告待优化）
- **Skills：** `solana-dev`, `rust-pro`, `systems-programming-rust-project`
- **关键文件：** `programs/nexum_pool/src/instructions/settle_atomic.rs`（核心）

### 阶段 4：Anchor 合约 — audit_gate
- [x] 实现状态定义（AuditorRegistry, AuditLog）
- [x] 实现 initialize_registry 指令
- [x] 实现 register_auditor 指令
- [x] 实现 revoke_auditor 指令
- [x] 实现 request_audit 指令
- [x] 实现 lib.rs（195行，单文件完整实现）
- [x] anchor build 编译通过（SBF, Docker cargo-build-sbf）
- **状态：** compiled
- **Skills：** `solana-dev`, `rust-pro`
- **关键文件：** `programs/audit_gate/src/lib.rs`

### 阶段 5：TypeScript SDK（sdk/）
- [x] 配置 package.json + tsconfig.json + jest.config.js
- [x] 实现 crypto/elgamal.ts（124行：Baby Jubjub ElGamal 加密 + 序列化）
- [x] 实现 crypto/bsgs.ts（76行：BSGS 查找表 + 解密）
- [x] 实现 crypto/keys.ts（密钥派生）
- [x] 实现 crypto/utils.ts（writeBigInt32LE, readBigInt32LE, splitU64, combineHiLo）
- [x] 实现 workers/CryptoWorker.ts（77行：BSGS 预热 + 加密 + 新密文计算）
- [x] 实现 workers/ProverWorker.ts（88行：WASM 加载 + Groth16 证明生成）
- [x] 实现 types/index.ts（类型定义）
- [x] 实现 index.ts（SDK 主入口 + 导出）
- [x] 编写单元测试（elgamal.test.ts, bsgs.test.ts）
- [x] 所有测试通过（15/15 GREEN）
- **状态：** code_done（代码完成，需测试）
- **Skills：** `software-crypto-web3`, `solana-dev`, `solana-kit`
- **关键文件：** `sdk/src/crypto/elgamal.ts`, `sdk/src/workers/ProverWorker.ts`

### 阶段 6：前端 UI（app/）
- [x] 初始化 Next.js 项目，配置 WASM 支持（next.config.js）
- [x] 实现 components/TerminalWindow.tsx（黑底绿字终端组件）
- [x] 实现 components/LedgerView.tsx（余额展示组件）
- [x] 实现 pages/index.tsx（首页 + 钱包连接 + 导航）
- [x] 实现 pages/settle.tsx（176行：结算界面 + Worker 管理 + 实时日志）
- [x] 实现 pages/audit.tsx（审计申请界面 + 管辖权选择）
- [x] 钱包连接集成（@solana/wallet-adapter-react）
- [ ] 端到端流程可运行（依赖 SDK + 合约部署）
- [ ] 实现 hooks/useWorkers.ts（Worker 管理 Hook，settle.tsx 中内联了，可抽离）
- **状态：** code_done（代码完成，需联调）
- **Skills：** `frontend-design`, `tailwind-css`, `vercel-react-best-practices`
- **关键文件：** `app/src/pages/settle.tsx`

### 阶段 7：TEE 审计预言机（oracle/）— 演示版
- [x] 实现 oracle/src/main.rs（演示框架：轮询模式占位）
- [x] 编写 Cargo.toml（solana-client, solana-sdk 等依赖）
- [ ] 实现 oracle/src/decrypt.rs（Baby Jubjub BSGS 解密逻辑）
- [ ] 编写 start_oracle_demo.sh 启动脚本
- [ ] 本地编译通过
- **状态：** code_done（演示框架完成，解密逻辑待实现）
- **Skills：** `rust-pro`, `software-crypto-web3`
- **关键文件：** `oracle/src/main.rs`

### 阶段 8：集成测试与部署
- [x] 修复编译环境（WSL2 anchor build SIGSEGV → Docker postgres+aliyun mirror）
- [x] 编译电路 → trusted setup → 导出验证密钥
- [x] 填充 zk_verifier 验证密钥
- [x] anchor build 三个合约编译通过（Docker cargo-build-sbf）
- [x] 编写端到端测试 tests/e2e/settle_atomic.ts（7/7 通过）
- [ ] anchor test 通过
- [x] 编写部署脚本 deploy_devnet.sh
- [x] 编写协议初始化脚本 init_protocol.ts
- [ ] Devnet 部署成功
- [x] 编写演示检查脚本 pre_demo_check.sh
- **状态：** pending（阻塞于编译环境）
- **Skills：** `solana-dev`, `solana-vulnerability-scanner`, `code-review-excellence`
- **关键文件：** `tests/e2e/settle_atomic.ts`, `scripts/deploy_devnet.sh`

### 阶段 9：安全审查与收尾
- [ ] solana-vulnerability-scanner 全量扫描合约
- [ ] code-review-excellence 审查核心模块
- [ ] 修复发现的安全问题
- [ ] 最终验证演示流程
- **状态：** pending
- **Skills：** `solana-vulnerability-scanner`, `code-review-excellence`, `cso`

## 关键阻塞项
1. ~~**WSL2 编译环境**~~ — 已通过 Docker postgres:17.5 + aliyun 镜像源 + cargo-build-sbf 解决
2. ~~**电路编译依赖链**~~ — 已全部完成（电路编译 → trusted setup → VK 填充 → 合约编译）
3. ~~**零测试覆盖**~~ — SDK 15/15 测试通过；合约测试待 anchor test

## 已做决策
| 决策 | 理由 |
|------|------|
| 使用已安装的更新版本工具 | 版本差异不大，API 应向后兼容；如遇问题再降级 |
| 按实施文档顺序全推 | 模块间有严格依赖关系（电路→验证器→合约→SDK→前端） |
| TEE 使用本地模拟版 | 黑客松演示不需要完整 AWS Nitro 部署 |
| 先完成代码再解决编译 | WSL2 编译问题是环境问题非代码问题，优先产出代码 |
| 放弃 P7 agent 委派 | 3 个 agent 全部失败（API 429 / 无写入权限），改为直接编写 |

## 遇到的错误
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
| anchor build: SIGSEGV (proc-macro2/syn/anchor-syn) | 4+ | Docker postgres:17.5 + aliyun mirror + cargo-build-sbf 解决 |
| cargo-build-sbf: edition2024 required | 1 | platform-tools v1.41 rustc 1.75.0 太旧 |
| P7 ZK 电路 agent | 1 | API 429 rate limit，失败 |
| P7 Anchor 合约 agent | 1 | 无 Bash 写入权限，失败 |
| P7 TypeScript SDK agent | 1 | 无 Bash 写入权限，失败 |
| **决策：全部代码直接手动编写** | - | 绕过 agent 问题，代码质量可控 |

## 备注
- 设计文档：`Nexum Protocol — 黑客松设计文档.md`
- 实施文档：`nexum-实施方案文档-a.md`
- Skill 映射：`memory/nexum-skill-mapping.md`
- 源文件总数：59 个（不含 node_modules）
- 做重大决策前重新读取此计划
- 记录所有错误，避免重复
