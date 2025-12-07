"use strict";
try { require("dotenv").config(); } catch (_) {}
const express = require("express");
const cors = require("cors");
const path = require("path");
let NotionClient = null; try { NotionClient = require("@notionhq/client").Client; } catch (_) { NotionClient = null; }
const fetch = (typeof global !== 'undefined' && global.fetch) ? global.fetch.bind(global) : require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function getToken(req) {
  return (
    req.headers["x-notion-token"] ||
    process.env.NOTION_TOKEN ||
    process.env.NOTION_API_KEY ||
    ""
  );
}

function getClient(req) {
  const token = getToken(req);
  if (!token) return null;
  if (!NotionClient) return null;
  return new NotionClient({ auth: token, notionVersion: '2022-06-28' });
}

app.post('/api/databases/:id/properties/:propertyId/options', async (req, res) => {
  try {
    const notion = getClient(req);
    const token = getToken(req);
    if (!notion && !token) return res.status(400).json({ error: 'Thiếu NOTION_TOKEN' });
    const rawDbId = req.params.id || '';
    const propertyIdParam = req.params.propertyId || '';
    const dbId = extractIdFromAny(rawDbId);
    if (!dbId) return res.status(400).json({ error: 'database_id không hợp lệ' });

    const body = req.body || {};
    const name = String(body.name || '').trim();
    const color = String(body.color || 'default').toLowerCase();
    if (!name) return res.status(400).json({ error: 'Thiếu tên lựa chọn' });

    const allowedColors = new Set(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);
    const colorToUse = allowedColors.has(color) ? color : 'default';

    let db;
    if (notion) {
      db = await notion.databases.retrieve({ database_id: dbId });
    } else {
      const resp = await fetch(`https://api.notion.com/v1/databases/${encodeURIComponent(dbId)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Notion-Version': '2022-06-28',
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!resp.ok) {
        const txt = await resp.text();
        return res.status(resp.status).json({ error: resp.statusText, detail: txt });
      }
      db = await resp.json();
    }

    const entries = Object.entries((db && db.properties) || {});
    const targetEntry = entries.find(([propName, prop]) => {
      if (!prop) return false;
      if (prop.id && prop.id === propertyIdParam) return true;
      return propName === propertyIdParam;
    });
    if (!targetEntry) return res.status(404).json({ error: 'Không tìm thấy thuộc tính' });

    const [propertyName, propertyValue] = targetEntry;
    if (!propertyValue || propertyValue.type !== 'multi_select') {
      return res.status(400).json({ error: 'Thuộc tính không phải multi_select' });
    }

    const existingOptions = (propertyValue.multi_select && propertyValue.multi_select.options) || [];
    const duplicate = existingOptions.some((opt) => String(opt.name || '').trim().toLowerCase() === name.toLowerCase());
    if (duplicate) return res.status(409).json({ error: 'Lựa chọn đã tồn tại' });

    const newOption = { name, color: colorToUse };
    const updatedOptions = existingOptions.concat([newOption]);

    const propKey = propertyValue.id || propertyName;
    let updatedDb;
    if (notion) {
      updatedDb = await notion.databases.update({
        database_id: dbId,
        properties: {
          [propKey]: {
            multi_select: {
              options: updatedOptions,
            },
          },
        },
      });
    } else {
      const resp = await fetch(`https://api.notion.com/v1/databases/${encodeURIComponent(dbId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Notion-Version': '2022-06-28',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          properties: {
            [propKey]: {
              multi_select: {
                options: updatedOptions,
              },
            },
          },
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        return res.status(resp.status).json({ error: resp.statusText, detail: txt });
      }
      updatedDb = await resp.json();
    }

    const updatedProps = (updatedDb && updatedDb.properties) || {};
    const updatedProperty = updatedProps[propertyName];
    const returnedOption = updatedProperty && updatedProperty.multi_select && Array.isArray(updatedProperty.multi_select.options)
      ? updatedProperty.multi_select.options.find((opt) => String(opt.name || '').trim().toLowerCase() === name.toLowerCase())
      : null;

    res.json({ ok: true, option: returnedOption || newOption });
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});
function normalizeNotionId(id = "") {
  try {
    const s = String(id || "").replace(/-/g, "").trim();
    if (/^[0-9a-fA-F]{32}$/.test(s)) {
      return [
        s.slice(0, 8),
        s.slice(8, 12),
        s.slice(12, 16),
        s.slice(16, 20),
        s.slice(20),
      ].join("-").toLowerCase();
    }
  } catch {}
  return id;
}

function extractIdFromAny(input = "") {
  const str = String(input || "").trim();
  const m = str.match(/[0-9a-fA-F]{32}/);
  if (m) return normalizeNotionId(m[0]);
  if (/^[0-9a-fA-F-]{32,36}$/.test(str)) return normalizeNotionId(str);
  return "";
}

function extractIdFromUrl(url = "") {
  const match = String(url || "").match(/[0-9a-fA-F]{32}/);
  return match ? normalizeNotionId(match[0]) : "";
}

function toCompactNotionId(raw = "") {
  const normalized = extractIdFromAny(raw);
  return normalized ? normalized.replace(/-/g, "") : "";
}

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get("/api/me", async (req, res) => {
  try {
    const notion = getClient(req);
    if (notion) {
      const me = await notion.users.me();
      return res.json(me);
    }
    const token = getToken(req);
    if (!token) return res.status(400).json({ error: "Thiếu NOTION_TOKEN" });
    const resp = await fetch('https://api.notion.com/v1/users/me', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Notion-Version': '2022-06-28',
        'Authorization': 'Bearer ' + token,
      }
    });
    if (!resp.ok) {
      const t = await resp.text();
      return res.status(resp.status).json({ error: resp.statusText, detail: t });
    }
    const json = await resp.json();
    res.json(json);
  } catch (e) {
    const message = e && e.message ? e.message : e;
    console.error("/api/me error:", message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/databases/:id/properties", async (req, res) => {
  try {
    const notion = getClient(req);
    const token = getToken(req);
    if (!notion && !token) return res.status(400).json({ error: "Thiếu NOTION_TOKEN" });
    const rawId = req.params.id || "";
    const dbId = extractIdFromAny(rawId);
    if (!dbId) return res.status(400).json({ error: "database_id không hợp lệ" });
    let db = null;
    let dbProps = {};
    let titleTextLog = "";
    let entries = [];
    if (notion) {
      db = await notion.databases.retrieve({ database_id: dbId });
      dbProps = (db && typeof db.properties === "object" && db.properties) || {};
      titleTextLog = Array.isArray(db.title) ? db.title.map((t) => t.plain_text).join("") : "";
      entries = Object.entries(dbProps);
    }

    // Fallback nếu props rỗng: gọi REST trực tiếp như test.js
    if (entries.length === 0) {
      const hyphenId = dbId;
      const noHyphenId = String(dbId).replace(/-/g, "");
      const tryIds = [hyphenId, noHyphenId].filter(Boolean);
      for (const tryId of tryIds) {
        try {
          const url = `https://api.notion.com/v1/databases/${encodeURIComponent(tryId)}`;
          console.log('[props:fallback] GET', url);
          const resp = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'Notion-Version': '2022-06-28',
              'Authorization': `Bearer ${token}`,
            },
          });
          if (!resp.ok) {
            const errText = await resp.text();
            console.error('[props:fallback] error', resp.status, resp.statusText, errText);
            continue;
          }
          const json = await resp.json();
          db = json;
          dbProps = (json && json.properties) || {};
          const fallbackTitleArr = json && Array.isArray(json.title) ? json.title : [];
          titleTextLog = fallbackTitleArr.length ? fallbackTitleArr.map(function(t){ return t.plain_text; }).join('') : '';
          entries = Object.entries(dbProps);
          console.log('[props:fallback] title=', titleTextLog, 'propsCount=', entries.length);
          if (entries.length > 0) break;
        } catch (fe) {
          const msg = fe && fe.message ? fe.message : fe;
          console.error('[props:fallback] exception', msg);
        }
      }
    }
    // entries.forEach(([name, p]) => {
    //   const type = p && p.type;
    //   const pid = p && p.id;
    //   let optCount = 0;
    //   if (type === "select") optCount = ((p && p.select && p.select.options) || []).length;
    //   else if (type === "multi_select") optCount = ((p && p.multi_select && p.multi_select.options) || []).length;
    //   else if (type === "status") optCount = ((p && p.status && p.status.options) || []).length;
    //   console.log(`[prop] name=${name} id=${pid} type=${type} options=${optCount}`);
    // });
    const titlePropEntry = Object.entries(dbProps).find(function(entry) {
      var p = entry[1];
      return p && p.type === "title";
    });
    const titlePropName = titlePropEntry ? titlePropEntry[0] : null;
    const props = Object.entries(dbProps).map(([name, p]) => {
      const type = p ? p.type : undefined;
      const item = { id: (p && p.id) || null, name: name, type: type };
      if (type === "select") {
        item.options = ((p && p.select && p.select.options) || []).map(function(o) {
          return { name: o.name, color: o.color };
        });
      } else if (type === "multi_select") {
        item.options = ((p && p.multi_select && p.multi_select.options) || []).map(function(o) {
          return { name: o.name, color: o.color };
        });
      } else if (type === "status") {
        item.options = ((p && p.status && p.status.options) || []).map(function(o) {
          return { name: o.name, color: o.color };
        });
      }
      return item;
    });
    const titleArr = db && Array.isArray(db.title) ? db.title : [];
    const titleText = titleArr.length ? titleArr.map(function(t) { return t.plain_text; }).join("") : "";
    res.json({ id: dbId, title: titleText, has_title: !!titlePropName, title_property: titlePropName, properties: props });
  } catch (e) {
    var errLog = e;
    if (e && e.body) errLog = e.body;
    else if (e && e.message) errLog = e.message;
    console.error("/api/databases/:id/properties error:", errLog);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/databases/:id/raw', async (req, res) => {
  try {
    const token = getToken(req);
    if (!token) return res.status(400).json({ error: 'Thiếu NOTION_TOKEN' });
    const rawId = req.params.id || '';
    const dbId = extractIdFromAny(rawId);
    if (!dbId) return res.status(400).json({ error: 'database_id không hợp lệ' });
    const url = `https://api.notion.com/v1/databases/${encodeURIComponent(dbId)}`;
    console.log('[raw] GET', url);
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Notion-Version': '2022-06-28',
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[raw] error', resp.status, resp.statusText, errText);
      return res.status(resp.status).json({ error: resp.statusText, detail: errText });
    }
    const json = await resp.json();
    const props = (json && json.properties) || {};
    const rawTitleArr = json && Array.isArray(json.title) ? json.title : [];
    console.log('[raw] title=', (rawTitleArr.length ? rawTitleArr.map(function(t){return t.plain_text;}).join('') : ''), 'propsCount=', Object.keys(props).length);
    for (const [name, p] of Object.entries(props)) {
      const t = p ? p.type : undefined; const pid = p ? p.id : undefined; let oc = 0;
      if (t === 'select') oc = ((p && p.select && p.select.options) || []).length;
      else if (t === 'multi_select') oc = ((p && p.multi_select && p.multi_select.options) || []).length;
      else if (t === 'status') oc = ((p && p.status && p.status.options) || []).length;
      console.log(`[raw-prop] name=${name} id=${pid} type=${t} options=${oc}`);
    }
    res.json(json);
  } catch (e) {
    const msg = e && e.message ? e.message : e;
    console.error('/api/databases/:id/raw error:', msg);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/databases", async (req, res) => {
  try {
    const notion = getClient(req);
    const token = getToken(req);
    if (!notion && !token) return res.status(400).json({ error: "Thiếu NOTION_TOKEN" });

    const results = [];
    const seenIds = new Set();
    function pushResult(obj) {
      const id = obj && obj.id;
      const title = obj && obj.title;
      const url = obj && obj.url;
      const compactId = toCompactNotionId(id || url);
      const finalId = compactId || toCompactNotionId(title) || toCompactNotionId(url) || toCompactNotionId(id);
      if (!finalId || seenIds.has(finalId)) return;
      seenIds.add(finalId);
      results.push({ id: finalId, title: title, url: url });
    }

    async function attemptSDK(filterValue) {
      let cursor = undefined;
      while (true) {
        const params = { page_size: 50 };
        if (cursor) params.start_cursor = cursor;
        if (filterValue) params.filter = { property: "object", value: filterValue };
        const resp = await notion.search(params);
        for (const item of resp.results) {
          if (item.object === "database") {
            const mapFn = item.title && item.title.map ? item.title.map : null;
            const title = (mapFn ? mapFn.call(item.title, function(t) { return t.plain_text; }).join("") : "")
              || item.name || item.display_name || "Untitled database";
            const originalId = item.id || item.database_id || "";
            const url = item.url || item.public_url || item.workspace_url || "";
            const candidateId = toCompactNotionId(url) || toCompactNotionId(originalId) || originalId;
            pushResult({ id: candidateId, title: title, url: url });
          }
        }
        if (!resp.has_more) break;
        cursor = resp.next_cursor;
      }
    }

    async function attemptREST(filterValueValue) {
      let cursor = undefined;
      while (true) {
        const body = { page_size: 50 };
        if (cursor) body.start_cursor = cursor;
        if (filterValueValue) body.filter = { property: "object", value: filterValueValue };
        const resp = await fetch('https://api.notion.com/v1/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Notion-Version': '2022-06-28',
            'Authorization': 'Bearer ' + token,
          },
          body: JSON.stringify(body)
        });
        if (!resp.ok) {
          const t = await resp.text();
          console.error('/api/databases search REST error', resp.status, resp.statusText, t);
          break;
        }
        const json = await resp.json();
        const arr = json && json.results ? json.results : [];
        for (var i=0;i<arr.length;i++) {
          var item = arr[i];
          if (item && item.object === 'database') {
            var titleArr = (item.title && Array.isArray(item.title)) ? item.title : [];
            var title = titleArr.length ? titleArr.map(function(t){return t.plain_text;}).join('') : (item.name || item.display_name || 'Untitled database');
            var originalId = item.id || item.database_id || '';
            var url = item.url || item.public_url || item.workspace_url || '';
            var candidateId = toCompactNotionId(url) || toCompactNotionId(originalId) || originalId;
            pushResult({ id: candidateId, title: title, url: url });
          }
        }
        if (!json || !json.has_more) break;
        cursor = json.next_cursor;
      }
    }

    if (notion) {
      try { await attemptSDK('data_source'); } catch (e1) { console.error('/api/databases sdk data_source failed:', e1 && e1.message ? e1.message : e1); }
      if (results.length === 0) { try { await attemptSDK(undefined); } catch (e2) { console.error('/api/databases sdk no-filter failed:', e2 && e2.message ? e2.message : e2); } }
    } else {
      try { await attemptREST('data_source'); } catch (e3) { console.error('/api/databases rest data_source failed:', e3 && e3.message ? e3.message : e3); }
      if (results.length === 0) { try { await attemptREST(undefined); } catch (e4) { console.error('/api/databases rest no-filter failed:', e4 && e4.message ? e4.message : e4); } }
    }

    // Fallback cuối: duyệt pages để thu dbIds (chỉ khi có SDK)
    if (results.length === 0 && notion) {
      try {
        const dbIds = new Set();
        let cursor = undefined;
        while (true) {
          const resp = await notion.search({ filter: { property: "object", value: "page" }, page_size: 50, ...(cursor ? { start_cursor: cursor } : {}) });
          for (const p of resp.results) {
            const parent = p.parent || {};
            if (parent.type === "database_id" && parent.database_id) dbIds.add(parent.database_id);
          }
          if (!resp.has_more) break; cursor = resp.next_cursor;
        }
        for (const id of dbIds) {
          try {
            const db = await notion.databases.retrieve({ database_id: id });
            const title = (db && db.title && Array.isArray(db.title) ? db.title.map(function(t){return t.plain_text;}).join("") : "Untitled database");
            const url = db.url || "";
            const candidateId = toCompactNotionId(url) || toCompactNotionId(id) || id;
            pushResult({ id: candidateId, title: title, url: url });
          } catch (e5) {
            console.error("/api/databases retrieve fallback failed:", id, e5 && e5.message ? e5.message : e5);
          }
        }
      } catch (e6) {
        console.error("/api/databases from pages fallback failed:", e6 && e6.message ? e6.message : e6);
      }
    }

    res.json({ results: results });
  } catch (e) {
    const msg = e && e.message ? e.message : e;
    console.error("/api/databases error:", msg);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/pages", async (req, res) => {
  try {
    const notion = getClient(req);
    const token = getToken(req);
    if (!notion && !token) return res.status(400).json({ error: "Thiếu NOTION_TOKEN" });

    const results = [];
    let cursor = undefined;
    if (notion) {
      while (true) {
        const resp = await notion.search({ filter: { property: "object", value: "page" }, start_cursor: cursor, page_size: 50, sort: { direction: "descending", timestamp: "last_edited_time" } });
        for (const page of resp.results) {
          var title = "Untitled page";
          try {
            const props = page.properties || {};
            const titlePropEntry = Object.entries(props).find(function(entry) { var p = entry[1]; return p && p.type === "title"; });
            if (titlePropEntry) { const p = titlePropEntry[1]; if (p && Array.isArray(p.title) && p.title.length) { title = p.title.map(function(t) { return t.plain_text; }).join(""); } }
          } catch (err) {}
          results.push({ id: page.id, title: title, url: page.url });
        }
        if (!resp.has_more) break; cursor = resp.next_cursor;
      }
    } else {
      while (true) {
        const body = { filter: { property: 'object', value: 'page' }, page_size: 50 };
        if (cursor) body.start_cursor = cursor;
        const resp = await fetch('https://api.notion.com/v1/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Notion-Version': '2022-06-28', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) });
        if (!resp.ok) { const t = await resp.text(); return res.status(resp.status).json({ error: resp.statusText, detail: t }); }
        const json = await resp.json();
        const arr = json && json.results ? json.results : [];
        for (var i=0;i<arr.length;i++) { var page = arr[i]; var title = 'Untitled page';
          try { var props = page.properties || {}; var entry = Object.entries(props).find(function(en){ var p = en[1]; return p && p.type==='title'; }); if (entry) { var p = entry[1]; if (p && Array.isArray(p.title) && p.title.length) { title = p.title.map(function(t){return t.plain_text;}).join(''); } } } catch (_e) {}
          results.push({ id: page.id, title: title, url: page.url });
        }
        if (!json || !json.has_more) break; cursor = json.next_cursor;
      }
    }
    res.json({ results: results });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.post("/api/database/create-page", async (req, res) => {
  try {
    const notion = getClient(req);
    const token = getToken(req);
    if (!notion && !token) return res.status(400).json({ error: "Thiếu NOTION_TOKEN" });
    const body = req.body || {};
    const database_id = body.database_id;
    const title = body.title;
    const properties = body.properties;
    const content = body.content;
    const icon = body.icon;
    const dbId = extractIdFromAny(database_id);
    if (!dbId) return res.status(400).json({ error: "database_id không hợp lệ" });

    let titlePropName = null;
    if (notion) {
      const db = await notion.databases.retrieve({ database_id: dbId });
      const dbProps = (db && typeof db.properties === "object" && db.properties) || {};
      const titlePropEntry = Object.entries(dbProps).find(function(entry) { var p = entry[1]; return p && p.type === "title"; });
      titlePropName = titlePropEntry ? titlePropEntry[0] : null;
    } else {
      try {
        const resp = await fetch('https://api.notion.com/v1/databases/' + encodeURIComponent(dbId), { method: 'GET', headers: { 'Accept': 'application/json', 'Notion-Version': '2022-06-28', 'Authorization': 'Bearer ' + token } });
        if (resp.ok) {
          const db = await resp.json();
          const props = (db && db.properties) || {};
          var found = Object.entries(props).find(function(entry){ var p = entry[1]; return p && p.type === 'title'; });
          titlePropName = found ? found[0] : null;
        }
      } catch (_e) {}
    }

    const baseProps = {};
    if (titlePropName) {
      const titleToUse = String(title || "Untitled");
      baseProps[titlePropName] = { title: [{ type: "text", text: { content: titleToUse } }] };
    }

    let iconObj = null;
    if (icon && typeof icon === 'object') {
      if (icon.type === 'emoji' && icon.emoji) {
        iconObj = { type: 'emoji', emoji: String(icon.emoji) };
      } else if (icon.type === 'external') {
        var u = icon.url || (icon.external && icon.external.url);
        if (u) iconObj = { type: 'external', external: { url: String(u) } };
      }
    }

    if (notion) {
      const payload = { parent: { database_id: dbId }, properties: Object.assign({}, baseProps, (properties && typeof properties === 'object') ? properties : {}) };
      if (iconObj) payload.icon = iconObj;
      const newPage = await notion.pages.create(payload);
      if (content && typeof content === "string" && content.trim()) {
        await notion.blocks.children.append({ block_id: newPage.id, children: [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: content } }] } }] });
      }
      return res.json({ ok: true, page_id: newPage.id, url: newPage.url });
    }

    const restBody = { parent: { database_id: dbId }, properties: Object.assign({}, baseProps, (properties && typeof properties === 'object') ? properties : {}) };
    if (iconObj) restBody.icon = iconObj;
    const resp = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Notion-Version': '2022-06-28', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(restBody)
    });
    if (!resp.ok) { const t = await resp.text(); return res.status(resp.status).json({ error: resp.statusText, detail: t }); }
    const json = await resp.json();
    const pageId = json && json.id;
    if (content && typeof content === 'string' && content.trim() && pageId) {
      await fetch('https://api.notion.com/v1/blocks/' + encodeURIComponent(pageId) + '/children', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Notion-Version': '2022-06-28', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ children: [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: content } }] } }] }) });
    }
    res.json({ ok: true, page_id: pageId, url: json && json.url });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.post("/api/pages/append", async (req, res) => {
  try {
    const notion = getClient(req);
    const token = getToken(req);
    if (!notion && !token) return res.status(400).json({ error: "Thiếu NOTION_TOKEN" });
    const body = req.body || {};
    const page_id = body.page_id;
    const text = body.text;
    if (!page_id || !text) return res.status(400).json({ error: "Thiếu page_id hoặc text" });

    if (notion) {
      await notion.blocks.children.append({ block_id: page_id, children: [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } }] });
      return res.json({ ok: true });
    }
    const resp = await fetch('https://api.notion.com/v1/blocks/' + encodeURIComponent(page_id) + '/children', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Notion-Version': '2022-06-28', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ children: [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: text } }] } }] }) });
    if (!resp.ok) { const t = await resp.text(); return res.status(resp.status).json({ error: resp.statusText, detail: t }); }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const notion = getClient(req);
    if (!notion) return res.status(400).json({ error: "Thiếu NOTION_TOKEN" });
    const q = req.query.q || "";
    const resp = await notion.search({
      query: q,
      sort: { direction: "descending", timestamp: "last_edited_time" },
    });
    res.json(resp);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const staticDir = path.join(__dirname, "views");
app.use(express.static(staticDir));

app.get("*", (req, res) => {
  try {
    return res.sendFile(path.join(staticDir, "index.html"));
  } catch (e) {
    return res.status(404).json({ error: "Không tìm thấy tài nguyên" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
