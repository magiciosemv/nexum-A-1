# Nexum Protocol — 已知问题记录

## 1. settle_atomic 栈溢出（严重程度：HIGH）

**文件**: programs/nexum_pool/src/instructions/settle_atomic.rs
**问题**: `try_accounts` 栈帧 7808 字节，handler 栈帧 5504 字节。BPF 栈限制 4096 字节。
**已尝试**: SettleAtomicParams 从 [u8;N] → Vec<u8> → Box<[u8;N]>，栈帧从更高降到 5504，仍超限。
**根因**: Anchor 的 `try_accounts` 反序列化过程会把 Box 内的内容展开到栈上（Anchor 框架限制）。
**影响**: .so 可以编译，但链上执行 settle_atomic 时可能 runtime crash。
**可能的解决方案**（按优先级）:
1. 拆分 settle_atomic 为多个 CPI 调用（verify_proof_a → verify_proof_b → settle）
2. 减少 SettleAtomicParams 的大小（压缩 proof 数据）
3. 使用零拷贝（ZeroCopy）账户（Anchor 的 AccountLoader）
4. 手动解析 instruction data 而不用 Anchor 的自动反序列化
**当前状态**: 编译有 warning 但不阻塞。链上行为未知 — 需实际部署测试。

## 2. BGS 范围扩展后的扩展坐标异常点（严重程度：MEDIUM）

**文件**: sdk/src/crypto/bsgs.ts
**问题**: 扩展坐标加法在某些点对会出现 Z=0 的异常情况（概率约 1/p），导致 modInverse 失败。
**缓解**: 已添加仿射算术回退逻辑（Law 1 + Law 2 + 标量乘法兜底）。
**影响**: 极少数情况下解密会走慢路径（标量乘法），但结果正确。

## 3. anchor test 无法完整运行（严重程度：MEDIUM）

**原因**: tests/nexum-protocol.ts 是 anchor init 生成的模板，引用不存在的 nexumProtocol 程序。
**解决**: 需要重写测试文件或用 E2E 测试替代。
**当前**: E2E 离线测试 7/7 通过，但没有链上集成测试。

## 4. Oracle 链上交互是轮询模式（严重程度：LOW）

**问题**: 设计要求 WebSocket 事件监听，实际用轮询（nonce 0..N 逐个查）。
**原因**: 黑客松时间限制，WebSocket 集成复杂度高。
**影响**: 演示可用，但实时性差。

## 5. ZKey 文件 33MB（严重程度：LOW）

**问题**: circuit_0001.zkey 复制到 app/public/ 后 33MB，浏览器加载慢。
**缓解**: 设计文档提到"压缩后约 500KB"，但未实现压缩。
**影响**: 首次加载需要下载 33MB。
