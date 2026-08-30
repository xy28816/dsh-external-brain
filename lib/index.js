// @ts-check
/**
 * @deepseek-ai/dsh-external-brain — 让 NEKO 真正进入 DSH 的某个 agent 对话。
 *
 * 不是中转站：NEKO 的输入通过目标 agent 的 Inbox 推进，让该 agent 的 loop
 * 完整跑一轮（需要时主动调用它自己的工具），并把最终回复给 NEKO。
 */
import z from "@deepseek-ai/schemastery";
import path from "node:path";
import os from "node:os";
import fsm from "node:fs";

const __LIB__ = path.join(os.homedir(), '.dsh');
function trace(key, obj) {
  try {
    const line = "[" + new Date().toISOString() + "] " + key + " " + JSON.stringify(obj).slice(0, 4000) + "\n";
    fsm.appendFileSync(path.join(__LIB__, 'dsh-brain-trace.log'), line);
  } catch (e) {}
}

export const name = "dsh-external-brain";
export const inject = ["webServer", "agents", "sessions", "sessionQuery"];

export const Config = z.object({
	targetSessionId: z.string().default(""),
	allowModelOverride: z.boolean().default(false),
});

async function readJsonBody(req, limit = 32 * 1024 * 1024) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("request body too large");
		chunks.push(chunk);
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	if (raw === "") return {};
	return JSON.parse(raw);
}

function lastUserText(messages) {
	if (!Array.isArray(messages)) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (!m || m.role !== "user") continue;
		if (Array.isArray(m.content)) {
			return m.content.filter(b => b && typeof b === "object" && (b.type === "text"||b.type==="input_text")).map(b => String(b.text ?? "")).join("");
		} else if (typeof m.content === "string") return m.content;
	}
	return "";
}

function mkUserMessage(text) {
	return {
		id: Math.random().toString(36).slice(2),
		role: "user",
		content: [{ type: "text", text }],
		source: { kind: "user" },
	};
}

function openaiReply(model, text) {
	try { trace("reply", { text: String(text).slice(0, 800), len: String(text).length }); } catch {}
	const message = { role: "assistant", content: text };
	return {
		id: "chatcmpl-" + Math.random().toString(36).slice(2),
		object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
		choices: [{ index: 0, message, finish_reason: "stop" }],
	};
}

export async function handleChat(req, res, cfg, agents) {
	let body;
	try { body = await readJsonBody(req); } catch {
		res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "bad request: invalid JSON body" })); return;
	}
	 trace("req", { nmsg: body?.messages?.length, stream: body?.stream, sys: (body?.messages?.[0]?.content || "").slice(0, 600), last: lastUserText(body?.messages).slice(0, 200) });
	const wishesStream = body.stream === true;

	const targetId = (MOUNTED_TARGET || cfg.targetSessionId || (body?.target_session_id || "")).trim();
	if (!targetId) {
		res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "no target session selected: set targetSessionId" })); return;
	}
	const agent = (agents && typeof agents.get === "function") ? agents.get(targetId) : undefined;
	if (!agent) {
		res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "target agent not found: " + targetId })); return;
	}

	const text = lastUserText(body.messages);
	if (!text) { res.writeHead(400, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "empty user input" })); return; }

	const model = (typeof body?.model === "string" && body.model.trim() !== "" && cfg.allowModelOverride) ? body.model.trim() : (agent.options?.model || "");
	trace("followup", { targetId, text: text.slice(0, 80), model });
	try {
		agent.followup(mkUserMessage(text));
	} catch (e) {
		res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ error: "followup failed: " + String(e) })); return;
	}

	try { await (agent.whenIdle ? agent.whenIdle() : Promise.resolve()); } catch (e) { trace("whenIdle", { err: String(e) }); }

	let reply = "";
	try {
		const msgs = agent.session ? agent.session.deriveMessages() : [];
		if (msgs && Array.isArray(msgs)) {
			for (let i = msgs.length - 1; i >= 0; i--) {
				const m = msgs[i];
				if (m && m.role === "assistant") {
					reply = (m.content || []).filter(b => b && b.type === "text").map(b => b.text || "").join("");
					if (reply) break;
				}
			}
		}
	} catch (e) { trace("derive", { err: String(e) }); }

	if (!reply) reply = "（目标对话未产生回复）";
	if (wishesStream) {
		const send2 = (obj) => { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch (e) {} };
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" });
		const cid = "chatcmpl-" + Math.random().toString(36).slice(2);
		send2({ id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
		for (let i = 0; i < reply.length; i += 16) { send2({ id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: { content: reply.slice(i, i+16) }, finish_reason: null }] }); }
		send2({ id: cid, object: "chat.completion.chunk", created: Math.floor(Date.now()/1000), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
		try { res.write("data: [DONE]\n\n"); } catch (e) {}
		try { res.end(); } catch (e) {}
	} else {
		const out = openaiReply(model, reply);
		const txt = JSON.stringify(out);
		res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(txt) });
		res.end(txt);
	}
}

export async function handleToolCallback(req, res, cfg, agents) {
	res.writeHead(501, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({ error: "legacy /tools/external_chat removed: use session mounting" }));
}

let MOUNTED_TARGET = "";
export function apply(ctx, config) {
	ctx.effect(() => {
		const chat = ctx.webServer.register({
			kind: "exact", path: "/v1/chat/completions",
			handler: (req, res) => {
				if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
				return handleChat(req, res, config, ctx.agents);
			},
		});
		const alive = ctx.webServer.register({
			kind: "exact", path: "/_dsh_neko_alive",
			handler: (_req, res) => {
				trace("client-alive", { t: Date.now() });
				res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ ok: true }));
			},
		});
		const health = ctx.webServer.register({
			kind: "exact", path: "/v1/health",
			handler: (_req, res) => {
				res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ ok: true, service: "dsh-external-brain", target: config.targetSessionId || "(none)" }));
			},
		});
		const list = ctx.webServer.register({
			kind: "exact", path: "/v1/sessions",
			handler: async (_req, res) => {
				let arr = [];
				try {
					const sq = ctx.sessionQuery;
					// 候选: 当前活跃(live)的 agent 会话 —— 只列工作区活动对话, 不放归档旧会话
					const agents = (ctx.agents && typeof ctx.agents.list === "function") ? ctx.agents.list() : [];
					const base = (agents || []).map(function (a) { return { id: String(a?.id), status: a?.status || "idle" }; });
					const ids = base.map(function (b) { return b.id; }).filter(Boolean);
					let titleMap = {};
					if (ids.length && sq && typeof sq.readTitleSnapshots === "function") {
						try {
							const titles = await sq.readTitleSnapshots(ids);
							(titles || []).forEach(function (t) {
								if (t && t.status === "fulfilled" && t.value && t.value.title) titleMap[t.sessionId] = t.value.title.title;
							});
						} catch (e) {}
					}
					arr = base.map(function (b) { return { id: b.id, title: titleMap[b.id] || b.id, status: b.status }; });
				} catch (e) { trace("sessions", { err: String(e) }); }
				res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ ok: true, sessions: arr }));
			},
		});

		const mount = ctx.webServer.register({
			kind: "exact", path: "/v1/mount",
			handler: async (req, res) => {
				let body;
				try { body = await readJsonBody(req); } catch { res.writeHead(400, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "bad body" })); return; }
				const sid = (body && typeof body.target_session_id === "string") ? body.target_session_id.trim() : "";
				if (!sid) { res.writeHead(400, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: "target_session_id required" })); return; }
				config.targetSessionId = sid;
				MOUNTED_TARGET = sid;
				try { fsm.writeFileSync(path.join(__LIB__, 'neko-mount-target.txt'), sid); } catch (e) {}
				trace("mount", { target: sid });
				res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ ok: true, target: sid }));
			},
		});

		const view = ctx.webServer.register({
			kind: "exact", path: "/v1/session_view",
			handler: async (req, res) => {
				let out = { ok: false };
				try {
					const url = new URL(req.url, "http://x");
					const id = url.searchParams.get("id") || "";
					const sq = ctx.sessionQuery;
					if (id && sq && typeof sq.readSurface === "function") {
						const surf = await sq.readSurface(id);
						const evs = (surf && surf.events) || [];
						out = { ok: true, id, n: evs.length, events: evs.map(function (e) {
							let t = "";
							let role = e && e.type;
							if (e && e.data) {
								if (e.data.message && e.data.message.content) { t = e.data.message.content.map(function (b){ return b && b.text || ""; }).join(""); role = e.data.message.role; }
								else if (e.data.text) { t = e.data.text; }
								else if (e.data.content) { t = String(e.data.content); }
							}
							return { type: e.type, role: role, text: (t || "").slice(0, 160) };
						}) };
					} else out = { ok: false, error: "param id required" };
				} catch (e) { out = { ok: false, error: String(e) }; }
				res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify(out));
			},
		});
		return () => { chat(); health(); list(); alive(); mount(); view(); };
	}, "dsh-external-brain: routes");
}