-- LAHE's pandoc filter: the page shape marked's renderer writes, from pandoc's
-- syntax tree. src/service/pandoc.js runs it; markdown.js finishes the page.
--
-- What it does, in order:
--   1. tags every Markdown link with data-lahe-link="<nonce>:<n>" and writes
--      <!--/lahe-link <nonce>:<n>--> right after its </a>, so markdown.js
--      classifies exactly the links the author wrote in Markdown, never an
--      anchor in raw HTML (the nonce comes from the command line, never from
--      the document), and can swap a whole link even when its text holds raw
--      HTML
--   2. writes code blocks the way marked does: <pre class="mermaid"> for a
--      diagram, <pre><code class="language-x"> for the rest, no highlighting
--   3. wraps each table in .scrollx, so a wide one scrolls on its own
--   4. writes GFM task items as a bare checkbox in a class-free list, the
--      shape the house task-list rule is drawn for
--   5. merges a run of same-kind feature-forge callouts into one panel, as
--      merge_callout_runs in build_feature_docs.py does
--   6. splits the top level into the hero (title plus lede) and one numbered
--      section.sheet per H2. Only top-level H2s split, so a "## " in a code
--      block or inside a fenced div cannot open a section. This runs before
--      step 7, while every fenced div is still one block.
--   7. maps each fenced div's kind onto a house component (the table in
--      docs/features/20261017.02_pandoc_render/01_spec_pandoc_render.md).
--      Every div is written as raw open and close tags around its content,
--      because pandoc's own writer turns a div that opens with a heading into
--      a <section>. An unknown kind keeps its classes and attributes.
--
-- THIS FILE TOUCHES NOTHING OUTSIDE THE DOCUMENT. pandoc's --sandbox does not
-- limit Lua, so the filter uses no io, os, pandoc.pipe or mediabag call. A
-- unit test greps for them.

local nonce = ""

local function escape(text)
  return (text:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"):gsub('"', "&quot;"))
end

local function raw(html)
  return pandoc.RawBlock("html", html)
end

local function read_nonce(meta)
  local value = meta["lahe-nonce"]
  if value then nonce = pandoc.utils.stringify(value) end
end

local link_count = 0

local function link(el)
  if nonce == "" then return el end
  link_count = link_count + 1
  local tag = nonce .. ":" .. link_count
  el.attributes["data-lahe-link"] = tag
  return { el, pandoc.RawInline("html", "<!--/lahe-link " .. tag .. "-->") }
end

local function code_block(el)
  local language = ""
  if el.classes[1] then language = el.classes[1]:lower() end
  if language == "mermaid" then
    return raw('<pre class="mermaid">' .. escape(el.text) .. "</pre>")
  end
  local class = ""
  if language ~= "" then class = ' class="language-' .. escape(language) .. '"' end
  return raw("<pre><code" .. class .. ">" .. escape(el.text) .. "</code></pre>")
end

local function table_block(el)
  return { raw('<div class="scrollx">'), el, raw("</div>") }
end

-- pandoc reads "- [ ] x" as a list item opening with the ballot-box character
-- and writes it as <ul class="task-list"><li><label><input ...>. marked writes
-- <li><input disabled="" type="checkbox"> x</li> in a bare <ul>, and the house
-- task-list rule is drawn for that. Turning the box into raw HTML here also
-- stops pandoc from adding the class and the label.
local BOXES = { ["\u{2610}"] = false, ["\u{2612}"] = true }

local function task_item(blocks)
  local first = blocks[1]
  if not first or (first.t ~= "Plain" and first.t ~= "Para") then return false end
  local lead = first.content[1]
  if not lead or lead.t ~= "Str" or BOXES[lead.text] == nil then return false end
  local box = BOXES[lead.text] and '<input checked="" disabled="" type="checkbox">' or '<input disabled="" type="checkbox">'
  first.content[1] = pandoc.RawInline("html", box)
  return true
end

-- Inline text keeps marked's escaping. pandoc writes a double quote in text
-- and in inline code as a bare ", and markdown.js's relative-URL pass would
-- then read `href="./x"` inside a sentence or a code span as a real attribute
-- and rewrite the words on the page. marked writes &quot;, so these do too.
local function inline_code(el)
  return pandoc.RawInline("html", "<code>" .. escape(el.text) .. "</code>")
end

local function str(el)
  if el.text:find('"', 1, true) then return pandoc.RawInline("html", escape(el.text)) end
  return el
end

local function bullet_list(el)
  for _, item in ipairs(el.content) do task_item(item) end
  return el
end

local function split(doc)
  local blocks = doc.blocks
  local out = { raw('<div class="hero">') }
  local index = 1
  -- The title is the first H1, if it comes before any H2: the rule marked's
  -- split uses. Anything before it joins the lede, as there.
  local title_at = nil
  for i, block in ipairs(blocks) do
    if block.t == "Header" and block.level == 2 then break end
    if block.t == "Header" and block.level == 1 then title_at = i break end
  end
  if title_at then
    table.insert(out, blocks[title_at])
  else
    -- markdown.js writes the file-name title here; it owns the escaping and
    -- the attribute that says the title is page chrome.
    table.insert(out, raw("<!--lahe:file-title-->"))
  end
  local section = 0
  local open = false
  for i, block in ipairs(blocks) do
    if i ~= title_at then
      if block.t == "Header" and block.level == 2 then
        section = section + 1
        if open then
          table.insert(out, raw("</section>"))
        else
          table.insert(out, raw("</div>"))
        end
        open = true
        table.insert(out, raw('<section class="sheet">'))
        table.insert(out, raw('<div class="sheet-head">'))
        table.insert(out, block)
        table.insert(out, raw('<span class="n">Section ' .. section .. "</span></div>"))
      else
        table.insert(out, block)
      end
    end
  end
  table.insert(out, raw(open and "</section>" or "</div>"))
  doc.blocks = out
  return doc
end

-- ---------------------------------------------------------------------------
-- Fenced divs
-- ---------------------------------------------------------------------------

-- The feature-forge callouts, from CALLOUTS in build_feature_docs.py, plus the
-- three names the research report's header reads (decided 2026-10-17: a bare
-- callout and callout-note are the Key-insight panel, callout-warn the caveat
-- panel). `plain` means no panel: an eyebrow label and the content, as
-- unwrap_plain_callouts writes it. `merge` marks the build's six, the only
-- kinds the build merges into one panel when they run together.
local CALLOUTS = {
  ["callout-req"] = { plain = true, label = "Requirement", merge = true },
  ["callout-nongoal"] = { plain = true, label = "Non-goals", merge = true },
  ["callout-metric"] = { base = { "insight" }, label = "Metrics", merge = true },
  ["callout-suggest"] = { base = { "insight" }, label = "Suggestion", merge = true },
  ["callout-question"] = { base = { "insight", "insight--caveat" }, label = "Open question", merge = true },
  ["callout-flag"] = { base = { "insight", "insight--caveat" }, label = "Red flag", merge = true },
  ["callout-warn"] = { base = { "insight", "insight--caveat" } },
  ["callout-note"] = { base = { "insight" }, label = "Note" },
  ["callout"] = { base = { "insight" } },
}

-- HTML attributes written under their own name; anything else gets the data-
-- prefix, which is what pandoc's own writer does with a key it does not know.
local PLAIN_ATTRS = { title = true, lang = true, dir = true, style = true, role = true }

local function attr_name(key)
  if key:match("^data%-") or key:match("^aria%-") or PLAIN_ATTRS[key] then return key end
  return "data-" .. key
end

local function attr_string(id, classes, attributes)
  local parts = {}
  local written = {}
  if id and id ~= "" then table.insert(parts, ' id="' .. escape(id) .. '"') end
  if classes and #classes > 0 then table.insert(parts, ' class="' .. escape(table.concat(classes, " ")) .. '"') end
  for _, pair in ipairs(attributes or {}) do
    -- label= and data-label= both become data-label; the first one wins.
    local name = attr_name(pair[1])
    if not written[name] then
      written[name] = true
      table.insert(parts, " " .. name .. '="' .. escape(pair[2]) .. '"')
    end
  end
  return table.concat(parts)
end

local function attr_pairs(attributes)
  local pairs_out = {}
  for key, value in pairs(attributes) do table.insert(pairs_out, { key, value }) end
  table.sort(pairs_out, function (a, b) return a[1] < b[1] end)
  return pairs_out
end

local function has_class(el, name)
  for _, c in ipairs(el.classes) do if c == name then return true end end
  return false
end

local function callout_kind(el)
  for _, c in ipairs(el.classes) do
    if CALLOUTS[c] then return c end
  end
  return nil
end

-- A list of blocks: the opening tag, the content, the closing tag.
local function wrap(open, blocks, close)
  local out = { raw(open) }
  for _, b in ipairs(blocks) do table.insert(out, b) end
  table.insert(out, raw(close))
  return out
end

local function inline_blocks(block)
  if block and (block.t == "Para" or block.t == "Plain") then return block.content end
  return nil
end

-- <tag class="...">inlines</tag> as one Plain whose ends are raw tags, so the
-- inlines (links included) still go through pandoc's writer and the element
-- holds no stray newlines for the layer's text matching to trip on.
local function tagged(tag, class, inlines)
  local line = { pandoc.RawInline("html", "<" .. tag .. (class and (' class="' .. class .. '"') or "") .. ">") }
  for _, inl in ipairs(inlines) do table.insert(line, inl) end
  table.insert(line, pandoc.RawInline("html", "</" .. tag .. ">"))
  return { pandoc.Plain(line) }
end

local function append_all(target, list)
  for _, item in ipairs(list) do table.insert(target, item) end
end

-- stat: the first paragraph is the number, the rest is what it means.
local function map_stat(blocks)
  local out = {}
  for i, block in ipairs(blocks) do
    local inlines = inline_blocks(block)
    if inlines then
      append_all(out, tagged("p", i == 1 and "stat-value" or "stat-meta", inlines))
    else
      table.insert(out, block)
    end
  end
  return out
end

-- pullquote: the first paragraph is the quote, the rest is who said it.
local function map_pullquote(blocks)
  local out = {}
  local footer = {}
  for i, block in ipairs(blocks) do
    local inlines = inline_blocks(block)
    if i == 1 or not inlines then
      table.insert(out, block)
    else
      if #footer > 0 then table.insert(footer, pandoc.LineBreak()) end
      append_all(footer, inlines)
    end
  end
  if #footer > 0 then append_all(out, tagged("footer", nil, footer)) end
  return out
end

-- eyebrow: one short line, so the paragraphs become one line. Anything that
-- is not a paragraph follows the line rather than vanish.
local function map_eyebrow(blocks)
  local line = {}
  local rest = {}
  for _, block in ipairs(blocks) do
    local inlines = inline_blocks(block)
    if inlines then
      if #line > 0 then table.insert(line, pandoc.Space()) end
      append_all(line, inlines)
    else
      table.insert(rest, block)
    end
  end
  return line, rest
end

-- rimage: the image, then the caption with its source and license.
local function map_rimage(blocks)
  local out = {}
  local caption = {}
  for i, block in ipairs(blocks) do
    local inlines = inline_blocks(block)
    if i == 1 and inlines then
      table.insert(out, pandoc.Plain(inlines))
    elseif inlines then
      if #caption > 0 then table.insert(caption, pandoc.LineBreak()) end
      append_all(caption, inlines)
    else
      table.insert(out, block)
    end
  end
  if #caption > 0 then append_all(out, tagged("figcaption", nil, caption)) end
  return out
end

-- card: a first line that is only bold text is the card's name.
local function map_card(blocks)
  local out = {}
  for i, block in ipairs(blocks) do
    local inlines = inline_blocks(block)
    local strong = nil
    if i == 1 and inlines then
      local kept = {}
      for _, inl in ipairs(inlines) do
        if inl.t ~= "Space" and inl.t ~= "SoftBreak" then table.insert(kept, inl) end
      end
      if #kept == 1 and kept[1].t == "Strong" then strong = kept[1] end
    end
    if strong then
      append_all(out, tagged("h4", nil, strong.content))
    else
      table.insert(out, block)
    end
  end
  return out
end

-- Kinds with a house twin, by the div's class. Each returns the component's
-- classes and its content.
-- A list, not a map, so a div carrying two of these classes renders the
-- same way on every run (Lua does not order a map's keys).
local TWINS = {
  { "stat", function (el) return { "stat" }, map_stat(el.content) end },
  { "stat-row", function (el) return { "stats" }, el.content end },
  { "keytakeaway", function (el) return { "callout" }, el.content end },
  { "card", function (el) return { "card" }, map_card(el.content) end },
  { "cardgrid", function (el) return { "cards" }, el.content end },
}

local function without(classes, drop)
  local out = {}
  for _, c in ipairs(classes) do if not drop[c] then table.insert(out, c) end end
  return out
end

local function div(el)
  local attributes = attr_pairs(el.attributes)
  local kind = callout_kind(el)
  if kind then
    local spec = CALLOUTS[kind]
    local label = el.attributes["data-label"] or el.attributes["label"] or spec.label
    if spec.plain then
      local eyebrow = '<p class="eyebrow"' .. attr_string(el.identifier, nil, nil) .. ">" .. escape(label) .. "</p>"
      local out = { raw(eyebrow) }
      append_all(out, el.content)
      return out
    end
    local classes = {}
    local seen = {}
    for _, c in ipairs(spec.base) do table.insert(classes, c) seen[c] = true end
    for _, c in ipairs(el.classes) do
      if c ~= "callout" and not seen[c] then table.insert(classes, c) seen[c] = true end
    end
    local rest = {}
    for _, pair in ipairs(attributes) do
      if pair[1] ~= "data-label" and pair[1] ~= "label" then table.insert(rest, pair) end
    end
    if label then table.insert(rest, 1, { "data-label", label }) end
    return wrap("<div" .. attr_string(el.identifier, classes, rest) .. ">", el.content, "</div>")
  end
  if has_class(el, "pullquote") then
    local classes = without(el.classes, { pullquote = true })
    table.insert(classes, 1, "pullquote")
    return wrap("<blockquote" .. attr_string(el.identifier, classes, attributes) .. ">", map_pullquote(el.content), "</blockquote>")
  end
  if has_class(el, "rimage") then
    local classes = without(el.classes, { rimage = true })
    table.insert(classes, 1, "plate")
    return wrap("<figure" .. attr_string(el.identifier, classes, attributes) .. ">", map_rimage(el.content), "</figure>")
  end
  if has_class(el, "eyebrow") then
    local classes = without(el.classes, { eyebrow = true })
    table.insert(classes, 1, "eyebrow")
    local text, rest = map_eyebrow(el.content)
    local line = { pandoc.RawInline("html", "<p" .. attr_string(el.identifier, classes, attributes) .. ">") }
    append_all(line, text)
    table.insert(line, pandoc.RawInline("html", "</p>"))
    local out = { pandoc.Plain(line) }
    append_all(out, rest)
    return out
  end
  for _, twin in ipairs(TWINS) do
    local name, map = twin[1], twin[2]
    if has_class(el, name) then
      local classes, content = map(el)
      local drop = {}
      drop[name] = true
      for _, c in ipairs(without(el.classes, drop)) do table.insert(classes, c) end
      return wrap("<div" .. attr_string(el.identifier, classes, attributes) .. ">", content, "</div>")
    end
  end
  -- insight, xref, beattable, anything else: the div as written.
  return wrap("<div" .. attr_string(el.identifier, el.classes, attributes) .. ">", el.content, "</div>")
end

-- merge_callout_runs: two or more of the build's callouts with the same
-- classes and the same label, nothing but blank lines between them, become one
-- panel with one label. Each item keeps its id as an empty anchor.
local function run_key(block)
  if block.t ~= "Div" then return nil end
  local kind = callout_kind(block)
  if not kind or not CALLOUTS[kind].merge then return nil end
  return table.concat(block.classes, " ") .. "\0" .. (block.attributes["data-label"] or block.attributes["label"] or "")
end

local function anchored(item)
  local out = {}
  if item.identifier ~= "" then table.insert(out, raw('<span id="' .. escape(item.identifier) .. '"></span>')) end
  append_all(out, item.content)
  return out
end

local function merge_runs(blocks)
  local out = {}
  local i = 1
  while i <= #blocks do
    local key = run_key(blocks[i])
    local j = i
    while key and blocks[j + 1] and run_key(blocks[j + 1]) == key do j = j + 1 end
    if j > i then
      local content = {}
      for k = i, j do append_all(content, anchored(blocks[k])) end
      local first = blocks[i]
      table.insert(out, pandoc.Div(content, pandoc.Attr("", first.classes, first.attributes)))
    else
      table.insert(out, blocks[i])
    end
    i = j + 1
  end
  return out
end

return {
  { Meta = read_nonce },
  { Link = link, CodeBlock = code_block, Table = table_block, BulletList = bullet_list },
  -- Top down, so an image's alt text is left alone: pandoc writes alt from
  -- plain text, and a raw piece there would drop words.
  { traverse = "topdown", Image = function (el) return el, false end, Code = inline_code, Str = str },
  { Blocks = merge_runs },
  { Pandoc = split },
  { Div = div }
}
