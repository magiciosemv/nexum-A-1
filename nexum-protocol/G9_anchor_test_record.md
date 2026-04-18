# G9: Anchor Test 集成验证记录

## 环境信息
- **anchor-cli**: 0.32.1
- **solana-test-validator**: 2.0.0 (Agave)
- **rust-toolchain**: 1.89.0 (Solana SBF target)
- **日期**: 2026-04-17

## 编译结果

### 成功编译的程序 (3/3)
| 程序 | 状态 | 备注 |
|------|------|------|
| zk_verifier | PASS | 无警告 |
| audit_gate | PASS | 无警告 |
| nexum_pool | WARN | settle_atomic 存在栈溢出警告（见下文） |

### nexum_pool 栈溢出警告
`settle_atomic` 函数的两个内部函数超过了 BPF 最大栈偏移 4096 字节：

1. `SettleAtomic::try_accounts` — 栈帧 7808 字节（超出 2784 字节）
2. `settle_atomic` 指令处理函数 — 栈帧 5504 字节（超出 1192 字节）

**影响**: 程序可以编译为 .so，但链上执行 settle_atomic 时可能因栈溢出导致 runtime crash。

**修复建议**:
- 将 settle_atomic 的大结构体改为 Box<> 堆分配
- 拆分 try_accounts 为多个辅助函数
- 减少 settle_atomic_params 中的内联数组大小

### SBF 编译器 SIGSEGV 问题
首次使用 `--skip-deploy` 时 `cargo-build-sbf` 编译 nexum_pool 触发 SIGSEGV（信号 11）。
设置 `RUST_MIN_STACK=16777216` 后编译成功。这是 Solana 工具链已知问题。

## 测试结果

### E2E 测试 (离线模式) — 7/7 PASS
```
npx ts-mocha -p tsconfig.json -t 1000000 tests/e2e/settle_atomic.ts

  Key Generation
    ✔ should generate sender and receiver keypairs
  Balance Encryption (hi/lo split)
    ✔ should correctly split and recombine 64-bit amounts
  Settlement Math
    ✔ should compute balance transitions correctly
  Ciphertext Serialization
    ✔ should serialize/deserialize all ciphertexts in settlement flow
  Program IDL Validation
    ✔ should have valid IDL for all three programs
    ✔ settle_atomic should have correct account structure
  Full Settlement Pipeline (Off-Chain)
    ✔ should execute the complete settlement flow end-to-end

  7 passing (2s)
```

### anchor test（完整模式）— FAIL
`anchor test` 运行 `tests/**/*.ts` 匹配到默认样板测试 `nexum-protocol.ts`，该文件：
- 引用不存在的程序 `nexumProtocol`（实际程序名为 nexum_pool / audit_gate / zk_verifier）
- 调用不存在的 `initialize()` 方法（实际为 `initialize_pool`）
- 导致 `Failed to find IDL of program nexumProtocol` 错误

**修复建议**: 删除或修正 `tests/nexum-protocol.ts`，或修改 Anchor.toml 的 test script glob 排除该文件。

## anchor test 尝试记录

### 尝试 1: `anchor test`（默认 surfpool validator）
- 结果: RPC response error -32601: Method not found
- 原因: surfpool 默认 validator 与 anchor test 的 RPC 调用不兼容

### 尝试 2: `anchor test --validator legacy`
- 结果: port 8899 already in use
- 原因: 之前的 solana-test-validator 进程未清理

### 尝试 3: 杀掉旧进程后 `anchor test --validator legacy`
- 结果: 编译成功，但测试因 nexum-protocol.ts 样板测试失败
- 编译: 3/3 程序编译成功（nexum_pool 有栈溢出警告）
- 单元测试: 3/3 程序 Rust 单元测试通过
- 集成测试: 失败（样板测试引用错误程序名）

### 尝试 4: 直接运行 e2e 测试
- `npx ts-mocha -p tsconfig.json -t 1000000 tests/e2e/settle_atomic.ts`
- 结果: **7/7 PASS**

## 结论

1. **工具链完整**: anchor 0.32.1 + solana-test-validator 2.0.0 均已安装
2. **编译通过**: 所有 3 个 Anchor 程序均可编译为 .so（nexum_pool 有需修复的栈溢出警告）
3. **E2E 测试全通过**: 7 个测试全部通过，验证了密钥生成、加密、解密、序列化、IDL 结构的正确性
4. **链上测试受阻**: 默认样板测试 `nexum-protocol.ts` 引用了错误的程序名，阻止 anchor test 完整通过

## 推荐下一步

1. **删除/修正** `tests/nexum-protocol.ts`（删除样板代码或改为正确的 initialize_pool 调用）
2. **修复 nexum_pool 栈溢出**: 在 settle_atomic 中使用 Box<> 或拆分大函数
3. **编写链上集成测试**: 在 tests/ 下添加真正的 deposit → settle_atomic → withdraw 端到端测试
4. **设置 RUST_MIN_STACK**: 在 CI/CD 中设置 `export RUST_MIN_STACK=16777216` 避免 SBF 编译器 SIGSEGV
