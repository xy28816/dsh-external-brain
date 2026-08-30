/**
 * @dsh-external-brain — Client half.
 *
 * "NEKO挂载" settings section: pick the DSH session NEKO mounts onto.
 * Uses a searchable, scrollable session list (not a native <select>) so many
 * sessions stay findable.
 */
window.__ModuleLoader__.load({
  id: "dsh-external-brain",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const { useState, useEffect, useMemo } = React;
    const API = "/v1";
    function callGet(path) { return fetch(API + path).then(function (r) { return r.json(); }); }
    function callPost(path, body) { return fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); }); }

    function NekoMountSection() {
      const [sessions, setSessions] = useState([]);
      const [selected, setSelected] = useState("");
      const [query, setQuery] = useState("");
      const [open, setOpen] = useState(false);
      const [saveMsg, setSaveMsg] = useState(null);
      const [loading, setLoading] = useState(true);
      useEffect(function () {
        callGet("/sessions").then(function (d) {
          if (d && Array.isArray(d.sessions)) setSessions(d.sessions);
        }).catch(function () {}).finally(function () { setLoading(false); });
      }, []);
      const filtered = useMemo(function () {
        const q = (query || "").toLowerCase();
        return (sessions || []).filter(function (s) {
          if (!q) return true;
          return (s.id || "").toLowerCase().indexOf(q) !== -1 || (s.status || "").toLowerCase().indexOf(q) !== -1;
        });
      }, [sessions, query]);
      function pick(s) { setSelected(s.id); setOpen(false); setQuery(""); }
      function save() {
        callPost("/mount", { target_session_id: selected }).then(function (d) {
          setSaveMsg(d && d.ok ? "已挂载 " + selected : (d && d.error || "保存失败"));
        }).catch(function (e) { setSaveMsg("保存失败: " + (e && e.message || e)); });
      }
      return React.createElement("div", { style: { maxWidth: 720, display: "flex", flexDirection: "column", gap: 12, color: "var(--dsw-alias-label-primary)" } },
        React.createElement("h2", { style: { margin: 0, fontSize: 16, fontWeight: 500 } }, "NEKO 挂载"),
        React.createElement("p", { style: { margin: 0, fontSize: 14, lineHeight: 22, color: "var(--dsw-alias-label-tertiary)" } },
          "选择 NEKO 对话要挂载到的 DSH 目标会话。输入关键词可搜索，会话多了也能快速找到。"),
        React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
          React.createElement("label", { style: { fontSize: 12, fontWeight: 500, color: "var(--dsw-alias-label-secondary)" } }, "目标对话"),
          React.createElement("input", {
            type: "text",
            value: query,
            placeholder: "搜索会话 id 或状态…",
            onFocus: function () { setOpen(true); },
            onChange: function (e) { setQuery(e.target.value); setOpen(true); },
            style: { height: 32, border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: "0 10px", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontSize: 14, width: "100%", boxSizing: "border-box" }
          }),
          open ? React.createElement("div", { style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, maxHeight: 220, overflowY: "auto", background: "var(--dsw-alias-bg-layer-1)" } },
            loading ? React.createElement("div", { style: { padding: 10, fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } }, "加载中…") :
            filtered.length === 0 ? React.createElement("div", { style: { padding: 10, fontSize: 13, color: "var(--dsw-alias-label-tertiary)" } }, "无匹配会话") :
            filtered.map(function (s) {
              var isSel = selected === s.id;
              return React.createElement("div", {
                key: s.id,
                onClick: function () { pick(s); },
                onMouseDown: function (e) { e.preventDefault(); },
                style: { padding: "8px 10px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--dsw-alias-border-l2)", background: isSel ? "var(--dsw-alias-fill-l2)" : "transparent", color: "var(--dsw-alias-label-primary)" }
              }, s.id + " (" + (s.status || "") + ")");
            })
          ) : null
        ),
        selected ? React.createElement("div", { style: { fontSize: 13, color: "var(--dsw-alias-label-secondary)" } }, "已选：" + selected) : null,
        React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
          React.createElement("button", {
            onClick: save,
            disabled: !selected,
            style: { height: 36, padding: "0 14px", border: "none", borderRadius: 18, background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-foreground)", cursor: "pointer", fontSize: 14 }
          }, "保存挂载"),
          saveMsg ? React.createElement("span", { style: { fontSize: 12, color: saveMsg.indexOf("已挂载") === 0 ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-warn-label)" } }, saveMsg) : null
        )
      );
    }

    const inject = ["slots"];
    function apply(ctx) {
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "neko-mount",
          order: 60,
          label: "NEKO挂载"
        }, NekoMountSection);
      });
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
