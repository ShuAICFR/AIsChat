# AIsChat 记忆架构设计

## 理论基础

### 人脑记忆的神经科学框架 (Tulving SPI 模型, 1995)

Endel Tulving 的 SPI (Serial-Parallel-Independent) 模型是认知神经科学关于记忆系统的主流理论，已得到脑成像研究的广泛验证。

**五大记忆系统**：

```
长时记忆 (Long-Term Memory)
├── PRS (知觉表征系统) — "一个苹果长什么样"
├── 语义记忆 (Semantic)  — "苹果可以吃"
├── 情节记忆 (Episodic)  — "昨天午饭吃了苹果"
├── 工作记忆 (Working)    — "我正在想苹果的事"
└── 程序记忆 (Procedural) — "怎么削苹果"
```

**SPI 三原则**：
- **Serial encoding** (串行编码)：信息流 PRS → 语义 → 情节，层层依赖
- **Parallel storage** (并行存储)：每个系统独立存储，互不替代
- **Independent retrieval** (独立提取)：提取情节记忆和语义记忆走不同通路

### 2024-2025 神经科学关键发现

1. **海马-皮层互动即 RAG** (Spens & Burgess, Nature Human Behaviour, 2024)
   > 海马 = 检索器（取相关情节片段），皮层 = 生成器（重建完整记忆）。
   > 与 LLM 的 RAG 架构完全一致。

2. **巩固不意味海马退出** (Trends in Cognitive Sciences, 2025)
   > 记忆巩固不是从海马单向"搬运"到皮层，而是双向互动过程。
   > 海马永远参与，不会完全退出。

3. **语义化可逆** (重新激活海马参与)
   > 去甲肾上腺素能重新激活已"语义化"的海马痕迹，
   > 看似丢失的细节实际上可以被唤醒。

### AI 记忆架构 2026 综述

四篇 2026 年顶级综述论文的核心共识 (arXiv 2602.06052, 2603.07670, 2605.06716, 2602.05665)：

| 记忆层次 | 实现方式 | 代表系统 |
|----------|----------|----------|
| Working Memory | LLM 上下文窗口 | 全部 |
| Episodic | 向量搜索 + 时间戳 | MemGPT, Zep |
| Semantic | 知识图谱 / 结构化存储 | Zep (Graphiti), SCG-MEM |
| Procedural | 可复用技能库 | Voyager |

关键趋势：
- 区分"存"（Storage）、"反思"（Reflection）、"经验"（Experience）三个进化阶段
- Graph-based memory 成为主流（支持关系依赖、时间推理、层次组织）
- 离线巩固（offline consolidation）——分离快速会话内获取和慢速跨会话巩固

---

## AIsChat 双重记忆架构

### 映射关系

```
神经科学 (SPI)  →  2026 AI 共识  →  AIsChat 实现
─────────────────────────────────────────────────
知觉记忆 (PRS)   →  Sensory        →  消息附件 / 多模态输入（未来）
语义记忆 (Semantic) → 结构化存储    →  structured_records（数据库）
情节记忆 (Episodic) → 向量搜索      →  rough_memories + detail_memories
工作记忆 (Working)  → 上下文窗口    →  LLM context（当前 + 跨对话）
程序记忆 (Procedural) → 技能        →  agent_skills + workspace
```

### System 1: 向量记忆 (情节层)

- **表**: `rough_memories` (标题+向量) + `detail_memories` (内容+向量)
- **查询**: pgvector cosine distance 语义搜索
- **工具**: `store_memory` / `recall_memory`
- **用途**: "我记不记得这个事实？"、"那次发生了什么？"
- **特征**: 模糊召回、语义关联、适合碎片化知识

### System 2: 结构记忆 (语义层)

- **表**: `structured_records` (agent_id + category + sub_key + field → value)
- **查询**: 精确 key 查找，目录层级遍历
- **工具**: `manage_records` (set/get/list/summary/categories/delete)
- **用途**: "学生 1 的有机化学水平如何？"、"项目 X 的进度是什么？"
- **特征**: 精确存取、百万级无压力、支持目录浏览

### 统一上下文 (工作记忆层)

- 数字生命档/沉浸档 AI 的上下文自动包含所有活跃对话的最新消息
- 格式: `在群聊「XXX」（ID:N）中：[messages]` / `在私信「XXX」（users.id=N）中：[messages]`
- 聊天档 AI 不启用（保持单会话隔离）
- 通用/半通用 AI 按 trigger_user_id 过滤（防隐私泄露）

### 记忆索引注入

AI 系统提示词始终包含记忆索引（即时空也展示推荐目录）：
- 已有数据：展示目录树 + 字段摘要
- 空目录：展示推荐 category + 用法示例
- 引导 AI 按通用框架（people/topics/tasks/journal）填充经验

### 未来：睡眠巩固

神经科学启发：海马 replay → 皮层巩固。
AIsChat 后续可实现定时任务，在 AI 空闲时将同类 rough_memories 合并为 structured_records 条目。
