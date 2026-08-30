# dsh-external-brain

是给N.E.K.O的外部程序控制的另一半，N.E.K.O侧插件见https://github.com/xy28816/n.e.k.o_plugin_neko_mcp_serve。
但是还没审核好......

要在设置里调整挂载的对话，但是没有名字，不知道怎么改，可能不直观。
这里有一个小技巧：通过shell打开的新框架只有点开过的会话才会在挂载列表里显示。

DSH 侧对接插件。对外提供一个 OpenAI 兼容的 `POST /v1/chat/completions` 端点（默认 `http://127.0.0.1:3080/v1`），供 NEKO 侧 **external_control** 插件转发对话请求过来。

## 角色
在"NEKO 当身体、DSH 当大脑"的链路中，本插件扮演**目标 API**：

1. NEKO 主动搭话 → 调"对话模型"
2. NEKO 对话模型指向 external_control（监听 9157）
3. external_control 拦截请求 → 转发到本插件端点（3080/v1）
4. 本插件用 DSH 的 `llm` 通道生成回复 → 按 OpenAI 格式返回

## 端点
- `POST /v1/chat/completions`（OpenAI 兼容，支持流式 SSE / 非流式）
- `GET /v1/health`（健康检查）

## 配置
- `provider`：DSH llm 通道 provider（默认 `deepseek-official`）
- `model`：模型 id（必填）
- `allowModelOverride`：是否允许请求体里的 model 覆盖（默认 false）
