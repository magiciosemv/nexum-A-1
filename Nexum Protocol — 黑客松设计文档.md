# Nexum Protocol — 黑客松设计文档

## 方案 A：加密余额池 × 单笔双证明

> **版本**：Hackathon MVP v1.0
> **日期**：2026 年 4 月
> **目标赛道**：Colosseum Frontier 黑客松 ZK 赛道
> **核心主张**：Solana 上首个基于 Baby Jubjub 加密余额池的机构合规暗池 OTC 结算协议
> **演示绝杀**：浏览器 3 秒生成 Groth16 证明 → 单笔交易 ≈196,400 CU 完成双证明链上验证 → 池内结算零明文

---

## 目录

1. [我们解决什么问题](#一我们解决什么问题)
2. [核心架构：加密余额池](#二核心架构加密余额池)
3. [完整业务流程](#三完整业务流程)
4. [隐私层：Baby Jubjub ElGamal](#四隐私层-baby-jubjub-elgamal)
5. [ZK 电路：balance_transition.circom](#五zk-电路-balance_transitioncircom)
6. [链上 CU 预算分析](#六链上-cu-预算分析)
7. [合约设计](#七合约设计)
8. [前端架构](#八前端架构)
9. [TEE 审计预言机](#九tee-审计预言机)
10. [链上数据模型](#十链上数据模型)
11. [安全模型](#十一安全模型)
12. [黑客松演示脚本](#十二黑客松演示脚本)
13. [开发任务拆分与时间线](#十三开发任务拆分与时间线)

---

## 一、我们解决什么问题

### 1.1 三重矛盾同时存在

机构在 Solana 进行大额 OTC 结算，同时面对三个无法调和的要求：

**矛盾一：交易意图不能泄露**

机构 A 要用 5000 万 USDC 换 SOL。链上任何意图暴露，MEV 机器人立刻推高价格。5000 万规模的交易，0.3% 滑点就是 15 万美元损失。机构最在意的隐私不是"事后别人看不到我转了多少"，而是"执行前没人知道我要买什么"。

**矛盾二：监管机构必须能够事后审计**

合规部门要求大额交易必须有可审计记录。2022 年 Tornado Cash 被 OFAC 制裁的教训说明，拒绝合规是协议的生存风险，没有机构能使用在监管上无法交代的基础设施。

**矛盾三：不能依赖信任任何中间方**

传统 OTC 交易台（Cumberland、DWF Labs）解决了前两个问题，但引入了新的风险：需要相信对方不跑路、不被黑、不滥用资金。FTX 的崩溃说明"相信对方"本身就是风险。

### 1.2 历史版本的根本错误（v1–v6）

过去六个版本都犯了同一个错误——试图在 SPL Token 明文转账上叠加隐私层：

```
错误的逻辑（v1-v6）：
  链上操作：SPL transfer amount=50,000,000 USDC  ← Solscan 任何人都能看到
  +叠加：   Baby Jubjub 密文                      ← 加密了个寂寞
  +叠加：   Groth16 ZK 证明                       ← 证明了什么？
  +叠加：   TEE 审计预言机                         ← 监管方直接看转账金额就行

结论：给透明玻璃箱配了最贵的密码锁。ZK 和 TEE 是系统中最昂贵却毫无用处的"盲肠"。
```

### 1.3 v7.0 的根本解法

**不做 SPL Token 转账。** 池内结算只更新加密余额密文。

```
正确的逻辑（v7.0）：
  存款：明文 SPL → Nexum Treasury（可见，但此时无任何交易意图）
         ↓
  池内结算：只更新 Baby Jubjub 加密余额密文
           链上无 SPL 转账，无明文金额，外界只看到两个 PDA 的密文字段变了
           ZK 证明：数学保证余额变更合法（守恒、不透支、审计密文准确）
           TEE：监管方通过审计密钥解密，获取明文金额用于合规报告
         ↓
  提款：明文 SPL ← Nexum Treasury（可见，但已无法与任何具体结算对应）
```

现在每个技术组件都有不可替代的真实作用：

| 组件                | 真实作用                                   | 去掉会怎样                         |
| ------------------- | ------------------------------------------ | ---------------------------------- |
| Baby Jubjub ElGamal | 加密链上余额，使余额变化对外不可读         | 余额明文，隐私消失                 |
| Groth16 ZK 证明     | 数学保证余额变更合法，无需信任任何人       | 变成中心化托管，需信任 Nexum 团队  |
| 信号共享约束        | 电路结构保证审计密文与余额守恒使用同一金额 | 审计密文可独立伪造，合规失效       |
| 版本号单调递增      | 每次余额更新 version+1，旧证明永久失效     | 可重放历史证明回滚余额             |
| 隔离用户 Ledger PDA | 每人独立账户，并发结算互不阻塞             | 全局写锁冲突，Solana 并发优势消失  |
| TEE 预言机          | 安全保管审计私钥，执行监管解密             | 审计私钥无处存放，监管通道无法运作 |
| 链上审计日志        | 每次审计申请强制留痕                       | 监管机构可无限静默审计，无法追责   |

### 1.4 与现有方案的真实对比

| 维度                        | 普通 DEX     | Tornado Cash | OTC 交易台 | Token-2022 CB（禁用中） | **Nexum**       |
| --------------------------- | ------------ | ------------ | ---------- | ----------------------- | --------------- |
| 池内结算零明文              | ✗            | ✓            | ✓ 链下     | ✓ 但禁用                | ✓               |
| ZK 电路曲线一致（无跨曲线） | —            | —            | —          | ✗ Curve25519≠BN254      | ✓ 全程 BN254    |
| 合规审计通道                | ✓ 但完全透明 | ✗ 技术不可   | △ 第三方   | △ 不可变密钥            | ✓ ZK 数学保证   |
| 审计行为强制留痕            | —            | —            | —          | ✗ 无日志                | ✓ 链上永久      |
| 无对手方风险                | ✓ 即时       | ✗            | ✗ 信任     | —                       | ✓               |
| 无托管中间方                | ✓            | ✓            | ✗          | ✓                       | ✓ ZK 数学非托管 |
| Solana 当前可用             | ✓            | ✗ 被制裁     | ✓          | ✗ 禁用中                | ✓               |

**Solana 生态调研报告（2026 年 4 月）明确指出三个白色空间，都是 Nexum 的技术核心：**

- "Baby Jubjub 全程自洽方案在 Solana 上无人做"
- "ZK 审计一致性证明——整个生态无人做"
- "审计行为可追溯性机制是合规创新"

---

## 二、核心架构：加密余额池

### 2.1 资金流与信息流分离

```
╔═══════════════════════════════════════════════════════════════════╗
║                       Nexum 加密余额池                             ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  存款（金额可见，但此时无交易意图）                                   ║
║  机构 A 存 5000 万 USDC ──→  A_USDC_Ledger: Enc(5000万, pk_A)    ║
║  机构 B 存 100 万 SOL   ──→  B_SOL_Ledger:  Enc(100万,  pk_B)    ║
║                                                                   ║
║  池内结算（全程零明文，ZK 保证合法性）                                ║
║  A 付 100 万 USDC → B      仅更新两个 Ledger PDA 的密文字段         ║
║  B 付 10 万 SOL  → A       无任何 SPL Token 转账，无任何明文金额     ║
║                            ZK 证明：守恒 + 不透支 + 审计密文准确    ║
║                                                                   ║
║  提款（金额可见，但已无法与具体结算对应）                              ║
║  A 提现 N USDC ──→  Treasury → A 的钱包（N 与任何历史结算无关联）    ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 2.2 为什么存款可见不是问题

存款时机构尚未指定交易对手或价格，外界看到充值行为无法推断任何交易策略。经过池内多次结算后，提款金额与任何单笔历史交易无法对应。这与中心化 OTC 交易台完全一致：机构先打钱进交易台（链上可见），内部结算，最终提现（链上可见）。业界有成熟监管先例。

### 2.3 隔离用户账本：解决 Solana 并发热点

**错误方案（全局账户）**：

```
GlobalPoolState { all_balances: HashMap<Pubkey, Ciphertext> }
→ 100 笔并发结算竞争同一写锁 → 99 笔失败 → 系统吞吐量退化为单线程
```

**正确方案（隔离 Ledger PDA）**：

```
每个用户 × 每种资产 = 一个独立 Ledger PDA

PDA 种子：["ledger", user_pubkey, mint_pubkey]

User_A_USDC_Ledger   User_B_USDC_Ledger   User_C_SOL_Ledger
  balance_ct_lo: C     balance_ct_lo: C     balance_ct_lo: C
  balance_ct_hi: C     balance_ct_hi: C     balance_ct_hi: C
  version: 7           version: 3           version: 5

A↔B 结算：锁 A_USDC_Ledger + B_USDC_Ledger，不影响任何其他账户
C↔D 结算：锁 C_SOL_Ledger  + D_SOL_Ledger，与 A/B 完全并行
Treasury Vault ATA：内部结算完全不触及，无写锁压力
```

### 2.4 系统整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│                           接入层                                  │
│  浏览器 SDK                         REST API（机构 MPC 兼容）       │
│  ├─ CryptoWorker                    ├─ 服务端 ZK 证明生成           │
│  │   Baby Jubjub 加解密              ├─ 服务端余额解密（降级）        │
│  │   BSGS 查找表（4MB，预热）         └─ Fireblocks 集成             │
│  └─ ProverWorker                                                  │
│      snarkjs WASM，Groth16，~3-5s                                 │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│                 Nexum 协议层（Anchor 0.30）                        │
│                                                                   │
│  nexum_pool                        audit_gate                     │
│  ├─ initialize_pool                ├─ register_auditor            │
│  ├─ create_user_ledger             ├─ revoke_auditor              │
│  ├─ deposit                        └─ request_audit               │
│  ├─ settle_atomic  ← 方案 A 核心                                   │
│  ├─ withdraw                       zk_verifier                    │
│  └─ emergency_recover              └─ verify_balance_transition   │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│                  TEE 审计预言机层                                   │
│  AWS Nitro Enclave：保管审计私钥，执行监管密文解密                    │
│  AWS KMS（PCR 绑定）+ DynamoDB（加密持久化）                         │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│               Solana 基础设施层                                     │
│  SPL Token / ATA（仅存提款）  alt_bn128 syscall   SysvarClock      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、完整业务流程

### 3.1 准备阶段：存款

**触发**：机构首次使用，或需要补充暗池额度时。

#### 链下准备（在 CryptoWorker 完成）

```
Step 1: 金额高低位分拆
  deposit_lo = deposit_amount mod 2^32
  deposit_hi = deposit_amount >>> 32

Step 2: 生成初始余额密文（自己的 Baby Jubjub 公钥加密，事后对账用）
  balance_ct_lo = ElGamal_Encrypt(deposit_lo, user_pk, r_bal_lo)
  balance_ct_hi = ElGamal_Encrypt(deposit_hi, user_pk, r_bal_hi)

Step 3: 生成存款审计密文（全局审计公钥加密，监管审计用）
  audit_ct_lo = ElGamal_Encrypt(deposit_lo, audit_pk, r_aud_lo)
  audit_ct_hi = ElGamal_Encrypt(deposit_hi, audit_pk, r_aud_hi)

Step 4: 在 ProverWorker 生成存款 ZK 证明（~3-5 秒）
  证明：新余额密文有效 + 审计密文与存款金额一致 + 余额在合法范围内
  （对于首次存款，旧余额 = 0）
```

#### 链上操作（一笔交易，~150,000 CU）

```
指令：deposit

Step 1: 若无 Ledger PDA → 隐式创建
        PDA 种子：["ledger", user_pubkey, mint_pubkey]

Step 2: CPI 调用 zk_verifier.verify_balance_transition 验证存款证明

Step 3: SPL Token 转账：用户 ATA → Treasury Vault ATA
        ← 此步金额链上可见（已接受的设计取舍，存款时无交易意图）

Step 4: 更新 Ledger PDA
        balance_ct_lo ← 新余额密文低位
        balance_ct_hi ← 新余额密文高位
        version += 1  ← 单调递增，防止旧证明重放

Step 5: 存入审计密文（供事后监管审计存款记录）

emit DepositEvent { user, mint, timestamp }
← 不包含金额，只是时间戳和地址
```

---

### 3.2 核心功能：settle_atomic（方案 A）

这是整个系统的技术核心，也是黑客松演示的高光时刻。

#### 前置条件

双方通过链下渠道（即时通讯、专用 OTC 频道）协商完成：

- 甲方付出什么资产，付出多少
- 乙方付出什么资产，付出多少

Nexum 不提供链上订单发现机制——这是已知的使用场景边界，OTC 本来就是定向点对点交易。

#### Phase 1：双方各自链下独立生成 ZK 证明

**甲方操作（付出方，is_sender = 1）**

```
── CryptoWorker 执行（~100ms）──────────────────────────────────────

Step 1: 解密当前余额（BSGS 算法，预热后约 50ms）
  old_balance = BSGS_decrypt(
    ct_lo = ledger_a.balance_ct_lo,
    ct_hi = ledger_a.balance_ct_hi,
    sk    = user_sk_a
  )

Step 2: 验证余额充足
  assert(old_balance >= transfer_amount, "余额不足")

Step 3: 计算新余额，全部高低位分拆
  new_balance = old_balance - transfer_amount

  old_lo = old_balance     mod 2^32
  old_hi = old_balance     >>> 32
  tra_lo = transfer_amount mod 2^32
  tra_hi = transfer_amount >>> 32
  new_lo = new_balance     mod 2^32
  new_hi = new_balance     >>> 32

Step 4: 生成甲方新余额密文（用甲方公钥加密）
  new_ct_a_lo = ElGamal_Encrypt(new_lo, user_pk_a, r_new_lo)
  new_ct_a_hi = ElGamal_Encrypt(new_hi, user_pk_a, r_new_hi)

Step 5: 生成甲方审计密文（用全局审计公钥加密）
  audit_ct_a_lo = ElGamal_Encrypt(tra_lo, audit_pk, r_aud_lo)
  audit_ct_a_hi = ElGamal_Encrypt(tra_hi, audit_pk, r_aud_hi)

── ProverWorker 执行（~3-5 秒）──────────────────────────────────────

Step 6: 准备 ZK 证明输入

  私有输入（Witness）：
    old_lo, old_hi,           旧余额明文
    tra_lo, tra_hi,           转账金额明文
    new_lo, new_hi,           新余额明文
    r_old_lo, r_old_hi,       旧余额密文的随机数
    r_new_lo, r_new_hi,       新余额密文的随机数
    r_aud_lo, r_aud_hi        审计密文的随机数

  公开输入（链上验证）：
    user_pk_a.x, user_pk_a.y, audit_pk.x, audit_pk.y,
    old_ct_lo（C1x,C1y,C2x,C2y），old_ct_hi（同），  ← 链上读取，不可伪造
    new_ct_a_lo（C1x,C1y,C2x,C2y），new_ct_a_hi（同），
    audit_ct_a_lo（C1x,C1y,C2x,C2y），audit_ct_a_hi（同），
    expected_version = ledger_a.version + 1,           ← 防重放
    is_sender = 1                                      ← 付出方

Step 7: 调用 snarkjs groth16.fullProve，生成 256 字节证明 proof_a

Step 8: 将 proof_a + 新密文 + 审计密文 发给乙方（链下）
```

**乙方操作（接收方，is_sender = 0）**

```
与甲方完全对称，区别：
  new_balance = old_balance + transfer_amount  ← 余额增加
  is_sender = 0                                ← 接收方
  transfer_amount 等于甲方付出的 transfer_amount（双方协商一致）

生成 proof_b + 乙方新密文 + 乙方审计密文
```

#### Phase 2：构造并提交 settle_atomic 交易

任意一方（或专用 Relay 服务）用双方提供的所有数据构造交易并提交：

```
指令名：settle_atomic
ComputeBudget：请求 400,000 CU

必需账户：
  ledger_a        : 甲方 Ledger PDA，可写
  ledger_b        : 乙方 Ledger PDA，可写
  settlement_record: 新建 Settlement PDA，可写
  protocol_config  : 协议配置，只读（提供审计公钥）
  zk_verifier      : ZK 验证程序（CPI 目标）
  system_program

指令参数：
  nonce           : u64       防 Settlement Record 地址冲突
  proof_a         : [u8;256]  甲方 Groth16 证明
  new_ct_a_lo     : [u8;128]  甲方新余额密文低位（C1.xy + C2.xy = 4×32B）
  new_ct_a_hi     : [u8;128]  甲方新余额密文高位
  audit_ct_a_lo   : [u8;128]  甲方审计密文低位
  audit_ct_a_hi   : [u8;128]  甲方审计密文高位
  proof_b         : [u8;256]  乙方 Groth16 证明
  new_ct_b_lo     : [u8;128]
  new_ct_b_hi     : [u8;128]
  audit_ct_b_lo   : [u8;128]
  audit_ct_b_hi   : [u8;128]

总参数体积：2×256 + 8×128 = 512 + 1024 = 1536 字节，在 Solana 交易限制内
```

#### Phase 3：合约内单笔原子执行

```
┌─────────────────────────────────────────────────────────────────┐
│                  settle_atomic 指令执行流程                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Step 1 版本号预检                                               │
│    require(ledger_a.status == Active)  ← 防止已锁定的账本参与结算  │
│    require(ledger_b.status == Active)                           │
│    require(ledger_a.key() != ledger_b.key())  ← 禁止自我结算     │
│                                                                 │
│  Step 2 构造甲方 ZK 公开输入                                      │
│    旧余额密文 old_ct_a ← 从链上 ledger_a 直接读取                 │
│    ← 关键：不接受调用者传入旧密文，防止替换攻击                     │
│    expected_version_a = ledger_a.version + 1                    │
│                                                                 │
│  Step 3 CPI 验证甲方证明                                          │
│    zk_verifier::verify_balance_transition(                      │
│      proof   = proof_a,                                         │
│      pub_ins = [user_pk_a, audit_pk, old_ct_a（链上）,           │
│                 new_ct_a, audit_ct_a, version_a, is_sender=1]   │
│    )                                                            │
│    ✓ 通过 → 继续                                                 │
│    ✗ 失败 → 整笔交易 revert，链上状态完全不变                      │
│                                                                 │
│  Step 4 CPI 验证乙方证明（对称）                                   │
│    zk_verifier::verify_balance_transition(                      │
│      proof   = proof_b,                                         │
│      pub_ins = [user_pk_b, audit_pk, old_ct_b（链上）,           │
│                 new_ct_b, audit_ct_b, version_b, is_sender=0]   │
│    )                                                            │
│    ✓ 通过 → 继续                                                 │
│                                                                 │
│  Step 5 双方金额一致性校验                                         │
│    验证甲方审计密文与乙方审计密文编码了相同的转账金额                 │
│    原理（数学）：                                                 │
│      若 transfer_a == transfer_b，则                            │
│      audit_ct_a.C2 - audit_ct_b.C2 = (r_a - r_b) * audit_pk   │
│    通过 alt_bn128_group_op 链上计算验证此等式                       │
│    ✗ 金额不一致 → revert                                         │
│                                                                 │
│  Step 6 原子更新双方 Ledger PDA                                   │
│    ledger_a.balance_ct_lo = new_ct_a_lo                         │
│    ledger_a.balance_ct_hi = new_ct_a_hi                         │
│    ledger_a.audit_ct_lo   = audit_ct_a_lo  ← 存储供监管审计      │
│    ledger_a.audit_ct_hi   = audit_ct_a_hi                       │
│    ledger_a.version      += 1              ← 旧证明永久失效       │
│    ledger_b.* 同上（用乙方数据）                                   │
│                                                                 │
│  Step 7 创建 Settlement Record PDA（永久存档）                    │
│    内容：甲乙地址、资产 Mint、双方审计密文、双方 ZK 证明、时间戳     │
│    ← 永不包含明文金额                                             │
│    PDA 种子：["settlement", ledger_a.key, nonce.to_le_bytes()]   │
│                                                                 │
│  Step 8 emit SettlementEvent                                    │
│    { settlement_id, initiator, counterparty, timestamp }        │
│                                                                 │
│  整笔交易结果：                                                   │
│    ✓ 成功：双方密文更新，Settlement Record 创建，零明文            │
│    ✗ 失败：所有状态回滚，链上完全无变化                            │
└─────────────────────────────────────────────────────────────────┘
```

---

### 3.3 提款

**链下准备**：

```
Step 1: 解密当前余额（BSGS）
  current = BSGS_decrypt(ledger.balance_ct_lo, ledger.balance_ct_hi, sk)

Step 2: 验证提款金额 <= current

Step 3: 计算提款后余额，生成新密文和 ZK 证明
  is_sender = 1（付出方，余额减少）
  new_balance = current - withdraw_amount
```

**链上操作**：

```
Step 1: CPI 验证提款 ZK 证明
Step 2: 更新 Ledger PDA 余额密文（version += 1）
Step 3: SPL Token 转账：Treasury Vault → 用户 ATA（此步金额可见）
```

---

### 3.4 合规审计（事后可选）

```
1. 监管机构调用 audit_gate.request_audit(settlement_id)
   合约强制：必须指定 settlement_id，无批量查询接口
   链上创建不可删除的 AuditLog PDA（永久留证）
   emit AuditRequestedEvent

2. TEE 预言机监听到事件
   向 AWS KMS 请求审计私钥（凭 PCR 绑定的 Attestation Document）
   Enclave 内 BSGS 解密双方审计密文（4 次，各约 50ms）
   
   甲方付出金额 = init_hi × 2^32 + init_lo
   乙方付出金额 = cp_hi  × 2^32 + cp_lo

3. 用申请机构公钥加密结果，HTTPS 安全通道返回

4. 监管机构本地解密，结合 KYB 数据生成合规报告
   ← 链上的 ZK 证明提供额外的数学完整性背书：
     审计密文准确性有数学保证，不依赖 Nexum 团队诚实
```

---

## 四、隐私层：Baby Jubjub ElGamal

### 4.1 为什么是 Baby Jubjub，而不是 Curve25519

Token-2022 Confidential Balances 使用 **Curve25519**，Circom/Groth16 ZK 电路工作在 **BN254** 曲线上。在 BN254 电路内验证 Curve25519 密文需要非原生域算术（non-native field arithmetic），约束量从数千暴涨到数百万，浏览器端完全不可用。

**Baby Jubjub** 是定义在 BN254 标量域上的扭曲爱德华兹曲线，与 Circom/Groth16 天然同域，电路内所有曲线运算为原生操作，约束量可控。

```
曲线方程：168700·x² + y² = 1 + 168696·x²·y²  (mod p)
基域素数 p：21888242871839275222246405745257275088548364400416034343698204186575808495617
群阶 n：    2736030358979909402780800718157159386076813972158567259200215660948447373041
基点 G：    (995203...652001, 547206...923905)
cofactor：  8
```

### 4.2 ElGamal 加密方案

```
密钥生成：
  sk ← SecureRandom([1, n))          必须使用 crypto.getRandomValues，禁止 Math.random
  pk = sk · G                         椭圆曲线标量乘法

加密 Encrypt(m, pk, r)：
  r  ← SecureRandom([1, n))           每次加密必须使用新的随机数，r 复用会泄露私钥
  C1 = r · G
  C2 = m · G + r · pk
  密文 C = (C1, C2)，每个点含 x, y 坐标各 32 字节 = 共 128 字节

解密 Decrypt((C1, C2), sk)：
  m·G = C2 - sk·C1                    = m·G + r·pk - sk·r·G = m·G
  m   = BSGS(m·G)                     从曲线点还原整数 m
```

### 4.3 加法同态性：余额守恒验证的数学基础

```
Baby Jubjub ElGamal 满足加法同态：

  Enc(a, pk, r_a) ⊕ Enc(b, pk, r_b) = Enc(a + b, pk, r_a + r_b)

证明：
  C1_a + C1_b = r_a·G + r_b·G = (r_a + r_b)·G        ✓
  C2_a + C2_b = a·G + r_a·pk + b·G + r_b·pk
              = (a+b)·G + (r_a+r_b)·pk                ✓
```

这意味着：合约可以在完全不知道明文金额的情况下，通过椭圆曲线点运算验证余额守恒。这是 ZK 电路中余额守恒约束的数学基础——证明者需要向验证者证明新余额密文与旧余额密文/转账金额密文的组合关系正确。

### 4.4 高低位分拆：解决 BSGS 解密可行性

```
原始问题：m ∈ [0, 2^64) → BSGS 需建表 2^32 条 → 内存约 32GB → 不可行

高低位分拆方案：
  lo = amount mod 2^32       ∈ [0, 2^32)   各自独立加密、独立解密
  hi = amount >>> 32         ∈ [0, 2^32)

  每段 BSGS 参数：
    搜索步数：√2^32 ≈ 65,536 步
    建表内存：约 2MB（x 坐标低 64 位作 key，避免完整序列化开销）
    高低位两张表共 4MB，浏览器 Worker 完全可承受

  解密耗时：
    建表（一次性，应用启动时后台预热）：约 200-800ms
    预热后每次 BSGS 搜索：约 10-50ms / 段

  还原完整金额：amount = hi × 2^32 + lo
  最大支持：2^64 - 1 ≈ 1.84 × 10^19（远超任何实际场景）
```

### 4.5 密钥派生与随机数规范

```typescript
// 用户 Baby Jubjub 密钥：从 Solana 钱包签名确定性派生
async function deriveUserKey(wallet: Wallet): Promise<BabyJubKeyPair> {
  const msg = `nexum_user_key_v1_${wallet.publicKey.toBase58()}`;
  const sig = await wallet.signMessage(Buffer.from(msg));
  // HKDF 从签名派生确定性标量
  const skBytes = await hkdf_sha256(sig, "nexum-user-baby-jub-key");
  const sk = BigInt("0x" + buf2hex(skBytes)) % BABY_JUB_ORDER;
  const pk = babyJub.mulPointEscalar(babyJub.Base8, sk);
  return { sk, pk };
}

// 随机数：严格使用 CSPRNG，不可妥协
function secureRandom(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);  // Web Crypto API
  const n = BigInt("0x" + buf2hex(bytes));
  return (n % (BABY_JUB_ORDER - 1n)) + 1n;  // 确保在 [1, n) 内
}
// ESLint 规则禁止 Math.random()，代码审查中作为 blocking issue 强制检查
```

---

## 五、ZK 电路：balance_transition.circom

### 5.1 证明目标

**单方余额从旧状态合法转变为新状态，且转账金额的审计密文与实际转账金额严格一致。**

方案 A 每次结算运行两次此电路（甲方 + 乙方），各自生成 256 字节 Groth16 证明，在 `settle_atomic` 中同时链上验证，单笔交易原子完成。

### 5.2 信号完整定义

#### 私有输入（Witness）

| 信号名                     | 说明                             |
| -------------------------- | -------------------------------- |
| `old_balance_lo`           | 旧余额低 32 位明文               |
| `old_balance_hi`           | 旧余额高 32 位明文               |
| `transfer_lo`              | 转账金额低 32 位明文             |
| `transfer_hi`              | 转账金额高 32 位明文             |
| `new_balance_lo`           | 新余额低 32 位明文               |
| `new_balance_hi`           | 新余额高 32 位明文               |
| `r_old_lo`, `r_old_hi`     | 旧余额密文的随机数（加密时使用） |
| `r_new_lo`, `r_new_hi`     | 新余额密文的随机数               |
| `r_audit_lo`, `r_audit_hi` | 审计密文的随机数                 |

#### 公开输入（30 个，合约直接验证）

| 信号组                               | 个数   | 来源                                 |
| ------------------------------------ | ------ | ------------------------------------ |
| 用户公钥 `user_pkX`, `user_pkY`      | 2      | 从 Ledger.owner 派生                 |
| 审计公钥 `audit_pkX`, `audit_pkY`    | 2      | 从 ProtocolConfig 读取               |
| 旧余额密文低位（C1x, C1y, C2x, C2y） | 4      | 从链上 Ledger **直接读取**，不可替换 |
| 旧余额密文高位（同上）               | 4      | 同上                                 |
| 新余额密文低位（C1x, C1y, C2x, C2y） | 4      | 指令参数传入                         |
| 新余额密文高位（同上）               | 4      | 同上                                 |
| 审计密文低位（C1x, C1y, C2x, C2y）   | 4      | 指令参数传入                         |
| 审计密文高位（同上）                 | 4      | 同上                                 |
| `expected_version`                   | 1      | = 当前 version + 1，防重放           |
| `is_sender`                          | 1      | 1=付出方，0=接收方                   |
| **合计**                             | **30** |                                      |

### 5.3 六类约束的完整电路实现

```circom
pragma circom 2.0.0;

include "node_modules/circomlib/circuits/babyjub.circom";
include "node_modules/circomlib/circuits/bitify.circom";

// ── 子模板：验证单个 ElGamal 密文的合法性 ────────────────────────────
template ElGamalVerify() {
    signal private input m;          // 明文整数
    signal private input r;          // 加密随机数
    signal input pkX;  signal input pkY;    // 公钥坐标
    signal input C1x;  signal input C1y;    // 密文 C1 = r·G
    signal input C2x;  signal input C2y;    // 密文 C2 = m·G + r·pk

    // 验证 C1 = r·G（使用 Baby Jubjub 标准基点）
    component rG = BabyPbk();
    rG.in <== r;
    rG.Ax === C1x;
    rG.Ay === C1y;

    // 计算 m·G
    component mG = BabyPbk();
    mG.in <== m;

    // 计算 r·pk（任意点的标量乘法）
    component rPk = BabyScalarMult();
    rPk.in        <== r;
    rPk.point[0]  <== pkX;
    rPk.point[1]  <== pkY;

    // 验证 m·G + r·pk == C2
    component addResult = BabyAdd();
    addResult.x1   <== mG.Ax;
    addResult.y1   <== mG.Ay;
    addResult.x2   <== rPk.out[0];
    addResult.y2   <== rPk.out[1];
    addResult.xout === C2x;
    addResult.yout === C2y;
}

// ── 主模板 ────────────────────────────────────────────────────────────
template BalanceTransition() {

    // ── 私有输入 ─────────────────────────────────────────────────────
    signal private input old_balance_lo;
    signal private input old_balance_hi;
    signal private input transfer_lo;
    signal private input transfer_hi;
    signal private input new_balance_lo;
    signal private input new_balance_hi;
    signal private input r_old_lo;   signal private input r_old_hi;
    signal private input r_new_lo;   signal private input r_new_hi;
    signal private input r_audit_lo; signal private input r_audit_hi;

    // ── 公开输入 ─────────────────────────────────────────────────────
    signal input user_pkX;   signal input user_pkY;
    signal input audit_pkX;  signal input audit_pkY;

    // 旧余额密文（合约从链上读取作为公开输入，防替换攻击）
    signal input old_ct_lo_C1x; signal input old_ct_lo_C1y;
    signal input old_ct_lo_C2x; signal input old_ct_lo_C2y;
    signal input old_ct_hi_C1x; signal input old_ct_hi_C1y;
    signal input old_ct_hi_C2x; signal input old_ct_hi_C2y;

    // 新余额密文（证明者提供）
    signal input new_ct_lo_C1x; signal input new_ct_lo_C1y;
    signal input new_ct_lo_C2x; signal input new_ct_lo_C2y;
    signal input new_ct_hi_C1x; signal input new_ct_hi_C1y;
    signal input new_ct_hi_C2x; signal input new_ct_hi_C2y;

    // 审计密文（证明者提供）
    signal input audit_ct_lo_C1x; signal input audit_ct_lo_C1y;
    signal input audit_ct_lo_C2x; signal input audit_ct_lo_C2y;
    signal input audit_ct_hi_C1x; signal input audit_ct_hi_C1y;
    signal input audit_ct_hi_C2x; signal input audit_ct_hi_C2y;

    signal input expected_version;    // 合约验证版本号递增
    signal input is_sender;           // 1=付出（余额减），0=接收（余额增）

    // ── 约束 1：旧余额低位密文有效 ──────────────────────────────────
    component vOldLo = ElGamalVerify();
    vOldLo.m   <== old_balance_lo;
    vOldLo.r   <== r_old_lo;
    vOldLo.pkX <== user_pkX;  vOldLo.pkY <== user_pkY;
    vOldLo.C1x <== old_ct_lo_C1x; vOldLo.C1y <== old_ct_lo_C1y;
    vOldLo.C2x <== old_ct_lo_C2x; vOldLo.C2y <== old_ct_lo_C2y;

    // ── 约束 2：旧余额高位密文有效 ──────────────────────────────────
    component vOldHi = ElGamalVerify();
    vOldHi.m   <== old_balance_hi;
    vOldHi.r   <== r_old_hi;
    vOldHi.pkX <== user_pkX;  vOldHi.pkY <== user_pkY;
    vOldHi.C1x <== old_ct_hi_C1x; vOldHi.C1y <== old_ct_hi_C1y;
    vOldHi.C2x <== old_ct_hi_C2x; vOldHi.C2y <== old_ct_hi_C2y;

    // ── 约束 3：新余额低位密文有效 ──────────────────────────────────
    component vNewLo = ElGamalVerify();
    vNewLo.m   <== new_balance_lo;
    vNewLo.r   <== r_new_lo;
    vNewLo.pkX <== user_pkX;  vNewLo.pkY <== user_pkY;
    vNewLo.C1x <== new_ct_lo_C1x; vNewLo.C1y <== new_ct_lo_C1y;
    vNewLo.C2x <== new_ct_lo_C2x; vNewLo.C2y <== new_ct_lo_C2y;

    // ── 约束 4：新余额高位密文有效 ──────────────────────────────────
    component vNewHi = ElGamalVerify();
    vNewHi.m   <== new_balance_hi;
    vNewHi.r   <== r_new_hi;
    vNewHi.pkX <== user_pkX;  vNewHi.pkY <== user_pkY;
    vNewHi.C1x <== new_ct_hi_C1x; vNewHi.C1y <== new_ct_hi_C1y;
    vNewHi.C2x <== new_ct_hi_C2x; vNewHi.C2y <== new_ct_hi_C2y;

    // ── 约束 5：审计密文低位有效 ─────────────────────────────────────
    // 关键：transfer_lo 与约束 7 共享同一信号节点
    // 证明者在物理上无法为审计密文和余额守恒提供不同的 transfer_lo
    // 这是电路拓扑结构保证的，不是逻辑约束，无法绕过
    component vAudLo = ElGamalVerify();
    vAudLo.m   <== transfer_lo;   // ← 共享信号节点
    vAudLo.r   <== r_audit_lo;
    vAudLo.pkX <== audit_pkX; vAudLo.pkY <== audit_pkY;
    vAudLo.C1x <== audit_ct_lo_C1x; vAudLo.C1y <== audit_ct_lo_C1y;
    vAudLo.C2x <== audit_ct_lo_C2x; vAudLo.C2y <== audit_ct_lo_C2y;

    // ── 约束 6：审计密文高位有效 ─────────────────────────────────────
    component vAudHi = ElGamalVerify();
    vAudHi.m   <== transfer_hi;   // ← 共享信号节点
    vAudHi.r   <== r_audit_hi;
    vAudHi.pkX <== audit_pkX; vAudHi.pkY <== audit_pkY;
    vAudHi.C1x <== audit_ct_hi_C1x; vAudHi.C1y <== audit_ct_hi_C1y;
    vAudHi.C2x <== audit_ct_hi_C2x; vAudHi.C2y <== audit_ct_hi_C2y;

    // ── 约束 7：余额守恒 ─────────────────────────────────────────────
    // 将高低位合并为 64 位整数进行守恒验证
    // 注：这里用乘法代替位移，在有限域中等价
    signal old64   <== old_balance_hi * (1 << 32) + old_balance_lo;
    signal tra64   <== transfer_hi    * (1 << 32) + transfer_lo;
    signal new64   <== new_balance_hi * (1 << 32) + new_balance_lo;

    // is_sender=1（付出方）：old - transfer = new
    // is_sender=0（接收方）：old + transfer = new
    // 统一公式（避免分支）：
    //   is_sender   × (old - transfer - new)
    // + (1-is_sender) × (old + transfer - new) = 0
    signal diff_sender   <== old64 - tra64 - new64;
    signal diff_receiver <== old64 + tra64 - new64;
    0 === is_sender * diff_sender + (1 - is_sender) * diff_receiver;

    // ── 约束 8-11：范围证明（金额合法性）────────────────────────────
    // 约束所有金额在 [0, 2^32)
    // 隐式效果：
    //   1. 转账金额非负
    //   2. 新余额非负（不透支）
    //      负数 mod p 会是接近 p 的大整数，超出 32 位，Num2Bits 会失败
    component bTrLo = Num2Bits(32); bTrLo.in <== transfer_lo;
    component bTrHi = Num2Bits(32); bTrHi.in <== transfer_hi;
    component bNwLo = Num2Bits(32); bNwLo.in <== new_balance_lo;
    component bNwHi = Num2Bits(32); bNwHi.in <== new_balance_hi;
}

// ── 实例化（声明公开输入）────────────────────────────────────────────
component main {
    public [
        user_pkX, user_pkY, audit_pkX, audit_pkY,
        old_ct_lo_C1x, old_ct_lo_C1y, old_ct_lo_C2x, old_ct_lo_C2y,
        old_ct_hi_C1x, old_ct_hi_C1y, old_ct_hi_C2x, old_ct_hi_C2y,
        new_ct_lo_C1x, new_ct_lo_C1y, new_ct_lo_C2x, new_ct_lo_C2y,
        new_ct_hi_C1x, new_ct_hi_C1y, new_ct_hi_C2x, new_ct_hi_C2y,
        audit_ct_lo_C1x, audit_ct_lo_C1y, audit_ct_lo_C2x, audit_ct_lo_C2y,
        audit_ct_hi_C1x, audit_ct_hi_C1y, audit_ct_hi_C2x, audit_ct_hi_C2y,
        expected_version, is_sender
    ]
} = BalanceTransition();
```

### 5.4 约束规模与可信设置

**约束数估算：**

| 组件                                                       | 使用次数 | 约束/次 | 小计         |
| ---------------------------------------------------------- | -------- | ------- | ------------ |
| ElGamalVerify（内含 BabyPbk×2 + BabyScalarMult + BabyAdd） | 6        | ≈ 2,100 | ≈ 12,600     |
| Num2Bits(32)                                               | 4        | 32      | 128          |
| 余额守恒算术                                               | 1        | ≈ 50    | 50           |
| **合计**                                                   |          |         | **≈ 12,778** |

所需 Powers of Tau：**size 15**（支持 32,768 约束，有足够余量）。

**可信设置执行流程：**

```bash
# Phase 1：直接使用 Hermez 公开产物（数千参与者，无需重新举行）
wget https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau

# 编译电路
circom balance_transition.circom --r1cs --wasm --sym \
  -o ./build --prime bn128

# Phase 2：Nexum 团队执行并公开完整仪式记录
snarkjs groth16 setup \
  build/balance_transition.r1cs pot15_final.ptau circuit_0000.zkey

snarkjs zkey contribute circuit_0000.zkey circuit_0001.zkey \
  --name="Nexum Team" -e="$(openssl rand -hex 64)"

# 导出验证密钥 → 硬编码进 zk_verifier 合约
snarkjs zkey export verificationkey circuit_0001.zkey verification_key.json
```

---

## 六、链上 CU 预算分析

### 6.1 基准数据（来源：Solana ZK 生态调研报告 2026 年 4 月实测）

SIMD-129 激活后，Agave 4.0 客户端 alt_bn128 syscall 实测 CU：

| Syscall                          | 实测 CU              |
| -------------------------------- | -------------------- |
| `sol_alt_bn128_group_op` G1 乘法 | **≈ 100 CU / 次**    |
| `sol_alt_bn128_group_op` G1 加法 | **≈ 100 CU / 次**    |
| `sol_alt_bn128_pairing` 配对检查 | **≈ 12,000 CU / 对** |

> ⚠️ **v4/v5 历史错误**：此前估算约 3,500,000 CU/次验证，误差约 56 倍。错误估算导致了 Split-TX 设计，进而引入了状态机劫持漏洞。v7.0 基于实测数据重建。

### 6.2 单份 Groth16 证明验证 CU 计算

```
电路有 30 个公开输入，vk_x 的 IC 向量有 31 个元素（含常数项）

vk_x 计算（IC 点的 MSM）：
  30 次 G1 乘法：30 × 100 = 3,000 CU
  30 次 G1 加法：30 × 100 = 3,000 CU
  小计：6,000 CU

最终 Groth16 配对等式验证（4 对 e 配对）：
  4 × 12,000 = 48,000 CU

其他开销（A/B/C 点读取、proof 反序列化等）：
  ≈ 10,000 CU

单份证明验证合计：≈ 64,000 CU
```

### 6.3 settle_atomic 总 CU

| 操作                             | CU                      |
| -------------------------------- | ----------------------- |
| CPI 验证甲方证明（30 公开输入）  | ≈ 64,000                |
| CPI 验证乙方证明                 | ≈ 64,000                |
| 双方 Ledger PDA 写入（× 2）      | ≈ 30,000                |
| Settlement Record PDA 创建       | ≈ 15,000                |
| 金额一致性校验（alt_bn128 运算） | ≈ 5,000                 |
| 账户读取 + 反序列化 + 其他开销   | ≈ 20,000                |
| **合计**                         | **≈ 198,000**           |
| **ComputeBudget 申请上限**       | **400,000（余量充足）** |

### 6.4 全部指令 CU 汇总

| 指令                 | CU            | 备注                                  |
| -------------------- | ------------- | ------------------------------------- |
| `create_user_ledger` | ≈ 30,000      | 一次性                                |
| `deposit`            | ≈ 150,000     | ZK 验证 + SPL 转账 + Ledger 更新      |
| **`settle_atomic`**  | **≈ 198,000** | **核心指令，双证明 + 双 Ledger 更新** |
| `withdraw`           | ≈ 150,000     | ZK 验证 + SPL 转账 + Ledger 更新      |
| `request_audit`      | ≈ 50,000      | AuditLog 创建                         |

**结论：单笔交易内完成双方 ZK 证明验证 + 余额原子更新完全可行，无需任何 Split-TX，从根本上消除了历史版本的状态机劫持漏洞。**

---

## 七、合约设计

### 7.1 合约文件结构

```
programs/
├── nexum_pool/
│   ├── src/
│   │   ├── lib.rs                    程序入口，指令路由
│   │   ├── instructions/
│   │   │   ├── mod.rs
│   │   │   ├── initialize_pool.rs    初始化协议配置
│   │   │   ├── create_user_ledger.rs 创建用户账本
│   │   │   ├── deposit.rs            存款
│   │   │   ├── settle_atomic.rs      方案 A 核心结算
│   │   │   ├── withdraw.rs           提款
│   │   │   └── emergency_recover.rs  紧急恢复
│   │   ├── state/
│   │   │   ├── mod.rs
│   │   │   ├── protocol_config.rs    协议配置账户
│   │   │   ├── user_ledger.rs        用户账本账户
│   │   │   └── settlement_record.rs  结算记录账户
│   │   └── errors.rs                 错误码
│   └── Cargo.toml
│
├── audit_gate/
│   ├── src/
│   │   ├── lib.rs
│   │   ├── instructions/
│   │   │   ├── register_auditor.rs
│   │   │   ├── revoke_auditor.rs
│   │   │   └── request_audit.rs
│   │   └── state/
│   │       ├── auditor_registry.rs
│   │       └── audit_log.rs
│   └── Cargo.toml
│
└── zk_verifier/
    ├── src/
    │   ├── lib.rs                    CPI 接口
    │   └── groth16.rs                alt_bn128 syscall 封装，验证密钥硬编码
    └── Cargo.toml
```

### 7.2 核心账户结构定义

```rust
// ── 协议配置账户 ─────────────────────────────────────────────────────
#[account]
pub struct ProtocolConfig {
    pub admin: Pubkey,           // 协议管理员（多签推荐）
    pub audit_pk_x: [u8; 32],   // 审计公钥 x 坐标（Baby Jubjub）
    pub audit_pk_y: [u8; 32],   // 审计公钥 y 坐标
    pub fee_bps: u64,            // 结算手续费（初始 10 = 0.1%，上限 100 = 1%）
    pub is_paused: bool,         // 紧急暂停（仅停新存款，不影响已有结算）
    pub bump: u8,
}
// PDA 种子：["nexum_config"]，账户大小：8 + 32 + 64 + 8 + 1 + 1 = 114 字节

// ── 用户账本账户（每用户每资产一个）────────────────────────────────────
#[account]
pub struct UserLedger {
    pub owner: Pubkey,             // 账本所有者的 Solana 地址
    pub mint: Pubkey,              // 资产 Mint 地址（USDC/SOL 等）
    // 加密余额（Baby Jubjub ElGamal）
    pub balance_ct_lo: [u8; 128], // 余额低 32 位密文（C1.xy + C2.xy，各 32B）
    pub balance_ct_hi: [u8; 128], // 余额高 32 位密文
    // 最近一次结算的审计密文（供监管审计用）
    pub audit_ct_lo: [u8; 128],
    pub audit_ct_hi: [u8; 128],
    pub version: u64,              // 单调递增，防密文重放攻击
    pub status: LedgerStatus,      // Active / PendingSettle / Emergency
    pub last_settlement_id: [u8; 32], // 关联最近结算 ID（用于审计溯源）
    pub bump: u8,
}
// PDA 种子：["ledger", owner_pubkey, mint_pubkey]
// 账户大小：8 + 32 + 32 + 128×4 + 8 + 1 + 32 + 1 = 610 字节

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum LedgerStatus {
    Active,         // 正常，可参与结算
    PendingSettle,  // 方案 B 专用：余额已预锁定
    Emergency,      // 紧急恢复中
}

// ── 结算记录账户（永久存档）──────────────────────────────────────────
#[account]
pub struct SettlementRecord {
    pub initiator: Pubkey,            // 甲方地址
    pub counterparty: Pubkey,         // 乙方地址
    pub asset_a_mint: Pubkey,         // 甲方付出资产
    pub asset_b_mint: Pubkey,         // 乙方付出资产
    // 甲方审计密文（监管方可解密获取甲方付出金额）
    pub init_audit_ct_lo: [u8; 128],
    pub init_audit_ct_hi: [u8; 128],
    // 乙方审计密文
    pub cp_audit_ct_lo: [u8; 128],
    pub cp_audit_ct_hi: [u8; 128],
    // 双方 ZK 证明（永久存档，供独立验证）
    pub init_zk_proof: [u8; 256],     // Groth16：A(64B) + B(128B) + C(64B)
    pub cp_zk_proof: [u8; 256],
    pub settled_at: i64,              // Unix 时间戳
    pub bump: u8,
}
// PDA 种子：["settlement", ledger_a_key, nonce.to_le_bytes()]
// 账户大小：8 + 4×32 + 4×128 + 2×256 + 8 + 1 = 1,289 字节
// ← 永不删除，永久公开可查

// ── 审计日志账户 ───────────────────────────────────────────────────
#[account]
pub struct AuditLog {
    pub settlement_id: Pubkey,    // 被审计的结算记录
    pub auditor: Pubkey,          // 申请审计的机构地址
    pub request_slot: u64,        // 申请时区块高度
    pub request_timestamp: i64,   // 申请时间戳
    pub reason_hash: [u8; 32],    // 审计原因 SHA256（明文线下保存）
    pub jurisdiction: u8,         // 管辖区：0=MAS, 1=SEC, 2=FCA, 3=OTHER
    pub bump: u8,
}
// PDA 种子：["audit_log", settlement_id, auditor_pubkey, nonce]
// ← 永不删除，永远公开可查
```

### 7.3 settle_atomic 指令实现（关键路径）

```rust
// ── 账户验证结构 ────────────────────────────────────────────────────
#[derive(Accounts)]
#[instruction(params: SettleAtomicParams)]
pub struct SettleAtomic<'info> {
    #[account(
        mut,
        seeds = [b"ledger", ledger_a.owner.as_ref(), ledger_a.mint.as_ref()],
        bump = ledger_a.bump,
        constraint = ledger_a.status == LedgerStatus::Active
            @ NexumError::LedgerNotActive,
        // ledger_a 不需要 signer——任何人都可以提交双方已协商好的结算
        // 安全性由 ZK 证明保证：只有知道 sk_a 的人才能生成有效的 proof_a
    )]
    pub ledger_a: Account<'info, UserLedger>,

    #[account(
        mut,
        seeds = [b"ledger", ledger_b.owner.as_ref(), ledger_b.mint.as_ref()],
        bump = ledger_b.bump,
        constraint = ledger_b.status == LedgerStatus::Active
            @ NexumError::LedgerNotActive,
        constraint = ledger_a.key() != ledger_b.key()
            @ NexumError::SameLedger,
        constraint = ledger_a.mint == ledger_b.mint
            @ NexumError::MintMismatch,    // 同种资产才能在同一结算中交换
    )]
    pub ledger_b: Account<'info, UserLedger>,

    #[account(
        init,
        payer = fee_payer,
        space = 8 + SettlementRecord::LEN,
        seeds = [
            b"settlement",
            ledger_a.key().as_ref(),
            &params.nonce.to_le_bytes()
        ],
        bump,
    )]
    pub settlement_record: Account<'info, SettlementRecord>,

    #[account(
        seeds = [b"nexum_config"],
        bump = protocol_config.bump,
        constraint = !protocol_config.is_paused @ NexumError::ProtocolPaused,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    pub zk_verifier: Program<'info, ZkVerifier>,

    #[account(mut)]
    pub fee_payer: Signer<'info>,   // 支付 Settlement Record 账户租金

    pub system_program: Program<'info, System>,
}

// ── 指令参数 ────────────────────────────────────────────────────────
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SettleAtomicParams {
    pub nonce: u64,

    // 甲方
    pub proof_a: [u8; 256],
    pub new_ct_a_lo: [u8; 128],
    pub new_ct_a_hi: [u8; 128],
    pub audit_ct_a_lo: [u8; 128],
    pub audit_ct_a_hi: [u8; 128],

    // 乙方
    pub proof_b: [u8; 256],
    pub new_ct_b_lo: [u8; 128],
    pub new_ct_b_hi: [u8; 128],
    pub audit_ct_b_lo: [u8; 128],
    pub audit_ct_b_hi: [u8; 128],
}

// ── 核心执行逻辑 ────────────────────────────────────────────────────
pub fn settle_atomic(
    ctx: Context<SettleAtomic>,
    params: SettleAtomicParams,
) -> Result<()> {

    let config   = &ctx.accounts.protocol_config;
    let ledger_a = &ctx.accounts.ledger_a;
    let ledger_b = &ctx.accounts.ledger_b;

    // Step 1: 构造甲方 ZK 公开输入
    // 旧余额密文从链上读取，防止攻击者替换为任意密文
    let pub_ins_a = BalanceTransitionPubInputs {
        user_pk:            derive_baby_jub_pk(&ledger_a.owner),
        audit_pk:           config.get_audit_pk(),
        old_ct_lo:          ledger_a.balance_ct_lo,  // ← 链上读取，不可篡改
        old_ct_hi:          ledger_a.balance_ct_hi,
        new_ct_lo:          params.new_ct_a_lo,
        new_ct_hi:          params.new_ct_a_hi,
        audit_ct_lo:        params.audit_ct_a_lo,
        audit_ct_hi:        params.audit_ct_a_hi,
        expected_version:   ledger_a.version + 1,
        is_sender:          1,
    };

    // Step 2: CPI 验证甲方证明（≈64,000 CU）
    zk_verifier::cpi::verify_balance_transition(
        CpiContext::new(
            ctx.accounts.zk_verifier.to_account_info(),
            zk_verifier::cpi::accounts::VerifyProof {},
        ),
        params.proof_a,
        pub_ins_a.to_bytes(),
    )?;
    // 若失败 → Error::VerificationFailed → 整笔交易 revert

    // Step 3: 构造乙方公开输入
    let pub_ins_b = BalanceTransitionPubInputs {
        user_pk:            derive_baby_jub_pk(&ledger_b.owner),
        audit_pk:           config.get_audit_pk(),
        old_ct_lo:          ledger_b.balance_ct_lo,
        old_ct_hi:          ledger_b.balance_ct_hi,
        new_ct_lo:          params.new_ct_b_lo,
        new_ct_hi:          params.new_ct_b_hi,
        audit_ct_lo:        params.audit_ct_b_lo,
        audit_ct_hi:        params.audit_ct_b_hi,
        expected_version:   ledger_b.version + 1,
        is_sender:          0,
    };

    // Step 4: CPI 验证乙方证明（≈64,000 CU）
    zk_verifier::cpi::verify_balance_transition(
        CpiContext::new(
            ctx.accounts.zk_verifier.to_account_info(),
            zk_verifier::cpi::accounts::VerifyProof {},
        ),
        params.proof_b,
        pub_ins_b.to_bytes(),
    )?;

    // Step 5: 验证双方审计密文编码相同金额（≈5,000 CU）
    // 原理：audit_ct_a 和 audit_ct_b 都使用相同的 audit_pk 加密
    // 若 transfer_a == transfer_b，则：
    //   audit_ct_a.C2 - audit_ct_b.C2 = (r_a - r_b) × audit_pk
    // 通过 alt_bn128_group_op 链上验证此等式
    verify_same_transfer_amount(
        &params.audit_ct_a_lo, &params.audit_ct_a_hi,
        &params.audit_ct_b_lo, &params.audit_ct_b_hi,
        &config.get_audit_pk_bytes(),
    )?;

    // Step 6: 原子更新双方 Ledger
    // 先更新，防止 Step 7 失败时资产被意外锁定
    let ledger_a = &mut ctx.accounts.ledger_a;
    ledger_a.balance_ct_lo     = params.new_ct_a_lo;
    ledger_a.balance_ct_hi     = params.new_ct_a_hi;
    ledger_a.audit_ct_lo       = params.audit_ct_a_lo;
    ledger_a.audit_ct_hi       = params.audit_ct_a_hi;
    ledger_a.version           += 1;
    ledger_a.last_settlement_id = ctx.accounts.settlement_record.key().to_bytes();

    let ledger_b = &mut ctx.accounts.ledger_b;
    ledger_b.balance_ct_lo     = params.new_ct_b_lo;
    ledger_b.balance_ct_hi     = params.new_ct_b_hi;
    ledger_b.audit_ct_lo       = params.audit_ct_b_lo;
    ledger_b.audit_ct_hi       = params.audit_ct_b_hi;
    ledger_b.version           += 1;
    ledger_b.last_settlement_id = ctx.accounts.settlement_record.key().to_bytes();

    // Step 7: 创建 Settlement Record（永久存档）
    let record = &mut ctx.accounts.settlement_record;
    record.initiator         = ctx.accounts.ledger_a.owner;
    record.counterparty      = ctx.accounts.ledger_b.owner;
    record.asset_a_mint      = ctx.accounts.ledger_a.mint;
    record.asset_b_mint      = ctx.accounts.ledger_b.mint;
    record.init_audit_ct_lo  = params.audit_ct_a_lo;
    record.init_audit_ct_hi  = params.audit_ct_a_hi;
    record.cp_audit_ct_lo    = params.audit_ct_b_lo;
    record.cp_audit_ct_hi    = params.audit_ct_b_hi;
    record.init_zk_proof     = params.proof_a;
    record.cp_zk_proof       = params.proof_b;
    record.settled_at        = Clock::get()?.unix_timestamp;
    // ← 不写任何明文金额字段

    emit!(SettlementEvent {
        settlement_id: record.key(),
        initiator:     record.initiator,
        counterparty:  record.counterparty,
        asset_a_mint:  record.asset_a_mint,
        asset_b_mint:  record.asset_b_mint,
        timestamp:     record.settled_at,
    });

    Ok(())
}
```

### 7.4 zk_verifier 合约：链上 Groth16 验证

```rust
// ── 验证密钥（从可信设置的 verification_key.json 转换，硬编码）─────────
const VK_ALPHA_G1: [u8; 64] = [/* ... */];
const VK_BETA_G2:  [u8; 128] = [/* ... */];
const VK_GAMMA_G2: [u8; 128] = [/* ... */];
const VK_DELTA_G2: [u8; 128] = [/* ... */];
const VK_IC: [[u8; 64]; 31]  = [/* IC[0] .. IC[30]，对应 30 个公开输入 + 常数项 */];

pub fn verify_balance_transition(
    ctx: Context<VerifyProof>,
    proof_bytes: [u8; 256],
    pub_inputs_bytes: Vec<u8>,    // 30 × 32 字节 = 960 字节
) -> Result<()> {

    // 反序列化 proof：A(64B) + B(128B) + C(64B) = 256 字节
    let proof_a = &proof_bytes[0..64];    // G1 点
    let proof_b = &proof_bytes[64..192];  // G2 点
    let proof_c = &proof_bytes[192..256]; // G1 点

    // 反序列化公开输入（30 个 Fr 元素，每个 32 字节）
    let pub_inputs: Vec<[u8; 32]> = pub_inputs_bytes
        .chunks(32)
        .map(|c| c.try_into().unwrap())
        .collect();

    // 计算 vk_x = IC[0] + Σ(pub_input[i] × IC[i+1])
    let mut vk_x = VK_IC[0].to_vec();  // G1 点
    for (i, input) in pub_inputs.iter().enumerate() {
        // G1 标量乘法：input × IC[i+1]
        // CU：≈100（SIMD-129 优化后）
        let ic_scaled = sol_alt_bn128_multiplication(
            &concat(input, &VK_IC[i + 1])
        )?;
        // G1 加法：vk_x += ic_scaled
        vk_x = sol_alt_bn128_addition(&concat(&vk_x, &ic_scaled))?;
    }

    // 验证 Groth16 配对等式：
    // e(proof_a, proof_b) = e(vk_alpha, vk_beta) × e(vk_x, vk_gamma) × e(proof_c, vk_delta)
    // 等价于检查：e(-proof_a, proof_b) × e(vk_alpha, vk_beta) × e(vk_x, vk_gamma) × e(proof_c, vk_delta) = 1
    let pairing_input = concat_all(&[
        negate_g1(proof_a),  // -proof_a
        proof_b,
        &VK_ALPHA_G1,
        &VK_BETA_G2,
        &vk_x,
        &VK_GAMMA_G2,
        proof_c,
        &VK_DELTA_G2,
    ]);

    // 4 对配对检查，CU ≈ 4 × 12,000 = 48,000
    let result = sol_alt_bn128_pairing(&pairing_input)?;

    require!(result == [0u8; 32], NexumError::ZkVerificationFailed);
    // ← 若不等于预期值（表示配对乘积≠1），证明无效，整笔交易 revert

    Ok(())
}
```

---

## 八、前端架构

### 8.1 双 Worker 架构（主线程零阻塞）

```
主线程（React / Next.js 14）
  职责：UI 渲染、状态管理、用户交互
  不做：任何密码学运算（不允许超过 16ms 的同步计算）
  
  ↕ postMessage / onmessage
  
CryptoWorker（独立线程）
  职责：
    - 启动时后台预热 BSGS 查找表（4MB，约 200-800ms）
    - Baby Jubjub ElGamal 加解密
    - 余额守恒计算（new_balance = old ± transfer）
    - 密码学安全随机数生成
  状态：INITIALIZING → WARMING_UP → READY → BUSY

  ↕ postMessage

ProverWorker（独立线程）
  职责：
    - 启动时预加载 snarkjs WASM（约 1-2 秒）
    - groth16.fullProve 执行（约 3-5 秒）
    - 证明序列化（BigInt[] → [u8;256]）
  状态：LOADING_WASM → READY → PROVING
```

### 8.2 应用启动预热流程

```
应用加载
    │
    ├─→ CryptoWorker 启动，开始后台建表
    │     每 2000 步 postMessage 一次进度（0%-100%）
    │     主线程更新"加载中"进度条
    │
    ├─→ ProverWorker 启动，预加载 WASM
    │     snarkjs.groth16.setup() 提前缓存
    │
    ↓（约 1-3 秒后）
    │
CryptoWorker: WARMUP_COMPLETE
ProverWorker: WASM_READY
    │
    ↓
解锁 "存款" 和 "结算" 按钮（此前为禁用灰色状态）
```

### 8.3 结算流程的前端状态机

```
用户界面状态：
  IDLE
    ↓ 用户输入金额，点击"生成证明"
  GENERATING_PROOF
    显示：赛博朋克风格终端窗口，实时打印进度
    CryptoWorker: 解密余额 → 计算新余额 → 生成密文（~100ms）
    ProverWorker: 运行 Groth16 → 实时进度条 0-100%（约 3-5 秒）
    ↓ 双方证明就绪
  PROOF_READY
    显示：证明已就绪，等待对方确认
    ↓ 接收到对方证明（链下交换）
  SUBMITTING
    构造 settle_atomic 交易，提交
    ↓ 交易确认
  SETTLED
    展示：交易详情、CU 消耗（高光展示 ~198,000 CU）
    展示：两个 Ledger PDA 密文已更新
    展示：Settlement Record 已创建
```

### 8.4 终端窗口 UI 设计

演示期间，右下角显示实时终端输出（赛博朋克黑色背景 + 绿色文字）：

```
[CryptoWorker] Starting balance decryption...
[CryptoWorker] BSGS table lookup: 23,847 / 65,536 steps
[CryptoWorker] Balance decrypted: ████████ USDC (redacted for display)
[CryptoWorker] Computing new balance ciphertext...
[CryptoWorker] Generating audit ciphertext with audit_pk...
[CryptoWorker] ✓ Ciphertexts ready (128ms)

[ProverWorker] Loading circuit witness...
[ProverWorker] Running Groth16 fullProve...
[ProverWorker] ████████████████░░░░░░░░ 67% (2.1s)
[ProverWorker] ████████████████████████ 100%
[ProverWorker] ✓ Proof generated in 3.2s (256 bytes)

[SDK] Exchanging proof with counterparty...
[SDK] ✓ Both proofs ready. Submitting to Solana...
[Network] Transaction submitted: 5xKp...mNqR
[Network] ✓ Confirmed (slot 312,847,291)
[Nexum] ✓ Settlement complete. CU used: 198,412 / 400,000
```

### 8.5 余额显示与本地解密

```typescript
// 前端每次加载时，从链上读取用户 Ledger PDA 并本地解密
async function displayUserBalance(
  ledger: UserLedger,
  userSk: bigint,
): Promise<string> {
  // CryptoWorker 内执行，不阻塞主线程
  const result = await cryptoWorker.request({
    type: 'DECRYPT_BALANCE',
    ct_lo: ledger.balance_ct_lo,
    ct_hi: ledger.balance_ct_hi,
    sk: userSk,  // 注意：sk 只在 CryptoWorker 内存中，不序列化到 IndexedDB
  });

  const balance = result.balance_hi * (1n << 32n) + result.balance_lo;
  return formatUnits(balance, decimals);  // 例：显示 "49,900,000.00 USDC"
}
```

### 8.6 服务端降级路径

**触发条件**：CryptoWorker 崩溃、BSGS 建表超时（>5秒）、设备 OOM。

| 操作        | 降级方式                                                     | 私钥是否离开本地   |
| ----------- | ------------------------------------------------------------ | ------------------ |
| ZK 证明生成 | POST `/api/v1/generate-proof`（服务端 Node.js snarkjs）      | 否，私钥不在参数中 |
| 余额解密    | POST `/api/v1/decrypt-balance`（只发密文，服务端解密后用用户公钥加密返回，用户本地再解一次） | 否                 |

机构用户（Fireblocks 等 MPC 托管）默认使用服务端路径，无需在浏览器内运行 WASM。

---

## 九、TEE 审计预言机

### 9.1 职责定义（最小化原则）

TEE 只做一件事：当链上存在合法审计申请时，解密对应的审计密文，返回明文金额。

TEE **不负责**：ZK 证明验证（链上合约完成）、任何资产控制权（合约 PDA 控制）。

**信任层次**：

- 审计数据**准确性** → ZK 证明数学保证，与 TEE 无关
- 审计数据**保密性** → TEE 硬件保证（私钥不泄露）

### 9.2 审计私钥生命周期

```
首次初始化（一次性）：
  Enclave 内生成 Baby Jubjub 审计密钥对
  audit_sk ← crypto.getRandomValues（密码学安全随机数）
  audit_pk = audit_sk · G
  
  用 AWS KMS 的 DEK 加密 audit_sk（PCR 绑定）：
  encrypted_audit_sk = AES_256_GCM(DEK, audit_sk)
  
  将 encrypted_audit_sk 存入 DynamoDB（持久化）
  将 audit_pk 写入链上 ProtocolConfig 账户

常规重启恢复（全自动，约 1-3 秒）：
  从 DynamoDB 读取 encrypted_audit_sk
  向 KMS 提交解密请求 + Nitro Attestation Document（包含当前代码 PCR）
  KMS 验证 PCR 与策略一致 → 释放 DEK → Enclave 内解密得 audit_sk
  开始监听 AuditRequested 事件
```

### 9.3 AWS KMS PCR 绑定策略

```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::ACCOUNT:role/NexumEnclaveRole" },
  "Action": "kms:Decrypt",
  "Condition": {
    "StringEqualsIgnoreCase": {
      "kms:RecipientAttestation:PCR0": "EXPECTED_PCR0",
      "kms:RecipientAttestation:PCR1": "EXPECTED_PCR1",
      "kms:RecipientAttestation:PCR2": "EXPECTED_PCR2"
    }
  }
}
```

代码任何修改都会改变 PCR 值，KMS 自动拒绝解密，保护密钥不被篡改后的代码获取。

### 9.4 可验证透明度

Nexum 公开：

- 预言机完整源代码（GitHub，MIT 许可）
- 确定性构建 Dockerfile（任何人可复现相同 PCR 值）
- 当前运行 Enclave 的 PCR0/1/2（官网 + 链上 ProtocolConfig）
- 实时 Attestation Document 查询端点

验证方法：下载源码 → 相同 Dockerfile 构建 → 计算 PCR → 与官方 PCR 比对 → 密码学确认运行代码与公开代码一致。

### 9.5 蓝绿 PCR 发版协议

发版时的核心风险：新版本 PCR 未加入 KMS 白名单就重启 Enclave，KMS 拒绝解密，审计私钥永久丢失。

解决方案：PCR 值在**编译阶段**已确定，提前计算，提前加入白名单。

```bash
# 编译阶段预计算新版本 PCR
nitro-cli build-enclave --docker-uri nexum-oracle:v2.0 --output-file oracle.eif
NEW_PCR0=$(nitro-cli describe-eif --eif-path oracle.eif | jq -r '.Measurements.PCR0')

# Step 1: KMS 白名单加入 NEW_PCR（旧版本继续运行）
./scripts/kms_add_pcr.sh $NEW_PCR0

# Step 2: 先停旧实例，再启新实例（防双实例并发）
./scripts/stop_enclave.sh --wait
./scripts/start_enclave.sh oracle.eif

# Step 3: 验证通过后，清理旧 PCR
./scripts/wait_healthy.sh --timeout 120
./scripts/kms_remove_pcr.sh $OLD_PCR0
```

---

## 十、链上数据模型

### 10.1 账户体系总览

```
Nexum 协议账户层次

协议级别（单例）：
  ProtocolConfig PDA      ["nexum_config"]
    admin, audit_pk, fee_bps, is_paused

用户级别（每用户 × 每资产）：
  UserLedger PDA          ["ledger", user_pubkey, mint_pubkey]
    balance_ct_lo/hi, audit_ct_lo/hi, version, status

结算级别（每次结算一个，永久）：
  SettlementRecord PDA    ["settlement", ledger_a_key, nonce]
    双方审计密文, 双方 ZK 证明, 时间戳

审计级别（每次审计申请一个，永久）：
  AuditLog PDA            ["audit_log", settlement_id, auditor_key, nonce]
    审计者, 时间戳, 原因哈希

资产级别（每种资产一个）：
  Treasury Vault ATA      ["treasury", mint_pubkey]
    由 nexum_pool PDA 控制，存放所有用户存入的 SPL Token

审计机构注册（单例）：
  AuditorRegistry PDA     ["auditor_registry"]
    已注册审计机构列表
```

### 10.2 账户字段详解

#### ProtocolConfig

| 字段         | 类型    | 大小 | 说明                                            |
| ------------ | ------- | ---- | ----------------------------------------------- |
| `admin`      | Pubkey  | 32B  | 协议管理员（多签推荐）                          |
| `audit_pk_x` | [u8;32] | 32B  | 审计公钥 x 坐标（Baby Jubjub，来自 TEE 初始化） |
| `audit_pk_y` | [u8;32] | 32B  | 审计公钥 y 坐标                                 |
| `fee_bps`    | u64     | 8B   | 结算手续费基点（初始 10 = 0.1%，上限 100）      |
| `is_paused`  | bool    | 1B   | 紧急暂停开关（仅暂停新存款）                    |
| `bump`       | u8      | 1B   | PDA bump                                        |

#### UserLedger

| 字段                 | 类型     | 大小     | 说明                                 |
| -------------------- | -------- | -------- | ------------------------------------ |
| `owner`              | Pubkey   | 32B      | 账本所有者地址                       |
| `mint`               | Pubkey   | 32B      | 资产 Mint 地址                       |
| `balance_ct_lo`      | [u8;128] | 128B     | 余额低位密文（C1.xy + C2.xy 各 32B） |
| `balance_ct_hi`      | [u8;128] | 128B     | 余额高位密文                         |
| `audit_ct_lo`        | [u8;128] | 128B     | 最近结算审计密文低位（供监管审计）   |
| `audit_ct_hi`        | [u8;128] | 128B     | 最近结算审计密文高位                 |
| `version`            | u64      | 8B       | 单调递增版本号，防密文重放           |
| `status`             | u8       | 1B       | LedgerStatus 枚举                    |
| `last_settlement_id` | [u8;32]  | 32B      | 最近结算 ID（审计溯源）              |
| `bump`               | u8       | 1B       | PDA bump                             |
| **合计**             |          | **610B** |                                      |

#### SettlementRecord

| 字段                  | 类型       | 大小       | 说明                               |
| --------------------- | ---------- | ---------- | ---------------------------------- |
| `initiator`           | Pubkey     | 32B        | 甲方地址                           |
| `counterparty`        | Pubkey     | 32B        | 乙方地址                           |
| `asset_a_mint`        | Pubkey     | 32B        | 甲方付出资产                       |
| `asset_b_mint`        | Pubkey     | 32B        | 乙方付出资产                       |
| `init_audit_ct_lo/hi` | [u8;128]×2 | 256B       | 甲方审计密文（低+高位）            |
| `cp_audit_ct_lo/hi`   | [u8;128]×2 | 256B       | 乙方审计密文                       |
| `init_zk_proof`       | [u8;256]   | 256B       | 甲方 Groth16 证明                  |
| `cp_zk_proof`         | [u8;256]   | 256B       | 乙方 Groth16 证明                  |
| `settled_at`          | i64        | 8B         | Unix 时间戳                        |
| `bump`                | u8         | 1B         | PDA bump                           |
| **合计**              |            | **1,281B** | 永久存档，含双方审计密文和 ZK 证明 |

---

## 十一、安全模型

### 11.1 数学非托管：ZK 证明是唯一授权机制

```
传统托管：用户 A 授权 Nexum → Nexum 移动资金 → 存在信任风险
Nexum v7.0：任何余额变更 → 必须提供有效 ZK 证明 → 数学强制
```

合约中强制体现：

```rust
// 所有余额变更指令都从 zk_verifier CPI 开始，验证失败则整笔 revert
// 不存在任何可以绕过 ZK 验证的路径

// 合约明确没有的指令：
//   admin_withdraw(amount)    ← 不存在
//   emergency_transfer(to)   ← 不存在
//   bypass_proof_for_admin()  ← 不存在
```

Treasury Vault ATA 的 owner 是 PDA（`["treasury", mint]`），没有任何外部密钥可以直接签名提走资金，只有合约逻辑在 ZK 证明验证通过后才能执行 SPL 转账。

### 11.2 已防御的威胁

| 威胁                     | 防御机制                                                     |
| ------------------------ | ------------------------------------------------------------ |
| 池内结算金额对外泄露     | Baby Jubjub ElGamal 加密，链上只存密文，零明文               |
| 审计密文与实际金额不一致 | 电路信号共享：transfer 信号同时约束审计密文和余额守恒        |
| 旧证明重放攻击           | version 单调递增，公开输入中锁定 expected_version            |
| 旧余额密文替换攻击       | 合约从链上 Ledger 直接读取旧密文作为公开输入，不接受调用者传入 |
| 双方结算金额不一致       | settle_atomic Step 5 的 alt_bn128 链上等式验证               |
| 自我结算（甲乙同一账户） | `ledger_a.key() != ledger_b.key()` 约束强制                  |
| Admin 动用用户资金       | 合约无 admin 提款指令；Treasury 由 PDA 控制                  |
| 余额透支                 | Num2Bits(32) 范围证明保证 new_balance ∈ [0, 2^64)            |
| Solana 并发写锁冲突      | 隔离 Ledger PDA，每次结算仅锁两个相关账户                    |
| 批量审计监控             | audit_gate 合约强制指定 settlement_id，无批量接口            |
| 审计不留记录             | AuditLog PDA 强制创建，永不删除                              |
| TEE 代码被篡改           | PCR 绑定 + Remote Attestation 可验证                         |
| TEE 重启私钥丢失         | KMS 加密持久化 + 自动恢复                                    |
| 前端 UI 假死             | 双 Worker 架构，密码学运算完全隔离                           |
| 随机数熵不足             | 强制 crypto.getRandomValues，ESLint 禁 Math.random           |

### 11.3 已知限制（诚实声明）

**存款/提款金额链上可见**：这是 SPL Token 标准的根本特性，已知且接受。存款时无交易意图，提款时金额与具体结算无法对应，不影响核心隐私保护。

**TEE 硬件信任假设**：审计私钥保密性依赖 AWS Nitro Enclave 硬件正确性。这是可验证的信任（Remote Attestation 有密码学证据），但不是零信任。审计数据准确性由 ZK 证明独立保证，与 TEE 无关。

**链下对手方发现**：方案 A 需要双方链下协商并交换证明，不提供链上订单发现。适合有既有关系的机构间结算。

---

## 十二、黑客松演示脚本

### 12.1 演示准备

**环境要求**：

- Devnet 上已部署 nexum_pool、audit_gate、zk_verifier 三个合约
- 两个浏览器窗口，分别代表机构 A 和机构 B
- 两个 Devnet 测试钱包，各自已在 Nexum 池内有余额
- 一个监管机构演示账户（用于展示审计功能）

**演示前检查清单（重要！）**：

- [ ] 两个测试钱包 Devnet SOL 余额充足（至少 0.5 SOL 支付 Gas）
- [ ] 两个钱包已完成存款，Ledger PDA 存在且有足够余额
- [ ] WASM 文件（`balance_transition.wasm`，约 2MB）已预缓存
- [ ] zkey 文件（`circuit_0001.zkey`，约 500KB）已预缓存
- [ ] 备用方案：若 ProverWorker 崩溃，切换服务端证明器 API
- [ ] 在 Solana Explorer 上保存好合约地址的快捷链接
- [ ] 演示至少提前完整排练 5 次

### 12.2 演示流程（约 5 分钟）

#### [第 0-30 秒] 背景引入

打开 Solscan，找一笔普通 Orca/Raydium 大额 swap 交易：

> "看这里。一笔 500 万 USDC 换 SOL 的机构级交易。金额、方向、参与方——全都在链上，任何人包括竞争对手和 MEV 机器人都能实时看到。这是现有链上结算的根本困境。"

> "Nexum 解决这个问题的方式不是在转账上加密——那行不通，SPL 转账金额永远明文。Nexum 的解法是：**在池内根本不发生 SPL 转账**。"

#### [第 30-90 秒] 高光时刻 1：浏览器端 ZK 证明生成

打开机构 A 的界面：

> "机构 A 要向机构 B 支付 100 万 USDC，换取 10 万 SOL。他们已经在链下协商好了。现在，机构 A 在浏览器内——注意，是浏览器内——生成一个零知识证明。"

点击"生成证明"，展示终端窗口实时输出：

> "看右下角。这个终端在实时打印 CryptoWorker 的执行过程——解密当前余额、计算新余额、生成密文。然后 ProverWorker 开始跑 Groth16 证明，这个进度条是真实的计算过程，不是动画。"

等待约 3-5 秒，证明生成完毕：

> "3.2 秒。一份 256 字节的 Groth16 零知识证明，在普通浏览器里生成了。它证明了：我的余额确实从 X 变为 X-100万，而且这个事实对应的审计密文是准确的——但它不泄露 X 是多少，也不泄露 100 万本身。"

#### [第 90-150 秒] 高光时刻 2：单笔交易双证明链上验证（技术绝杀）

乙方机构 B 同样生成证明（可以是预录制或并行演示）：

> "机构 B 也生成了自己的证明。现在任意一方把两份证明打包进一笔 Solana 交易，提交。"

交易确认后，立即打开 Solana Explorer，指向 CU 消耗：

> "看这里——**198,412 CU**。"
> （停顿，让这个数字沉淀）
> "这笔交易验证了两份 Groth16 ZK 证明、原子更新了双方的加密余额。"
> "知道为什么这么低吗？SIMD-129 升级之后，Solana 的 alt_bn128 syscall 每次配对运算只需要约 12,000 CU。我们在 24 小时前还以为需要 350 万 CU，是 56 倍的估算错误。现在单笔交易内搞定，无需任何拆分。"

展示两个 Ledger PDA 的变化：

> "看这两个账户。密文字段变了，但没有任何数字，没有金额，没有'100 万'，没有'10 万'。外部观察者能看到的只是：有两个账户的某些字节发生了变化。"

#### [第 150-240 秒] 高光时刻 3：合规审计留证（差异化展示）

切换到监管审计界面：

> "现在展示 Nexum 与 Tornado Cash 的根本区别。"

输入刚才的 settlement_id，点击"申请审计"：

> "监管机构向链上合约提交审计申请，指定这笔结算的 ID。"

展示链上 AuditLog 账户已创建：

> "链上多了一个账户——AuditLog。里面是：哪个机构、什么时候、审计了哪笔结算。这个账户永不删除，永远公开可查。被审计的机构可以去链上看到自己被谁审计过——审计行为本身完全透明。这就是 Nexum 和完全匿名协议的根本区别：不是不可审计，而是**可管控的审计**。"

TEE 预言机返回解密结果，展示双方金额（演示环境可直接展示）：

> "TEE 预言机在可信硬件环境里解密审计密文，返回两个数字：甲方付出 100 万 USDC，乙方付出 10 万 SOL。这个数字的准确性有刚才那份链上 ZK 证明的数学背书——不依赖 Nexum 团队是否诚实，任何人都可以独立验证那份证明。"

#### [第 240-300 秒] 总结与差异化收尾

> "总结一下 Nexum 做了什么："
> "第一：池内结算全程零明文。不是加密的转账，是根本没有转账——只有密文字段的变化。"
> "第二：Groth16 ZK 证明确保每次余额变化数学上合法，没有有效证明就没有状态更新，包括我们自己也无法绕过。"
> "第三：合规审计留证。监管机构可以事后精准审计，每次审计行为链上强制留痕，被审计方可以查看谁在审计自己。"
> "第四：198,000 CU 完成双证明验证，单笔 Solana 交易，这在 6 个月前没人认为可行。"

### 12.3 备用预案

| 故障场景                   | 应对方案                                                   |
| -------------------------- | ---------------------------------------------------------- |
| ProverWorker WASM 加载失败 | 预先配置服务端证明器 API 作为降级，透明切换                |
| 浏览器证明生成超时         | 切换到服务端证明器（演示效果不变，向评委解释这是机构路径） |
| Devnet RPC 拥堵            | 使用自己搭建的 Devnet RPC 节点作为备用                     |
| 交易确认延迟               | 提前准备好已成功的交易截图和 Explorer 链接作为保底         |
| Solscan 无法访问           | 使用本地 Explorer（Solana Explorer 或自建）                |

---

## 十三、开发任务拆分与时间线

### 13.1 黑客松 MVP 最小交付范围

**必须完成（Demo 不可缺少的）**：

```
1. ZK 电路
   [ ] balance_transition.circom 编写
   [ ] 可信设置（Phase 1 使用 Hermez ptau15，Phase 2 执行）
   [ ] WASM 编译，浏览器可运行
   [ ] 电路单元测试（有效证明通过 / 无效证明拒绝 / 版本号错误拒绝）

2. Anchor 合约
   [ ] nexum_pool：deposit + settle_atomic + withdraw
   [ ] audit_gate：request_audit（简化版，register/revoke 可后补）
   [ ] zk_verifier：verify_balance_transition（Groth16，alt_bn128）
   [ ] Devnet 部署并验证

3. TypeScript SDK
   [ ] Baby Jubjub ElGamal 加解密（基于 @noble/curves）
   [ ] BSGS 解密（含预热表）
   [ ] CryptoWorker + ProverWorker 双 Worker 架构
   [ ] 余额守恒计算工具

4. 前端（最精简版）
   [ ] 存款界面（含 ZK 生成进度展示）
   [ ] 结算界面（双方证明生成 + settle_atomic 提交）
   [ ] 交易结果展示（CU 高亮 + Ledger 密文变化）
   [ ] 审计申请界面（request_audit + AuditLog 展示）

5. TEE 预言机（演示版）
   [ ] 审计密文解密逻辑（BSGS + Baby Jubjub）
   [ ] AWS Nitro Enclave 基础部署（本地 SGX 模拟也可接受演示）
   [ ] KMS 集成（可以先用本地密钥管理替代，标注为 TODO）
```

**可以在黑客松后补充（Demo 不影响）**：

```
- 完整的存/提款 ZK 证明（简化版可以用预存余额跳过这步演示）
- 方案 B（加密承诺 + 余额锁定，生产版）
- 完整的审计机构注册/撤销流程
- KMS PCR 绑定（生产版 TEE 配置）
- 错误边界处理和用户提示文案
```

### 13.2 技术依赖与关键路径

```
关键路径（每项完成前无法进入下一项）：

Day 1-2: 电路设计 + 可信设置
  └→ balance_transition.circom 完成
     ↓
Day 3-4: zk_verifier 合约 + 验证密钥硬编码
  └→ 链上可以验证证明
     ↓
Day 5-6: nexum_pool 核心逻辑（settle_atomic）
  └→ 合约端到端可运行
     ↓
Day 7-8: TypeScript SDK（CryptoWorker + ProverWorker）
  └→ 前端可以生成 + 提交证明
     ↓
Day 9-10: 前端 UI + TEE 演示版
  └→ 完整演示流程可运行
     ↓
Day 11-12: 联调 + Bug 修复 + 演示排练
```

### 13.3 技术风险与缓解策略

| 风险                                               | 概率 | 影响 | 缓解方案                                                     |
| -------------------------------------------------- | ---- | ---- | ------------------------------------------------------------ |
| Baby Jubjub ElGamal 链上序列化字节序问题（大小端） | 高   | 高   | 第一天就写端到端测试，不要等到联调才发现                     |
| snarkjs WASM 在 Worker 内存不足 OOM                | 中   | 中   | 提前测试最低设备配置；准备服务端证明器降级                   |
| alt_bn128 实际 CU 与预算有偏差                     | 低   | 中   | 申请 400,000 CU，留足 2× 余量                                |
| Devnet RPC 不稳定                                  | 高   | 低   | 本地搭建备用 RPC 节点                                        |
| 电路约束数超过 size 15（32,768）                   | 低   | 高   | 实时监控 circom 编译输出的约束数；当前估算 12,778，有 60% 余量 |

---

## 附录 A：目录结构

```
nexum-protocol/
├── circuits/
│   ├── balance_transition.circom    主电路
│   ├── build/                       编译输出（.r1cs, .wasm, .sym）
│   ├── keys/                        可信设置产物（.ptau, .zkey）
│   └── tests/                       电路测试
│
├── programs/
│   ├── nexum_pool/                  核心业务合约
│   ├── audit_gate/                  审计接口合约
│   └── zk_verifier/                 ZK 验证合约
│
├── sdk/
│   ├── src/
│   │   ├── crypto/                  Baby Jubjub ElGamal 工具
│   │   │   ├── elgamal.ts
│   │   │   ├── bsgs.ts
│   │   │   └── keys.ts
│   │   ├── workers/
│   │   │   ├── CryptoWorker.ts
│   │   │   └── ProverWorker.ts
│   │   └── nexum.ts                 SDK 主入口
│   └── tests/
│
├── app/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index.tsx            首页
│   │   │   ├── settle.tsx           结算界面
│   │   │   └── audit.tsx            审计界面
│   │   └── components/
│   │       ├── TerminalWindow.tsx   演示用终端输出组件
│   │       └── LedgerView.tsx       余额展示组件
│   └── public/
│       ├── balance_transition.wasm  预加载
│       └── circuit_0001.zkey        预加载
│
├── oracle/
│   ├── src/
│   │   ├── main.rs                  预言机主程序
│   │   └── decrypt.rs               Baby Jubjub 解密逻辑
│   └── Dockerfile.enclave           确定性构建，用于 PCR 计算
│
└── tests/
    └── e2e/                         端到端集成测试
```

---

## 附录 B：错误码定义

```rust
#[error_code]
pub enum NexumError {
    #[msg("Ledger is not in Active status")]
    LedgerNotActive,           // 尝试对非 Active 状态的 Ledger 执行结算

    #[msg("Cannot settle a ledger with itself")]
    SameLedger,                // ledger_a 和 ledger_b 是同一个账户

    #[msg("Asset mint mismatch between ledgers")]
    MintMismatch,              // 两个 Ledger 的资产类型不同（跨资产换需方案 B）

    #[msg("ZK proof verification failed")]
    ZkVerificationFailed,      // Groth16 配对等式不成立

    #[msg("Version mismatch: proof is stale or replayed")]
    VersionMismatch,           // expected_version != current_version + 1

    #[msg("Transfer amounts in audit ciphertexts are inconsistent")]
    TransferAmountMismatch,    // 甲方和乙方审计密文编码了不同金额

    #[msg("Protocol is paused")]
    ProtocolPaused,            // is_paused = true，新存款被暂停

    #[msg("Insufficient balance")]
    InsufficientBalance,       // 前端验证，ZK 也会通过 Num2Bits 拒绝

    #[msg("Invalid auditor: not registered or revoked")]
    InvalidAuditor,            // 审计机构未注册或已被撤销
}
```

